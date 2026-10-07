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
