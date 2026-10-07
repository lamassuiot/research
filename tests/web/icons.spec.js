// The icon font is a subset (frontend/icons.txt): every icon any view shows must be in it, or it would render as plain text.
const { test, expect } = require("@playwright/test");
const crypto = require("node:crypto");
const { installFakeGitHub, createRepo, seedFromTemplate } = require("../helpers/fake-github");
const { makePdf } = require("../helpers/pdf");
const { watch } = require("../helpers/watch");

test("every icon shown by every view is in the subset font", async ({ page }) => {
  const w = watch(page);
  const repo = seedFromTemplate(createRepo()), now = new Date().toISOString();
  const html = "<h2 id='a'>Report</h2><p>x</p>";
  const meta = JSON.parse(repo.head().files.get("pages/welcome/meta.json"));
  repo.add("report\n\nKnow-how-Page: report", { "pages/report/content.html": html, "pages/report/meta.json": JSON.stringify({ ...meta, title: "Report", format: "html", size: html.length, sha256: crypto.createHash("sha256").update(html).digest("hex") }) });
  const v2 = "## Changed\n\nMore text.\n";
  repo.add("second\n\nKnow-how-Page: welcome", { "pages/welcome/content.md": v2, "pages/welcome/meta.json": JSON.stringify({ ...meta, revN: 2, size: v2.length, sha256: crypto.createHash("sha256").update(v2).digest("hex") }) });
  repo.add("stuff", { "links/a.json": JSON.stringify({ url: "https://e.org/a", title: "A link", description: "d", kind: "blog", tags: ["PQC"], addedAt: now, addedBy: "ada", updatedAt: now, updatedBy: "ada" }),
    "files/spec.pdf": makePdf(["one", "two"]),
    "projects/p.json": JSON.stringify({ title: "P", description: "d", tags: ["PQC"], intro: "## Hi", createdAt: now, createdBy: "ada", updatedAt: now, updatedBy: "ada",
      items: [{ type: "page", id: "welcome", children: [{ type: "link", id: "a" }] }, { type: "file", id: "spec.pdf" }] }) });
  w.gh = await installFakeGitHub(page, { repo });
  await page.setViewportSize({ width: 1500, height: 900 });
  const list = new Set((await (await page.request.get("/research/")).text()).match(/icon_names=([^&"]+)/)[1].split(","));
  expect(list.size).toBeGreaterThan(40);
  const seen = new Map();
  const collect = async where => { for (const t of await page.locator(".ms").allTextContents()) { const k = t.trim(); if (k && !seen.has(k)) seen.set(k, where); } };
  const [c1, c2] = [repo.history("pages/welcome")[1].oid, repo.history("pages/welcome")[0].oid];
  await page.goto("/research/#/");
  await expect(page.locator(".mp-hero")).toBeVisible();
  const views = ["#/", "#/wiki/report", "#/wiki/p/welcome", "#/wiki/p", "#/wiki/p?organize=1", "#/new", "#/edit/welcome", "#/history/welcome", `#/diff/welcome/${c1}/${c2}`,
    "#/info/welcome", "#/tags", "#/tag/PQC", "#/status/draft", "#/recent", "#/search?q=text", "#/help", "#/access", "#/automation", "#/links", "#/links?edit=a", "#/files",
    "#/file/spec.pdf", "#/projects", "#/all", "#/wiki/p/welcome?rev=" + c1];
  for (const v of views) {
    await page.evaluate(h => { location.hash = h; }, v);
    await page.waitForTimeout(350);
    await collect(v);
  }
  await page.locator(".user-dd summary").click(); await collect("user menu");
  await page.locator("#themeBtn").click(); await collect("dark");
  await page.locator('details#tools summary, .tabs details summary').first().click().catch(() => {});
  await collect("tools menu");
  const missing = [...seen].filter(([k]) => !list.has(k));
  expect(missing, "icons missing from frontend/icons.txt (name, first view where it appeared)").toEqual([]);
  w.check();
});
