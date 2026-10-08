// Requests per navigation. Every GitHub round trip costs ~0.6 s, so these counts are a performance budget: a change that
// makes a view ask for more must be a conscious one.
const { test, expect } = require("@playwright/test");
const { installFakeGitHub, createRepo, seedFromTemplate, projectJson, pageFiles } = require("../helpers/fake-github");
const { watch } = require("../helpers/watch");

test("round trips per navigation stay within budget", async ({ page }) => {
  const w = watch(page);
  const repo = seedFromTemplate(createRepo()), now = new Date().toISOString();
  repo.add("stuff", { "projects/mt/links/a.json": JSON.stringify({ url: "https://e.org/a", title: "A", description: "", kind: "blog", tags: ["PQC"], addedAt: now, addedBy: "ada", updatedAt: now, updatedBy: "ada" }),
    ...pageFiles("mt", "mt-page", { meta: { title: "MT page" } }),
    "projects/mt/project.json": projectJson({ title: "MT", items: [{ type: "page", id: "mt-page", children: [{ type: "link", id: "a" }] }] }) });
  const gh = w.gh = await installFakeGitHub(page, { repo });
  const ops = async fn => {
    const n0 = gh.requests.length; await fn(); await page.waitForTimeout(500);
    return gh.requests.slice(n0).filter(r => r.host === "api.github.com").map(r => r.op || r.path.replace(/^\/repos\/[^/]+\/[^/]+/, "")).sort();
  };
  const go = async (hash, ready) => { await page.evaluate(h => { location.hash = h; }, hash); await expect(page.locator(ready)).toBeVisible(); };

  // cold start: the listing is loaded ONCE (not once per view), and the home page asks for the light "recent"
  const boot = await ops(async () => { await page.goto("/research/#/"); await expect(page.locator(".mp-hero")).toBeVisible(); });
  expect(boot.filter(o => o === "Index")).toHaveLength(1);
  expect(boot.filter(o => o === "IndexBlobs")).toHaveLength(1);
  expect(boot.filter(o => /^List|^Link|^Project/.test(o))).toEqual([]);            // the old per-kind listings are gone
  expect(boot.filter(o => o === "RecentMetas")).toEqual([]);                        // home does not need per-revision metas
  expect(boot.length).toBeLessThanOrEqual(7);                                       // /user, repo, Tags, Index, IndexBlobs, Recent, (+1 spare)

  // an article: ONE GraphQL query (page + history) and the content
  expect(await ops(() => go("#/wiki/mt/mt-page", "h1.title"))).toEqual(["/contents/projects/mt/pages/mt-page/content.md", "GetArticle"].sort());
  // views that only need the listing cost nothing
  expect(await ops(() => go("#/wiki/mt", ".qa"))).toEqual([]);
  expect(await ops(() => go("#/tag/PQC", "h1.title"))).toEqual([]);
  expect(await ops(() => go("#/tags", "h1.title"))).toEqual([]);
  expect(await ops(() => go("#/links", "h1.title"))).toEqual([]);
  expect(await ops(() => go("#/projects", "h1.title"))).toEqual([]);
  // the same article again: its history and its (immutable) content are kept in memory
  expect(await ops(() => go("#/wiki/mt/mt-page", "h1.title"))).toEqual([]);
  // history and info reuse the article's query
  expect(await ops(() => go("#/history/mt-page", ".special"))).toEqual([]);

  // a write drops the caches: the next view loads the listing once more
  await go("#/edit/mt-page", "#saveBtn");
  await page.fill("#f-sum", "Edit"); await page.fill("#f-body", "## Changed\n\nText.\n");
  const save = await ops(async () => { await page.locator("#saveBtn").click(); await expect(page.locator("h1.title")).toContainText("MT page"); });
  expect(save.filter(o => o === "CreateCommit")).toHaveLength(1);
  expect(save.filter(o => o === "Index")).toHaveLength(1);
  expect(save.filter(o => o === "GetArticle")).toHaveLength(1);
  w.check();
});

