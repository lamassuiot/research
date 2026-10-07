// Cloudflare Worker for Lamassu Research. Stateless. Answers only requests whose Origin is env.ALLOWED_ORIGIN.
//   POST /token    exchanges a GitHub OAuth code for a user token (it holds the client secret)
//   POST /revoke   revokes a token
//   POST /preview  {url} -> title, description, image, site name and icon of a web page (link previews)  [needs a token with write access]
//   GET  /img?u=   the image/icon of a link, fetched and served by this Worker, so readers never contact the external site  [needs a token]
// /preview and /img need `Authorization: Bearer <GitHub user token>`; the token must have access to env.CONTENT_REPO.
// Never logs codes, tokens or the secret.

const MAX_BODY = 4096;
const MAX_PAGE = 512 * 1024;            // bytes of an HTML page we read (only the <head> matters)
const MAX_IMAGE = 3 * 1024 * 1024;
const FETCH_TIMEOUT = 6000;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "image/x-icon", "image/vnd.microsoft.icon"];
const UA = "Mozilla/5.0 (compatible; LamassuResearchPreview/1.0; +https://www.lamassu.io/research/)";

/* ------------------------------------------------------------------ URL safety */
// Only public http(s) pages: no credentials, no IP literals, no single-label or internal names.
export function safeUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password || (u.port && !["80", "443"].includes(u.port))) return null;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || h.startsWith("[") || /^[0-9.]+$/.test(h) || /^[0-9a-f:]+$/i.test(h)) return null;
  if (/(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp)$/.test(h)) return null;
  return u;
}

/* ------------------------------------------------------------------ authorisation: the token must see the content repository */
const verified = new Map();     // token -> {at, perms}, 60 s
async function repoPermissions(req, env) {
  const m = /^Bearer\s+(\S{10,200})$/.exec(req.headers.get("Authorization") || "");
  if (!m) return null;
  const token = m[1], hit = verified.get(token);
  if (hit && Date.now() - hit.at < 60000) return hit.perms;
  let perms = null;
  try {
    const r = await fetch(`https://api.github.com/repos/${env.CONTENT_REPO}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "lamassu-research-auth" } });
    if (r.ok) perms = (await r.json()).permissions || null;
  } catch { /* treated as no access */ }
  if (verified.size > 200) verified.clear();
  verified.set(token, { at: Date.now(), perms });
  return perms;
}

/* ------------------------------------------------------------------ fetching external pages, safely */
async function safeFetch(rawUrl, accept) {
  let u = safeUrl(rawUrl);
  for (let hop = 0; u && hop <= 3; hop++) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT);
    let r;
    try {
      r = await fetch(u.href, { redirect: "manual", signal: ctl.signal, headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "en" } });
    } catch { return null; } finally { clearTimeout(timer); }
    if (r.status >= 300 && r.status < 400 && r.headers.get("Location")) {
      try { u = safeUrl(new URL(r.headers.get("Location"), u).href); } catch { return null; }
      continue;
    }
    return r.ok ? { r, url: u } : null;
  }
  return null;
}
async function readUpTo(res, max) {            // the first `max` bytes of a response body (null when it is bigger, for images)
  const reader = res.body && res.body.getReader ? res.body.getReader() : null;
  if (!reader) { const b = new Uint8Array(await res.arrayBuffer()); return b.length > max ? null : b; }
  const chunks = []; let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length; chunks.push(value);
    if (n > max) { try { await reader.cancel(); } catch { /* ignore */ } return null; }
  }
  const out = new Uint8Array(n); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
async function readHead(res) {                 // a page: stop after the <head>, or after MAX_PAGE bytes
  const reader = res.body && res.body.getReader ? res.body.getReader() : null;
  if (!reader) return (await res.text()).slice(0, MAX_PAGE);
  const dec = new TextDecoder("utf-8", { fatal: false }); let text = "", n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length; text += dec.decode(value, { stream: true });
    if (/<\/head\s*>/i.test(text) || n > MAX_PAGE) { try { await reader.cancel(); } catch { /* ignore */ } break; }
  }
  return text;
}

/* ------------------------------------------------------------------ reading the page's metadata */
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”" };
const decode = s => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === "#") { const c = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(c); } catch { return m; } }
  return ENT[e.toLowerCase()] ?? m;
}).replace(/\s+/g, " ").trim();
function attrs(tag) {
  const out = {}; const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g; let m;
  while ((m = re.exec(tag))) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  return out;
}
export function parsePreview(html, pageUrl) {
  const head = html.slice(0, MAX_PAGE).split(/<\/head\s*>/i)[0];
  const meta = {};
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]), k = (a.property || a.name || "").toLowerCase();
    if (k && a.content !== undefined && !(k in meta)) meta[k] = decode(a.content);
  }
  const title = decode((/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head) || [])[1] || "");
  const abs = v => { if (!v) return ""; try { const u = safeUrl(new URL(v, pageUrl).href); return u ? u.href.slice(0, 600) : ""; } catch { return ""; } };
  let icon = "";
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrs(m[0]), rel = (a.rel || "").toLowerCase();
    if (a.href && /(^|\s)(icon|shortcut icon|apple-touch-icon)(\s|$)/.test(rel)) { icon = abs(a.href); if (!/apple-touch/.test(rel)) break; }
  }
  const host = new URL(pageUrl).hostname.replace(/^www\./, "");
  return {
    title: (meta["og:title"] || meta["twitter:title"] || title).slice(0, 200),
    description: (meta["og:description"] || meta["twitter:description"] || meta["description"] || "").slice(0, 300),
    image: abs(meta["og:image"] || meta["og:image:url"] || meta["twitter:image"] || meta["twitter:image:src"]),
    siteName: (meta["og:site_name"] || meta["application-name"] || host).slice(0, 80),
    icon: icon || abs("/favicon.ico"),
  };
}

/* ------------------------------------------------------------------ the Worker */
export default {
  async fetch(req, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET, POST",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "600",
      "Vary": "Origin",
    };
    const json = (obj, status = 200) => Response.json(obj, { status, headers: cors });
    const none = status => new Response(null, { status, headers: cors });

    if (req.headers.get("Origin") !== env.ALLOWED_ORIGIN) return new Response("Forbidden", { status: 403 });
    if (req.method === "OPTIONS") return none(204);

    const url = new URL(req.url), path = url.pathname;
    if (req.method === "GET" && path === "/img") return image(req, env, url, cors);
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });
    if (!["/token", "/revoke", "/preview"].includes(path)) return new Response("Not found", { status: 404, headers: cors });

    const raw = await req.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY) return json({ error: "body_too_large" }, 400);
    let body;
    try { body = JSON.parse(raw || "{}"); } catch { return json({ error: "invalid_json" }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "invalid_json" }, 400);

    if (path === "/preview") {
      const perms = await repoPermissions(req, env);
      if (!perms) return json({ error: "unauthorized" }, 401);
      if (!(perms.push || perms.maintain || perms.admin)) return json({ error: "forbidden" }, 403);
      const target = safeUrl(body.url);
      if (!target) return json({ error: "invalid_url" }, 400);
      const got = await safeFetch(target.href, "text/html,application/xhtml+xml");
      if (!got) return json({ error: "unreachable" }, 502);
      if (!/html|xml/i.test(got.r.headers.get("Content-Type") || "")) return json({ error: "not_a_page" }, 422);
      return json(parsePreview(await readHead(got.r), got.url.href));
    }

    if (path === "/token") {
      const { code, code_verifier } = body;
      if (typeof code !== "string" || !code || code.length > 100) return json({ error: "invalid_code" }, 400);
      if (code_verifier !== undefined && (typeof code_verifier !== "string" || code_verifier.length > 200)) return json({ error: "invalid_verifier" }, 400);
      let t;
      try {
        const r = await fetch("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET,
            code, code_verifier, redirect_uri: env.REDIRECT_URI,
          }),
        });
        t = await r.json();
      } catch { return json({ error: "exchange_failed" }, 400); }
      if (!t || !t.access_token) return json({ error: (t && t.error) || "exchange_failed" }, 400);
      // Never hand out the refresh token: the app keeps the access token in memory only.
      return json({ access_token: t.access_token, expires_in: t.expires_in });
    }

    // /revoke
    if (typeof body.access_token === "string" && body.access_token) {
      try {
        await fetch(`https://api.github.com/applications/${env.GITHUB_CLIENT_ID}/token`, {
          method: "DELETE",
          headers: {
            Authorization: "Basic " + btoa(`${env.GITHUB_CLIENT_ID}:${env.GITHUB_CLIENT_SECRET}`),
            Accept: "application/vnd.github+json",
            "User-Agent": "lamassu-research-auth",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ access_token: body.access_token }),
        });
      } catch { /* answered the same way: the response gives nothing away */ }
    }
    return none(204);
  },
};

