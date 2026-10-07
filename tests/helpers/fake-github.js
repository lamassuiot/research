// A GitHub (REST + GraphQL), GitHub OAuth page and Cloudflare Worker simulated with page.route().
// Everything lives in memory; nothing leaves the machine. Any other request to github.com / api.github.com
// is answered with 500 and recorded in state.unexpected, so tests fail on calls nobody planned for.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const OWNER = "lamassuiot", REPO = "research-content";
const WORKER = "https://auth.test";
// LR_TEMPLATE points the simulated repository at another content template (a folder with tags.json and pages/)
const TEMPLATE = process.env.LR_TEMPLATE ? path.resolve(process.env.LR_TEMPLATE) : path.resolve(__dirname, "..", "..", "content-template");
const sha1 = s => crypto.createHash("sha1").update(s).digest("hex");
const b64u = buf => Buffer.from(buf).toString("base64url");

/* ------------------------------------------------------------------ in-memory git repository */
function createRepo() {
  const repo = { commits: [], counter: 0 };
  repo.head = () => repo.commits[repo.commits.length - 1];
  repo.add = (message, changes, author) => {
    const prev = repo.head();
    const files = new Map(prev ? prev.files : []);
    const changed = new Set();
    for (const [p, v] of Object.entries(changes)) {
      if (v === null) files.delete(p); else files.set(p, v);
      changed.add(p);
    }
    const c = { oid: sha1(`${++repo.counter}:${message}`), parent: prev ? prev.oid : null, files, changed, message,
      author: author || { name: "lamassu-research", login: "lamassu-research" }, date: new Date(Date.UTC(2026, 9, 7, 8, 0, repo.counter)).toISOString() };
    repo.commits.push(c);
    return c;
  };
  repo.find = rev => {
    if (rev === "main") return repo.head();
    if (!/^[0-9a-f]{7,40}$/.test(rev)) return null;
    return repo.commits.find(c => c.oid.startsWith(rev)) || null;
  };
  // "main:pages/x/meta.json" or "<oid>:path" -> text | null
  repo.read = expr => {
    const i = expr.indexOf(":");
    const c = repo.find(i < 0 ? expr : expr.slice(0, i));
    if (!c || i < 0) return null;
    const p = expr.slice(i + 1);
    return c.files.has(p) ? c.files.get(p) : null;
  };
  repo.history = (p, limit = 100) => repo.commits.slice().reverse()
    .filter(c => [...c.changed].some(f => f === p || f.startsWith(p + "/"))).slice(0, limit);
  return repo;
}
function seedFromTemplate(repo) {
  repo.add("Add tags", { "tags.json": fs.readFileSync(path.join(TEMPLATE, "tags.json"), "utf8") });
  // everything lives in projects/<id>/: project.json first (one commit), then one commit per page
  const projectsDir = path.join(TEMPLATE, "projects");
  if (!fs.existsSync(projectsDir)) return repo;
  const projects = fs.readdirSync(projectsDir).filter(id => fs.statSync(path.join(projectsDir, id)).isDirectory());
  const base = {};
  for (const pid of projects) base[`projects/${pid}/project.json`] = fs.readFileSync(path.join(projectsDir, pid, "project.json"), "utf8");
  repo.add("Add projects", base);
  for (const pid of projects) {
    const pagesDir = path.join(projectsDir, pid, "pages");
    for (const slug of fs.existsSync(pagesDir) ? fs.readdirSync(pagesDir) : []) {
      const dir = path.join(pagesDir, slug), changes = {};
      for (const f of fs.readdirSync(dir)) changes[`projects/${pid}/pages/${slug}/${f}`] = fs.readFileSync(path.join(dir, f), "utf8");
      const meta = JSON.parse(changes[`projects/${pid}/pages/${slug}/meta.json`]);
      repo.add(`Initial version\n\nKnow-how-Page: ${slug}\nKnow-how-Project: ${pid}\nKnow-how-Revision: 1\nKnow-how-Status: ${meta.status}\nContent-SHA256: ${meta.sha256}`, changes);
    }
  }
  return repo;
}

