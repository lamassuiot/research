// Run: node --test worker/test/
const test = require("node:test");
const assert = require("node:assert/strict");

const ENV = {
  ALLOWED_ORIGIN: "https://www.lamassu.io", REDIRECT_URI: "https://www.lamassu.io/research/",
  GITHUB_CLIENT_ID: "Iv1.test", GITHUB_CLIENT_SECRET: "s3cret", CONTENT_REPO: "lamassuiot/research-content",
};
const ORIGIN = { Origin: ENV.ALLOWED_ORIGIN };
let worker;
test.before(async () => { worker = (await import("../src/index.js")).default; });

const realFetch = globalThis.fetch;
let calls;
function mockFetch(handler) {
  calls = [];
  globalThis.fetch = async (url, opt) => { calls.push({ url: String(url), opt }); return handler(String(url), opt); };
}
test.afterEach(() => { globalThis.fetch = realFetch; });

const post = (path, body, headers = ORIGIN) =>
  worker.fetch(new Request("https://research-auth.test" + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }), ENV);

test("a foreign Origin gets 403", async () => {
  const r = await post("/token", { code: "x" }, { Origin: "https://evil.example" });
  assert.equal(r.status, 403);
});
test("a missing Origin gets 403", async () => {
  const r = await post("/token", { code: "x" }, {});
  assert.equal(r.status, 403);
});
test("OPTIONS answers with the CORS headers", async () => {
  const r = await worker.fetch(new Request("https://research-auth.test/token", { method: "OPTIONS", headers: ORIGIN }), ENV);
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), ENV.ALLOWED_ORIGIN);
  assert.equal(r.headers.get("Access-Control-Allow-Methods"), "GET, POST");
  assert.equal(r.headers.get("Access-Control-Allow-Headers"), "Content-Type, Authorization");
});
test("GET gets 405", async () => {
  const r = await worker.fetch(new Request("https://research-auth.test/token", { method: "GET", headers: ORIGIN }), ENV);
  assert.equal(r.status, 405);
});
test("/token without a code gets 400", async () => {
  const r = await post("/token", {});
  assert.equal(r.status, 400);
});
test("/token sends the secret and verifier to GitHub and returns only access_token and expires_in", async () => {
  mockFetch(() => Response.json({ access_token: "ghu_abc", expires_in: 28800, refresh_token: "ghr_secret", refresh_token_expires_in: 1, scope: "", token_type: "bearer" }));
  const r = await post("/token", { code: "the-code", code_verifier: "ver" });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { access_token: "ghu_abc", expires_in: 28800 });
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), ENV.ALLOWED_ORIGIN);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://github.com/login/oauth/access_token");
  assert.deepEqual(JSON.parse(calls[0].opt.body), {
    client_id: "Iv1.test", client_secret: "s3cret", code: "the-code", code_verifier: "ver", redirect_uri: ENV.REDIRECT_URI });
});
test("a GitHub error gives 400 {error}", async () => {
  mockFetch(() => Response.json({ error: "bad_verification_code" }));
  const r = await post("/token", { code: "old" });
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { error: "bad_verification_code" });
});
test("/revoke calls DELETE with basic auth and answers 204", async () => {
  mockFetch(() => new Response(null, { status: 204 }));
  const r = await post("/revoke", { access_token: "ghu_abc" });
  assert.equal(r.status, 204);
  assert.equal(calls[0].url, "https://api.github.com/applications/Iv1.test/token");
  assert.equal(calls[0].opt.method, "DELETE");
  assert.equal(calls[0].opt.headers.Authorization, "Basic " + Buffer.from("Iv1.test:s3cret").toString("base64"));
  assert.deepEqual(JSON.parse(calls[0].opt.body), { access_token: "ghu_abc" });
});
test("/revoke answers 204 even when GitHub fails", async () => {
  mockFetch(() => { throw new Error("network down"); });
  assert.equal((await post("/revoke", { access_token: "ghu_abc" })).status, 204);
  mockFetch(() => new Response("nope", { status: 500 }));
  assert.equal((await post("/revoke", { access_token: "ghu_abc" })).status, 204);
});
test("a body over 4 KB gets 400", async () => {
  mockFetch(() => { throw new Error("must not reach GitHub"); });
  const r = await post("/token", { code: "x", pad: "a".repeat(5000) });
  assert.equal(r.status, 400);
  assert.equal(calls.length, 0);
});
test("an invalid JSON body gets 400", async () => {
  assert.equal((await post("/token", "{not json")).status, 400);
});
test("an unknown path gets 404", async () => {
  const r = await post("/nothing", {});
  assert.equal(r.status, 404);
});

