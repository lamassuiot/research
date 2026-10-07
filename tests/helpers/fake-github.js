// A GitHub (REST + GraphQL), GitHub OAuth page and Cloudflare Worker simulated with page.route().
// Everything lives in memory; nothing leaves the machine. Any other request to github.com / api.github.com
// is answered with 500 and recorded in state.unexpected, so tests fail on calls nobody planned for.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const OWNER = "lamassuiot", REPO = "research-content";
const WORKER = "https://auth.test";
const TEMPLATE = path.resolve(__dirname, "..", "..", "content-template");
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
  for (const slug of fs.readdirSync(path.join(TEMPLATE, "pages"))) {
    const dir = path.join(TEMPLATE, "pages", slug), changes = {};
    for (const f of fs.readdirSync(dir)) changes[`pages/${slug}/${f}`] = fs.readFileSync(path.join(dir, f), "utf8");
    const meta = JSON.parse(changes[`pages/${slug}/meta.json`]);
    repo.add(`Initial version\n\nKnow-how-Page: ${slug}\nKnow-how-Revision: 1\nKnow-how-Status: ${meta.status}\nContent-SHA256: ${meta.sha256}`, changes);
  }
  return repo;
}

/* ------------------------------------------------------------------ the page.route() handlers */
async function installFakeGitHub(page, opts = {}) {
  const repo = opts.repo || seedFromTemplate(createRepo());
  const user = opts.user || { login: "ada", name: "Ada Lovelace" };
  const state = { repo, requests: [], unexpected: [], revokes: [], authorizes: [], codes: new Map(), tokens: new Set(), tokenCount: 0,
    userAt: null, raced: false, commitsBy: login => repo.commits.filter(c => c.author.login === login) };
  state.expireAll = () => state.tokens.clear();
  const perms = { admin: { admin: true, maintain: true, push: true, triage: true, pull: true }, write: { admin: false, maintain: false, push: true, triage: true, pull: true },
    read: { admin: false, maintain: false, push: false, triage: false, pull: true } };

  const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, x-github-api-version, accept", "access-control-expose-headers": "x-ratelimit-remaining, x-ratelimit-reset" };
  const json = (route, status, body, headers) => route.fulfill({ status, headers: { ...CORS, "content-type": "application/json", ...(headers || {}) }, body: JSON.stringify(body) });
  const text = (route, status, body) => route.fulfill({ status, headers: { ...CORS, "content-type": "text/plain; charset=utf-8" }, body });

  await page.route(url => ["api.github.com", "github.com", "auth.test", "avatars.githubusercontent.com", "fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname), async route => {
    const req = route.request(), url = new URL(req.url()), method = req.method();
    if (url.hostname === "fonts.googleapis.com") return route.fulfill({ status: 200, headers: { "content-type": "text/css" }, body: "" });
    if (url.hostname === "fonts.gstatic.com") return route.abort();
    if (url.hostname === "avatars.githubusercontent.com") return route.fulfill({ status: 200, headers: { "content-type": "image/gif" }, body: Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64") });
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
      if (url.pathname === "/revoke") { state.revokes.push(body.access_token); state.tokens.delete(body.access_token); return route.fulfill({ status: 204, headers: CORS }); }
      return json(route, 404, { error: "not_found" });
    }
    /* api.github.com */
    if (url.hostname === "api.github.com") {
      const token = (req.headers()["authorization"] || "").replace(/^Bearer /, "");
      if (!state.tokens.has(token)) return json(route, 401, { message: "Bad credentials" });
      if (url.pathname === "/user") { state.userAt = state.requests.length; return json(route, 200, { login: user.login, name: user.name, avatar_url: "https://avatars.githubusercontent.com/u/1" }); }
      if (url.pathname === `/repos/${OWNER}/${REPO}`) {
        const p = perms[opts.permission || "write"];
        return p ? json(route, 200, { full_name: `${OWNER}/${REPO}`, permissions: p }) : json(route, 404, { message: "Not Found" });
      }
      const m = url.pathname.match(new RegExp(`^/repos/${OWNER}/${REPO}/contents/(.+)$`));
      if (m && method === "GET") {
        const content = repo.read(`${url.searchParams.get("ref")}:${decodeURIComponent(m[1])}`);
        return content == null ? json(route, 404, { message: "Not Found" }) : text(route, 200, content);
      }
      if (url.pathname === "/graphql" && method === "POST") return graphql(route, req.postDataJSON() || {});
    }
    state.unexpected.push(`${method} ${url.href}`);
    return json(route, 500, { message: "unexpected request in the test" });
  });

  const author = c => ({ name: c.author.name, user: { login: c.author.login } });
  const node = c => ({ oid: c.oid, authoredDate: c.date, messageHeadline: c.message.split("\n")[0], message: c.message, author: author(c) });
  const blob = text => text == null ? null : { text };
  const metas = vars => Object.fromEntries(Object.keys(vars).filter(k => /^e\d+$/.test(k)).map(k => ["m" + k.slice(1), blob(repo.read(vars[k]))]));

  async function graphql(route, body) {
    const op = body.operationName, v = body.variables || {};
    state.requests[state.requests.length - 1].op = op;
    if (opts.rateLimited) return json(route, 403, { message: "rate limit" }, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 600) });
    const ref = history => ({ ref: { target: { history: { nodes: history } } } });
    let data;
    switch (op) {
      case "Tags": data = { repository: { object: blob(repo.read(v.expr)) } }; break;
      case "ListPages": {
        const names = [...new Set([...repo.head().files.keys()].filter(f => f.startsWith("pages/")).map(f => f.split("/")[1]))];
        data = { repository: { object: { entries: names.map(name => ({ name, type: "tree" })) } } }; break;
      }
      case "PageMetas": case "RecentMetas": data = { repository: metas(v) }; break;
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

module.exports = { installFakeGitHub, createRepo, seedFromTemplate, OWNER, REPO, WORKER };
