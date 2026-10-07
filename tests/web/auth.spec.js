// Sign-in with GitHub (simulated). Run: npm run test:web
const { test, expect } = require("@playwright/test");
const { installFakeGitHub } = require("../helpers/fake-github");
const { watch } = require("../helpers/watch");

let w;
test.beforeEach(({ page }) => { w = watch(page); });
test.afterEach(() => w.check());

async function open(page, opts, hash = "#/wiki/welcome") {
  w.gh = await installFakeGitHub(page, opts);
  await page.goto("/research/" + hash);
  return w.gh;
}

test("redirects to GitHub with state and PKCE (no scope), comes back to the same page", async ({ page }) => {
  const gh = await open(page);
  await expect(page.locator("h1.title")).toContainText("Welcome");
  expect(gh.authorizes).toHaveLength(1);
  const a = gh.authorizes[0];
  expect(a.client_id).toBe("test-client");
  expect(a.state.length).toBeGreaterThan(20);
  expect(a.code_challenge.length).toBeGreaterThan(20);
  expect(a.code_challenge_method).toBe("S256");
  expect(a.hasScope).toBe(false);
  expect(a.redirect_uri).toBe("http://127.0.0.1:8301/research/");
  expect(page.url()).toBe("http://127.0.0.1:8301/research/#/wiki/welcome");
  expect(page.url()).not.toContain("code=");
});

test("nothing is requested or painted before sign-in completes", async ({ page }) => {
  let release; const hold = new Promise(r => { release = r; });
  w.gh = await installFakeGitHub(page, { holdWorker: hold });
  await page.goto("/research/#/wiki/welcome");
  await expect(page.locator("#gate")).toBeVisible();
  await expect(page.locator("#gateT")).toHaveText("Signing in with GitHub");
  await expect(page.locator("#gateBar")).toBeVisible();                 // indeterminate progress bar...
  await expect(page.locator("#gateA")).toBeHidden();                    // ...and nothing to click
  await expect(page.locator("#gateP")).toBeHidden();
  const main = await page.locator("#main").textContent();
  expect(main).not.toContain("Welcome");
  expect(await page.locator(".top").isVisible()).toBe(false);
  expect(w.gh.requests.filter(r => r.op)).toEqual([]);
  release();
  await expect(page.locator("h1.title")).toContainText("Welcome");
  const ops = w.gh.requests.filter(r => r.path === "/graphql");
  expect(ops.length).toBeGreaterThan(0);
  expect(w.gh.requests.indexOf(ops[0])).toBeGreaterThan(w.gh.userAt - 1);
});

test("a wrong state shows an error and does not loop", async ({ page }) => {
  const gh = await open(page, { badState: true });
  await expect(page.locator("#gateT")).toHaveText("Sign-in failed");
  await expect(page.locator("#gateA")).toHaveText("Try again");
  await page.waitForTimeout(500);
  expect(gh.authorizes).toHaveLength(1);
  expect(page.url()).not.toContain("code=");
  expect(gh.requests.filter(r => r.path === "/graphql")).toHaveLength(0);
});

test("cancelling at GitHub shows an error with Try again", async ({ page }) => {
  const gh = await open(page, { denyLogin: true });
  await expect(page.locator("#gateT")).toHaveText("Sign-in failed");
  await expect(page.locator("#gateA")).toBeVisible();
  expect(gh.authorizes).toHaveLength(1);
});

test("a failing Worker shows an error and does not loop", async ({ page }) => {
  const gh = await open(page, { workerFails: true });
  await expect(page.locator("#gateT")).toHaveText("Sign-in failed");
  await page.waitForTimeout(500);
  expect(gh.authorizes).toHaveLength(1);
});

test("an account without access sees the no-access page and no content requests", async ({ page }) => {
  const gh = await open(page, { permission: "none" });
  await expect(page.locator("#gateT")).toHaveText("No access");
  await expect(page.locator("#gateP")).toContainText("@ada");
  await expect(page.locator("#gateX a")).toHaveAttribute("href", /orgs\/lamassuiot\/teams\/research-editors/);
  expect(gh.requests.filter(r => r.path === "/graphql")).toHaveLength(0);
  expect(await page.locator("#main").textContent()).not.toContain("Welcome");
});

test("the token does not survive a reload and is never stored", async ({ page }) => {
  const gh = await open(page);
  await expect(page.locator("h1.title")).toContainText("Welcome");
  const stored = await page.evaluate(() => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage }, c: document.cookie }));
  expect(stored).not.toContain("tok-");
  await page.reload();
  await expect(page.locator("h1.title")).toContainText("Welcome");
  expect(gh.authorizes).toHaveLength(2);
  expect(gh.tokenCount).toBe(2);
});

test("a 401 from the API signs in again and returns to the same page", async ({ page }) => {
  const gh = await open(page);
  await expect(page.locator("h1.title")).toContainText("Welcome");
  gh.expireAll();
  await page.evaluate(() => { location.hash = "#/tags"; });
  await expect(page.locator("h1.title")).toHaveText("Tags");
  expect(gh.authorizes).toHaveLength(2);
  expect(page.url()).toBe("http://127.0.0.1:8301/research/#/tags");
});

test("sign out revokes the token and shows the signed-out page without redirecting", async ({ page }) => {
  const gh = await open(page);
  await expect(page.locator("h1.title")).toContainText("Welcome");
  await page.locator(".user-dd summary").click();
  await page.locator('[data-act="signout"]').click();
  await expect(page.locator("#gateT")).toHaveText("You have signed out");
  await expect(page.locator("#gateBar")).toBeHidden();
  expect(gh.revokes).toHaveLength(1);
  expect(gh.revokes[0]).toMatch(/^tok-ada-/);
  await page.waitForTimeout(400);
  expect(gh.authorizes).toHaveLength(1);
});

test("after signing out, Sign in swaps itself for the progress bar and signs in again", async ({ page }) => {
  const gh = await open(page);
  await expect(page.locator("h1.title")).toContainText("Welcome");
  await page.locator(".user-dd summary").click();
  await page.locator('[data-act="signout"]').click();
  await expect(page.locator("#gateA")).toHaveText("Sign in");
  await page.locator("#gateA").click();
  await expect(page.locator("#gateA")).toBeHidden();                    // cannot be pressed twice
  await expect(page.locator(".mp-hero h1")).toContainText("Welcome to Lamassu Research");   // back on the main page
  expect(gh.authorizes).toHaveLength(2);
});
