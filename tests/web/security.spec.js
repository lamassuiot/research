const { test, expect } = require("@playwright/test");
const { installFakeGitHub } = require("../helpers/fake-github");
const { watch } = require("../helpers/watch");

let w;
test.beforeEach(({ page }) => { w = watch(page); });
test.afterEach(() => w.check());

test("the CSP meta only lets the page talk to GitHub and the auth Worker", async ({ page }) => {
  w.gh = await installFakeGitHub(page);
  await page.goto("/research/");
  await expect(page.locator("h1").first()).toBeVisible();
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  const connect = csp.split(";").map(s => s.trim()).find(s => s.startsWith("connect-src"));
  expect(connect).toBe("connect-src https://api.github.com https://auth.test 'self'");
  expect(csp).toContain("worker-src 'self'");
  expect(csp).toContain("frame-src 'self' about:");
  expect(csp).toContain("default-src 'none'");
  expect(csp).not.toMatch(/img-src[^;]*https:(?!\/\/avatars)/);
});

test("the served page has no IKERLAN branding and no category left", async ({ request }) => {
  const html = await (await request.get("/research/")).text();
  // the former product's names are built at run time so this file does not contain them either
  expect(html).not.toMatch(new RegExp(["iker", "lan"].join(""), "i"));
  expect(html).not.toMatch(new RegExp(["cyber", "brain"].join(""), "i"));
  expect(html).not.toMatch(/category/i);
});

test("the build used by the tests has the client id and no dev store", async ({ request }) => {
  const html = await (await request.get("/research/")).text();
  expect(html).toContain('"githubClientId":"test-client"');
  expect(html).toContain('"devMemoryStore":false');
});
