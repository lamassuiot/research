// Run: node --test worker/test/
const test = require("node:test");
const assert = require("node:assert/strict");

const ENV = {
  ALLOWED_ORIGIN: "https://www.lamassu.io", REDIRECT_URI: "https://www.lamassu.io/research/",
  GITHUB_CLIENT_ID: "Iv1.test", GITHUB_CLIENT_SECRET: "s3cret",
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
  assert.equal(r.headers.get("Access-Control-Allow-Methods"), "POST");
  assert.equal(r.headers.get("Access-Control-Allow-Headers"), "Content-Type");
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