/* ------------------------------------------------------------------ link previews */
const TOKEN = "ghu_" + "a".repeat(30);
const AUTH = { ...ORIGIN, Authorization: "Bearer " + TOKEN };
const PAGE = `<!doctype html><html><head><title>Fallback title</title>
  <meta property="og:title" content="Building a CA &amp; more">
  <meta content="Twelve years after &quot;Universal SSL&quot;" property="og:description">
  <meta property='og:image' content='/img/cover.png'>
  <meta property="og:site_name" content="Cloudflare Blog">
  <link rel="shortcut icon" href="https://cdn.example.org/fav.png">
  </head><body><h1>x</h1></body></html>`;
let verifyCalls;
// GitHub says: this token can (write) / can only read / cannot see the repository; any other URL is a page or an image
function web({ perm = "write", pages = {} } = {}) {
  verifyCalls = 0;
  mockFetch((url, opt) => {
    if (url.startsWith("https://api.github.com/repos/")) {
      verifyCalls++;
      if (perm === "none") return new Response("{}", { status: 404 });
      return Response.json({ permissions: perm === "write" ? { pull: true, push: true } : { pull: true, push: false } });
    }
    const hit = pages[url];
    if (!hit) return new Response("nope", { status: 404 });
    return hit(opt);
  });
}
const html = (body, extra = {}) => () => new Response(body, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", ...extra } });
const png = (bytes = 100, type = "image/png", extra = {}) => () => new Response(new Uint8Array(bytes), { status: 200, headers: { "Content-Type": type, ...extra } });
const preview = (url, headers = AUTH) => post("/preview", { url }, headers);
const img = (u, headers = AUTH) => worker.fetch(new Request("https://research-auth.test/img?u=" + encodeURIComponent(u), { method: "GET", headers }), ENV);

test("/preview reads the title, description, image, site name and icon of a page", async () => {
  web({ pages: { "https://blog.example.org/post": html(PAGE) } });
  const r = await preview("https://blog.example.org/post");
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { title: "Building a CA & more", description: 'Twelve years after "Universal SSL"',
    image: "https://blog.example.org/img/cover.png", siteName: "Cloudflare Blog", icon: "https://cdn.example.org/fav.png" });
});
test("/preview falls back to <title>, the description meta, the host name and /favicon.ico", async () => {
  web({ pages: { "https://www.example.org/": html('<head><title> Plain  page </title><meta name="description" content="Just text"></head>') } });
  assert.deepEqual(await (await preview("https://www.example.org/")).json(),
    { title: "Plain page", description: "Just text", image: "", siteName: "example.org", icon: "https://www.example.org/favicon.ico" });
});
test("/preview needs a token with write access to the content repository", async () => {
  web({ perm: "write", pages: { "https://blog.example.org/post": html(PAGE) } });
  assert.equal((await preview("https://blog.example.org/post", ORIGIN)).status, 401);                          // no token
  web({ perm: "read", pages: { "https://blog.example.org/post": html(PAGE) } });
  assert.equal((await preview("https://blog.example.org/post", { ...ORIGIN, Authorization: "Bearer " + "b".repeat(30) })).status, 403);   // read only
  web({ perm: "none", pages: {} });
  assert.equal((await preview("https://blog.example.org/post", { ...ORIGIN, Authorization: "Bearer " + "c".repeat(30) })).status, 401);   // no access at all
});
test("a token is verified once per minute, not once per request", async () => {
  web({ pages: { "https://blog.example.org/post": html(PAGE) } });
  const t = { ...ORIGIN, Authorization: "Bearer " + "d".repeat(30) };
  await preview("https://blog.example.org/post", t); await preview("https://blog.example.org/post", t); await preview("https://blog.example.org/post", t);
  assert.equal(verifyCalls, 1);
});
test("only public http(s) pages are fetched: no local or internal addresses, credentials, odd ports or other schemes", async () => {
  web({ pages: {} });
  for (const bad of ["http://localhost/", "http://127.0.0.1/", "http://10.0.0.5/x", "http://169.254.169.254/latest/meta-data", "http://[::1]/", "http://intranet/",
    "http://wiki.internal/", "http://nas.local/", "ftp://example.org/x", "file:///etc/passwd", "javascript:alert(1)", "https://user:pw@example.org/", "https://example.org:8443/", "not a url"]) {
    assert.equal((await preview(bad)).status, 400, bad);
  }
  assert.equal(calls.filter(c => !c.url.startsWith("https://api.github.com")).length, 0);                       // nothing was fetched
});
test("a redirect to an internal address is not followed", async () => {
  web({ pages: { "https://short.example.org/x": () => new Response(null, { status: 302, headers: { Location: "http://169.254.169.254/latest/meta-data" } }) } });
  assert.equal((await preview("https://short.example.org/x")).status, 502);
  assert.equal(calls.filter(c => c.url.includes("169.254")).length, 0);
});
test("a safe redirect is followed (up to three hops), and the relative image is resolved against the final page", async () => {
  web({ pages: {
    "https://short.example.org/x": () => new Response(null, { status: 301, headers: { Location: "https://blog.example.org/final/post" } }),
    "https://blog.example.org/final/post": html('<head><meta property="og:image" content="cover.jpg"><meta property="og:title" content="T"></head>') } });
  assert.equal((await (await preview("https://short.example.org/x")).json()).image, "https://blog.example.org/final/cover.jpg");
});
test("/preview refuses things that are not web pages, and unreachable pages", async () => {
  web({ pages: { "https://blog.example.org/file.pdf": () => new Response("%PDF", { status: 200, headers: { "Content-Type": "application/pdf" } }) } });
  assert.equal((await preview("https://blog.example.org/file.pdf")).status, 422);
  assert.equal((await preview("https://blog.example.org/missing")).status, 502);
});
test("/preview reads only the head of a page, and never more than 512 KB", async () => {
  let pulled = 0;
  const big = new ReadableStream({ pull(c) { pulled += 64 * 1024; c.enqueue(new TextEncoder().encode("<!-- " + "a".repeat(64 * 1024 - 10) + " -->")); if (pulled > 5e6) c.close(); } });
  web({ pages: { "https://blog.example.org/big": () => new Response(big, { status: 200, headers: { "Content-Type": "text/html" } }) } });
  const r = await preview("https://blog.example.org/big");
  assert.equal(r.status, 200);
  assert.ok(pulled <= 1024 * 1024, "read " + pulled);
});
test("an unusable image or icon address is dropped (only public http(s) ones are kept)", async () => {
  web({ pages: { "https://blog.example.org/p": html('<head><meta property="og:image" content="http://192.168.1.1/x.png"><link rel="icon" href="javascript:alert(1)"></head>') } });
  const j = await (await preview("https://blog.example.org/p")).json();
  assert.equal(j.image, ""); assert.equal(j.icon, "https://blog.example.org/favicon.ico");
});