/* ------------------------------------------------------------------ the page.route() handlers */
async function installFakeGitHub(page, opts = {}) {
  const repo = opts.repo || seedFromTemplate(createRepo());
  const user = opts.user || { login: "ada", name: "Ada Lovelace" };
  const state = { repo, previewCalls: [], imgCalls: [], requests: [], unexpected: [], revokes: [], authorizes: [], codes: new Map(), tokens: new Set(), tokenCount: 0,
    userAt: null, raced: false, commitsBy: login => repo.commits.filter(c => c.author.login === login) };
  state.expireAll = () => state.tokens.clear();
  const perms = { admin: { admin: true, maintain: true, push: true, triage: true, pull: true }, write: { admin: false, maintain: false, push: true, triage: true, pull: true },
    read: { admin: false, maintain: false, push: false, triage: false, pull: true } };

  const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, PATCH, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, x-github-api-version, accept", "access-control-expose-headers": "x-ratelimit-remaining, x-ratelimit-reset" };
  const json = (route, status, body, headers) => route.fulfill({ status, headers: { ...CORS, "content-type": "application/json", ...(headers || {}) }, body: JSON.stringify(body) });
  const text = (route, status, body) => route.fulfill({ status, headers: { ...CORS, "content-type": "text/plain; charset=utf-8" }, body });

  await page.route(url => ["api.github.com", "github.com", "auth.test", "avatars.githubusercontent.com", "fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname), async route => {
    const req = route.request(), url = new URL(req.url()), method = req.method();
    if (url.hostname === "fonts.googleapis.com") return route.fulfill({ status: 200, headers: { "content-type": "text/css" }, body: "" });
    if (url.hostname === "fonts.gstatic.com") return route.abort();
    if (url.hostname === "avatars.githubusercontent.com") {
      // a coloured circle with the first letter of the login, so screenshots show distinct avatars
      const who = decodeURIComponent(url.pathname.split("/").pop() || "?"), hue = [...who].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);
      return route.fulfill({ status: 200, headers: { "content-type": "image/svg+xml" },
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="hsl(${hue},55%,45%)"/><text x="32" y="42" font-size="30" font-family="sans-serif" text-anchor="middle" fill="#fff">${who[0].toUpperCase()}</text></svg>` });
    }
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    state.requests.push({ method, host: url.hostname, path: url.pathname });

    /* GitHub sign-in page: bounce straight back with a code (or an error) */
    if (url.hostname === "github.com" && url.pathname === "/login/oauth/authorize") {
      const q = Object.fromEntries(url.searchParams);
      state.authorizes.push({ ...q, hasScope: url.searchParams.has("scope") });
      const back = new URL(q.redirect_uri);
      if (opts.denyLogin) back.searchParams.set("error", "access_denied");
      else {
        const code = "fake-code-" + state.codes.size;
        state.codes.set(code, { challenge: q.code_challenge, login: user.login });
        back.searchParams.set("code", code);
        back.searchParams.set("state", opts.badState ? "not-the-state" : q.state);
      }
      return route.fulfill({ status: 200, headers: { "content-type": "text/html" }, body: `<!doctype html><script>location.replace(${JSON.stringify(back.toString())})</script>` });
    }
    /* the Cloudflare Worker */
    if (url.hostname === "auth.test") {
      const body = req.postDataJSON() || {};
      if (url.pathname === "/token") {
        if (opts.holdWorker) await opts.holdWorker;
        const c = state.codes.get(body.code);
        if (opts.workerFails) return json(route, 400, { error: "exchange_failed" });
        if (!c || !body.code_verifier || b64u(crypto.createHash("sha256").update(body.code_verifier).digest()) !== c.challenge) return json(route, 400, { error: "bad_verification_code" });
        state.codes.delete(body.code);
        const token = `tok-${c.login}-${++state.tokenCount}`; state.tokens.add(token);
        return json(route, 200, { access_token: token, expires_in: opts.expiresIn ?? 28800 });
      }
      if (url.pathname === "/preview" || url.pathname === "/img") {
        const tok = (req.headers()["authorization"] || "").replace(/^Bearer /, "");
        if (!state.tokens.has(tok)) return json(route, 401, { error: "unauthorized" });
        if (url.pathname === "/preview") {
          const u = (req.postDataJSON() || {}).url; state.previewCalls.push(u);
          const d = (opts.previews || {})[u];
          return d ? json(route, 200, d) : json(route, 502, { error: "unreachable" });
        }
        const target = url.searchParams.get("u"); state.imgCalls.push({ url: target, auth: req.headers()["authorization"] });
        const img = (opts.images || {})[target];
        return img ? route.fulfill({ status: 200, headers: { ...CORS, "content-type": "image/png" }, body: img }) : route.fulfill({ status: 502, headers: CORS });
      }
      if (url.pathname === "/revoke") { state.revokes.push(body.access_token); state.tokens.delete(body.access_token); return route.fulfill({ status: 204, headers: CORS }); }
      return json(route, 404, { error: "not_found" });
    }
    /* api.github.com */
    if (url.hostname === "api.github.com") {
      const token = (req.headers()["authorization"] || "").replace(/^Bearer /, "");
      if (!state.tokens.has(token)) return json(route, 401, { message: "Bad credentials" });
      if (url.pathname === "/user") { state.userAt = state.requests.length; return json(route, 200, { login: user.login, name: user.name, avatar_url: `https://avatars.githubusercontent.com/u/${user.login}?s=64` }); }
      if (url.pathname === `/repos/${OWNER}/${REPO}`) {
        const p = perms[opts.permission || "write"];
        return p ? json(route, 200, { full_name: `${OWNER}/${REPO}`, permissions: p }) : json(route, 404, { message: "Not Found" });
      }
      const m = url.pathname.match(new RegExp(`^/repos/${OWNER}/${REPO}/contents/(.+)$`));
      if (m && method === "GET") {
        const content = repo.read(`${url.searchParams.get("ref")}:${decodeURIComponent(m[1])}`);
        if (content == null) return json(route, 404, { message: "Not Found" });
        return Buffer.isBuffer(content) ? route.fulfill({ status: 200, headers: { ...CORS, "content-type": "application/octet-stream" }, body: content }) : text(route, 200, content);
      }
      if (url.pathname === "/graphql" && method === "POST") return graphql(route, req.postDataJSON() || {});
      const g = url.pathname.match(new RegExp(`^/repos/${OWNER}/${REPO}/git/(.+)$`));
      if (g) return gitData(route, method, g[1], req.postDataJSON() || {});
    }
    state.unexpected.push(`${method} ${url.href}`);
    return json(route, 500, { message: "unexpected request in the test" });
  });

  const author = c => ({ name: c.author.name, user: { login: c.author.login, avatarUrl: `https://avatars.githubusercontent.com/u/${c.author.login}?s=64` } });
  const node = c => ({ oid: c.oid, authoredDate: c.date, messageHeadline: c.message.split("\n")[0], message: c.message, author: author(c) });
  const blob = text => text == null ? null : { text };
  const blobSha = v => sha1("blob:" + Buffer.from(v).toString("base64"));
  const findBlob = sha => { for (const v of repo.head().files.values()) if (blobSha(v) === sha) return v; return undefined; };
  const metas = vars => Object.fromEntries(Object.keys(vars).filter(k => /^e\d+$/.test(k)).map(k => ["m" + k.slice(1), blob(repo.read(vars[k]))]));

  /* Git Data API: blobs, trees and commits are staged here until a ref update makes them a commit of the repo */
  const staged = { blobs: new Map(), trees: new Map(), commits: new Map() };
  async function gitData(route, method, rest, body) {
    let m;
    if (method === "GET" && (m = rest.match(/^ref\/heads\/(.+)$/))) return json(route, 200, { ref: "refs/heads/" + m[1], object: { sha: repo.head().oid, type: "commit" } });
    if (method === "GET" && (m = rest.match(/^commits\/([0-9a-f]{40})$/))) {
      const c = repo.find(m[1]); return c ? json(route, 200, { sha: c.oid, tree: { sha: "tree-of-" + c.oid } }) : json(route, 404, { message: "Not Found" });
    }
    if (method === "POST" && rest === "blobs") {
      const buf = Buffer.from(body.content, body.encoding === "base64" ? "base64" : "utf8");
      const sha = sha1("blob:" + buf.toString("base64")); staged.blobs.set(sha, buf); state.blobUploads = (state.blobUploads || 0) + 1;
      return json(route, 201, { sha });
    }
    if (method === "POST" && rest === "trees") {
      const sha = sha1("tree:" + JSON.stringify(body)); staged.trees.set(sha, body); return json(route, 201, { sha });
    }
    if (method === "POST" && rest === "commits") {
      const sha = sha1("commit:" + JSON.stringify(body) + Math.random()); staged.commits.set(sha, body); return json(route, 201, { sha });
    }
    if (method === "PATCH" && (m = rest.match(/^refs\/heads\/(.+)$/))) {
      const c = staged.commits.get(body.sha);
      if (!c || body.force) return json(route, 422, { message: "Invalid request" });
      if (opts.raceUploadOnce && !state.uploadRaced) { state.uploadRaced = true; repo.add("Someone else committed", { "NOTES.md": "y" }, { name: "Grace", login: "grace" }); }
      if (c.parents[0] !== repo.head().oid) return json(route, 422, { message: "Update is not a fast forward" });
      const t = staged.trees.get(c.tree);
      if (t.base_tree !== "tree-of-" + c.parents[0]) return json(route, 422, { message: "tree does not belong to the parent" });
      const changes = {};
      for (const e of t.tree) changes[e.path] = e.sha === null ? null : e.sha ? (staged.blobs.get(e.sha) ?? findBlob(e.sha)) : e.content;   // sha null deletes; a sha reuses a blob that is already in the repository
      const nc = repo.add(c.message, changes, { name: user.name, login: user.login });
      return json(route, 200, { ref: "refs/heads/" + m[1], object: { sha: nc.oid } });
    }
    state.unexpected.push(`${method} git/${rest}`);
    return json(route, 500, { message: "unexpected git data request" });
  }

  async function graphql(route, body) {
    const op = body.operationName, v = body.variables || {};
    state.requests[state.requests.length - 1].op = op;
    if (opts.rateLimited) return json(route, 403, { message: "rate limit" }, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 600) });
    const ref = history => ({ ref: { target: { history: { nodes: history } } } });
    let data;
    switch (op) {
      case "Index": {
        const files = repo.head().files, byProject = {};
        for (const p of files.keys()) { const m = p.match(/^projects\/([^/]+)\/(.+)$/); if (m) (byProject[m[1]] ||= []).push(m[2]); }
        const entries = Object.entries(byProject).map(([pid, rest]) => {
          const top = {};
          for (const r of rest) {
            const parts = r.split("/");
            if (parts.length === 1) { top[parts[0]] = { name: parts[0], type: "blob", object: {} }; continue; }
            const d = (top[parts[0]] ||= { name: parts[0], type: "tree", object: { entries: [] } }), second = parts[1];
            if (!d.object.entries.find(e => e.name === second))
              d.object.entries.push(parts.length === 2 ? { name: second, type: "blob", object: { byteSize: Buffer.byteLength(files.get(`projects/${pid}/${r}`)) } } : { name: second, type: "tree", object: {} });
          }
          return { name: pid, type: "tree", object: { entries: Object.values(top) } };
        });
        data = { repository: { object: entries.length ? { entries } : null } }; break;
      }
      case "ProjectEntries": {
        const prefix = v.expr.split(":")[1] + "/", names = new Map();
        for (const p of repo.head().files.keys()) if (p.startsWith(prefix)) { const r = p.slice(prefix.length).split("/"); names.set(r[0], r.length > 1 ? "tree" : "blob"); }
        data = { repository: { object: names.size ? { entries: [...names].map(([name, type]) => ({ name, type })) } : null } }; break;
      }
      case "MoveSources": {
        const out = {};
        for (const k of Object.keys(v).filter(k => /^e\d+$/.test(k))) {
          const [rev, p] = [v[k].slice(0, v[k].indexOf(":")), v[k].slice(v[k].indexOf(":") + 1)], c = repo.find(rev);
          if (c && c.files.has(p)) { out["m" + k.slice(1)] = { oid: blobSha(c.files.get(p)) }; continue; }
          const kids = c ? [...c.files.keys()].filter(f => f.startsWith(p + "/") && !f.slice(p.length + 1).includes("/")) : [];
          out["m" + k.slice(1)] = kids.length ? { oid: "tree-" + p, entries: kids.map(f => ({ name: f.slice(p.length + 1), type: "blob", oid: blobSha(c.files.get(f)) })) } : null;
        }
        data = { repository: out }; break;
      }
      case "GetArticle": data = { repository: { meta: blob(repo.read(v.metaExpr)), ...ref(repo.history(v.path).map(c => ({ ...node(c), file: { object: blob(c.files.get(v.file) ?? null) } }))) } }; break;
      case "FileRevs": data = { repository: ref(repo.history(v.path, 50).map(c => ({ ...node(c), file: c.files.has(v.path) ? { object: { byteSize: Buffer.byteLength(c.files.get(v.path)) } } : null }))) }; break;
      case "Tags": data = { repository: { object: blob(repo.read(v.expr)) } }; break;
      case "IndexBlobs": case "RecentMetas": case "ReadFiles": data = { repository: metas(v) }; break;
      case "GetPage": data = { repository: { meta: blob(repo.read(v.metaExpr)), ...ref(repo.history(v.path, 1).map(c => ({ oid: c.oid }))) } }; break;
      case "ListRevs": data = { repository: ref(repo.history(v.path).map(c => ({ ...node(c), file: { object: blob(c.files.get(v.file) ?? null) } }))) }; break;
      case "GetRev": { const c = repo.find(v.sha); data = { repository: { commit: c ? node(c) : null, meta: blob(repo.read(v.metaExpr)) } }; break; }
      case "Recent": data = { repository: ref(repo.history(v.path, v.n).map(node)) }; break;
      case "SaveHead": data = { repository: { ref: { target: { oid: repo.head().oid } }, meta: blob(repo.read(v.metaExpr)) } }; break;
      case "CreateCommit": {
        const inp = v.input;
        if (opts.raceOnce && !state.raced) { state.raced = true; repo.add("Someone else committed", { "NOTES.md": "x" }, { name: "Grace", login: "grace" }); }
        if (inp.expectedHeadOid !== repo.head().oid)
          return json(route, 200, { data: { createCommitOnBranch: null }, errors: [{ type: "STALE_DATA", message: `Expected branch to point to "${inp.expectedHeadOid}" but it did not. Pull and try again.` }] });
        const changes = {};
        for (const a of inp.fileChanges.additions) changes[a.path] = Buffer.from(a.contents, "base64").toString("utf8");
        for (const d of inp.fileChanges.deletions || []) changes[d.path] = null;
        const c = repo.add(inp.message.headline + "\n\n" + inp.message.body, changes, { name: user.name, login: user.login });
        data = { createCommitOnBranch: { commit: { oid: c.oid } } }; break;
      }
      default:
        state.unexpected.push(`graphql ${op}`);
        return json(route, 500, { message: "unexpected GraphQL operation" });
    }
    return json(route, 200, { data });
  }
  return state;
}