test("unchanged project trees reuse the index; external changes refresh it", async ({page}) => {
  const w = watch(page), repo = seedFromTemplate(createRepo());
  const gh = w.gh = await installFakeGitHub(page, {repo});
  await page.goto("/research/#/projects");
  await expect(page.locator(".linklist")).toBeVisible();
  let start = gh.requests.length;
  await page.evaluate(() => refreshPages(true));
  expect(gh.requests.slice(start).filter(r => r.op).map(r => r.op)).toEqual(["Index"]);
  const metaPath = "projects/general/pages/welcome/meta.json";
  const m = JSON.parse(repo.head().files.get(metaPath));
  repo.add("External edit", {[metaPath]:JSON.stringify({...m, title:"External welcome", revN:m.revN+1})});
  start = gh.requests.length;
  await page.evaluate(() => refreshPages(true));
  expect(gh.requests.slice(start).filter(r => r.op).map(r => r.op)).toEqual(["Index", "IndexBlobs"]);
  expect(await page.evaluate(() => S.pages.find(p => p.slug === "welcome").title)).toBe("External welcome");
  w.check();
});

test("simultaneous content reads share a download and ETags revalidate expired bodies", async ({page}) => {
  const w = watch(page), repo = seedFromTemplate(createRepo());
  const gh = w.gh = await installFakeGitHub(page, {repo});
  await page.goto("/research/#/projects");
  await expect(page.locator(".linklist")).toBeVisible();
  await page.clock.install();
  const raw = () => gh.requests.filter(r => r.path.endsWith("/pages/welcome/content.md"));
  const values = await page.evaluate(() => Promise.all(Array.from({length:4}, () => S.store.getLatestContent("welcome", "md"))));
  expect(new Set(values).size).toBe(1); expect(raw()).toHaveLength(1);
  expect(await page.evaluate(() => S.store.getLatestContent("welcome", "md"))).toBe(values[0]);
  expect(raw()).toHaveLength(1);
  await page.clock.fastForward(31000);
  expect(await page.evaluate(() => S.store.getLatestContent("welcome", "md"))).toBe(values[0]);
  expect(raw()).toHaveLength(2); expect(raw()[1].etag).toMatch(/^"[0-9a-f]+"$/);
  repo.add("External content edit", {"projects/general/pages/welcome/content.md":"## New content\n"});
  await page.evaluate(() => refreshPages(true));
  expect(await page.evaluate(() => S.store.getLatestContent("welcome", "md"))).toBe("## New content\n");
  expect(raw()).toHaveLength(3); expect(raw()[2].etag).toBeUndefined();
  await page.evaluate(() => signOut());
  expect(await page.evaluate(() => [S.store._latest.size, S.store._content.size, S.store._rawReads.size, S.store._index])).toEqual([0,0,0,null]);
  w.check();
});

test("failed shared reads can be retried", async ({page}) => {
  const w = watch(page); w.gh = await installFakeGitHub(page);
  await page.goto("/research/#/projects"); await expect(page.locator(".linklist")).toBeVisible();
  let calls = 0;
  await page.route("https://api.github.com/**/contents/**", route => {
    calls++; return calls === 1 ? route.fulfill({status:500, headers:{"access-control-allow-origin":"*"}, body:"temporary failure"}) : route.fallback();
  });
  expect(await page.evaluate(() => S.store.getLatestContent("welcome", "md").then(() => false, () => true))).toBe(true);
  expect(await page.evaluate(() => S.store.getLatestContent("welcome", "md"))).toContain("## Maturity");
  expect(calls).toBe(2); w.check();
});

test("responses arriving after sign-out cannot refill session caches or sign in again", async ({page}) => {
  const w = watch(page); const gh = w.gh = await installFakeGitHub(page);
  await page.goto("/research/#/projects"); await expect(page.locator(".linklist")).toBeVisible();
  let release, arrived, held = 0;
  const barrier = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { arrived = resolve; });
  const wait = async () => { if(++held === 2) arrived(); await barrier; };
  await page.route("https://api.github.com/**/contents/**", async route => {
    await wait(); await route.fulfill({status:200, headers:{"access-control-allow-origin":"*"}, body:"Late private content"});
  });
  await page.route("https://api.github.com/graphql", async route => {
    if(route.request().postDataJSON().operationName !== "Index") return route.fallback();
    await wait(); await route.fulfill({status:200, headers:{"access-control-allow-origin":"*", "content-type":"application/json"},
      body:JSON.stringify({data:{repository:{object:{oid:"late-tree", entries:[]}}}})});
  });
  const pending = page.evaluate(() => Promise.all([S.store.getLatestContent("welcome", "md"), refreshPages(true)]));
  await ready; const logins = gh.authorizes.length;
  await page.evaluate(() => signOut()); release(); await pending;
  expect(await page.evaluate(() => [S.pages.length, S.store._latest.size, S.store._index])).toEqual([0,0,null]);
  expect(gh.authorizes).toHaveLength(logins); await expect(page.locator("#gate")).toBeVisible(); w.check();
});