test("/img serves an image through the Worker, with safe headers", async () => {
  web({ pages: { "https://cdn.example.org/cover.png": png(1234) } });
  const r = await img("https://cdn.example.org/cover.png");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Content-Type"), "image/png");
  assert.equal((await r.arrayBuffer()).byteLength, 1234);
  assert.equal(r.headers.get("X-Content-Type-Options"), "nosniff");
  assert.match(r.headers.get("Content-Security-Policy"), /default-src 'none'/);
  assert.match(r.headers.get("Cache-Control"), /max-age=86400/);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), ENV.ALLOWED_ORIGIN);
});
test("/img needs a token with access to the repository (readers are enough)", async () => {
  web({ perm: "read", pages: { "https://cdn.example.org/cover.png": png() } });
  assert.equal((await img("https://cdn.example.org/cover.png", ORIGIN)).status, 401);
  assert.equal((await img("https://cdn.example.org/cover.png", { ...ORIGIN, Authorization: "Bearer " + "e".repeat(30) })).status, 200);
  web({ perm: "none", pages: { "https://cdn.example.org/cover.png": png() } });
  assert.equal((await img("https://cdn.example.org/cover.png", { ...ORIGIN, Authorization: "Bearer " + "f".repeat(30) })).status, 401);
});
test("/img refuses non-images, SVG, huge images and unsafe addresses", async () => {
  web({ pages: {
    "https://cdn.example.org/page.html": html("<html>"), "https://cdn.example.org/logo.svg": png(10, "image/svg+xml"),
    "https://cdn.example.org/huge.png": png(10, "image/png", { "Content-Length": String(5 * 1024 * 1024) }),
    "https://cdn.example.org/huge2.png": png(4 * 1024 * 1024) } });
  assert.equal((await img("https://cdn.example.org/page.html")).status, 415);
  assert.equal((await img("https://cdn.example.org/logo.svg")).status, 415);
  assert.equal((await img("https://cdn.example.org/huge.png")).status, 413);
  assert.equal((await img("https://cdn.example.org/huge2.png")).status, 413);
  assert.equal((await img("http://127.0.0.1/x.png")).status, 400);
  assert.equal((await img("https://nas.local/x.png")).status, 400);
  assert.equal((await img("https://cdn.example.org/missing.png")).status, 502);
});
test("/img and /preview only answer the allowed origin, and OPTIONS allows the Authorization header", async () => {
  web({ pages: { "https://cdn.example.org/cover.png": png() } });
  assert.equal((await img("https://cdn.example.org/cover.png", { Origin: "https://evil.example", Authorization: "Bearer " + TOKEN })).status, 403);
  const r = await worker.fetch(new Request("https://research-auth.test/img", { method: "OPTIONS", headers: ORIGIN }), ENV);
  assert.equal(r.status, 204);
  assert.match(r.headers.get("Access-Control-Allow-Headers"), /Authorization/);
  assert.match(r.headers.get("Access-Control-Allow-Methods"), /GET/);
});