/* The image of a link, served by us. Images are cached for a day so a popular link is fetched once, not once per reader. */
async function image(req, env, url, cors) {
  const perms = await repoPermissions(req, env);
  if (!perms) return new Response(null, { status: 401, headers: cors });
  const target = safeUrl(url.searchParams.get("u"));
  if (!target) return new Response(null, { status: 400, headers: cors });
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const key = new Request("https://img.cache.invalid/" + encodeURIComponent(target.href));
  if (cache) { const hit = await cache.match(key); if (hit) return new Response(hit.body, { status: 200, headers: { ...Object.fromEntries(hit.headers), ...cors } }); }
  const got = await safeFetch(target.href, "image/avif,image/webp,image/png,image/jpeg,image/gif,image/x-icon,*/*;q=0.5");
  if (!got) return new Response(null, { status: 502, headers: cors });
  const type = (got.r.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (!IMAGE_TYPES.includes(type)) return new Response(null, { status: 415, headers: cors });          // no SVG: it can carry scripts
  const declared = Number(got.r.headers.get("Content-Length") || 0);
  if (declared > MAX_IMAGE) return new Response(null, { status: 413, headers: cors });
  const bytes = await readUpTo(got.r, MAX_IMAGE);
  if (!bytes) return new Response(null, { status: 413, headers: cors });
  const headers = { "Content-Type": type, "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox", "Cross-Origin-Resource-Policy": "cross-origin" };
  if (cache) { try { await cache.put(key, new Response(bytes, { status: 200, headers })); } catch { /* ignore */ } }
  return new Response(bytes, { status: 200, headers: { ...headers, ...cors } });
}
