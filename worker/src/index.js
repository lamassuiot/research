// Cloudflare Worker: exchanges a GitHub OAuth code for a user token (it holds the client secret) and revokes tokens.
// Stateless. Only answers requests whose Origin is env.ALLOWED_ORIGIN. Never logs codes, tokens or the secret.

const MAX_BODY = 4096;

export default {
  async fetch(req, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "600",
      "Vary": "Origin",
    };
    const json = (obj, status = 200) => Response.json(obj, { status, headers: cors });
    const none = status => new Response(null, { status, headers: cors });

    if (req.headers.get("Origin") !== env.ALLOWED_ORIGIN) return new Response("Forbidden", { status: 403 });
    if (req.method === "OPTIONS") return none(204);
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });

    const path = new URL(req.url).pathname;
    if (path !== "/token" && path !== "/revoke") return new Response("Not found", { status: 404, headers: cors });

    const raw = await req.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY) return json({ error: "body_too_large" }, 400);
    let body;
    try { body = JSON.parse(raw || "{}"); } catch { return json({ error: "invalid_json" }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "invalid_json" }, 400);

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