/* A project.json for tests: projectJson({title, items, ...}) */
function projectJson(over) {
  const at = "2026-10-07T00:00:00.000Z";
  return JSON.stringify({ title: "P", description: "", tags: [], items: [], createdAt: at, createdBy: "ada", updatedAt: at, updatedBy: "ada", ...over }, null, 2) + "\n";
}
/* An article for tests, as the files of one page folder: pageFiles("p", "slug", {title, content, ...meta}) */
function pageFiles(project, slug, o = {}) {
  const content = o.content ?? "## Section\n\nSome text.\n", format = o.format || "md", at = "2026-10-07T00:00:00.000Z";
  const meta = { title: slug, tags: ["PQC"], status: "draft", format, abstract: "", revN: 1, size: Buffer.byteLength(content), sha256: crypto.createHash("sha256").update(content).digest("hex"),
    updatedAt: at, updatedBy: "ada", createdAt: at, createdBy: "ada", ...(o.meta || {}) };
  return { [`projects/${project}/pages/${slug}/content.${format}`]: content, [`projects/${project}/pages/${slug}/meta.json`]: JSON.stringify(meta, null, 2) + "\n" };
}

module.exports = { installFakeGitHub, createRepo, seedFromTemplate, projectJson, pageFiles, OWNER, REPO, WORKER };

// a 1x1 PNG, used as the "image" of previewed links in tests
module.exports.PNG_PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
