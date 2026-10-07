// The wiki on top of the simulated GitHub. Serial: the tests of a block share one in-memory repository.
const { test, expect } = require("@playwright/test");
const crypto = require("node:crypto");
const { installFakeGitHub, createRepo, seedFromTemplate } = require("../helpers/fake-github");
const { watch } = require("../helpers/watch");

let w;
test.beforeEach(({ page }) => { w = watch(page); });
test.afterEach(() => w.check());

async function open(page, hash, opts) {
  w.gh = await installFakeGitHub(page, opts);
  await page.goto("/research/" + hash);
  await expect(page.locator("#gate")).toBeHidden();
  return w.gh;
}
const chip = (page, name) => page.locator(".tagchip", { hasText: new RegExp("^" + name + "$") }).locator("span").first();
const pageCommits = (repo, slug) => repo.history("pages/" + slug);

test.describe("read-only account", () => {
  test("can read but sees no Edit or Create", async ({ page }) => {
    await open(page, "#/wiki/welcome", { permission: "read" });
    await expect(page.locator("h1.title")).toContainText("Welcome");
    await expect(page.locator("#newBtn")).toBeHidden();
    await expect(page.locator(".tabs a", { hasText: /^Edit$/ })).toHaveCount(0);
    await expect(page.locator(".user-dd summary")).toContainText("Ada");
  });
});

test.describe("editor", () => {
  test.describe.configure({ mode: "serial" });
  const repo = seedFromTemplate(createRepo());
  const BODY1 = "## Findings\n\nML-DSA signatures are bigger than ECDSA ones.\n";

  test("creates an article with two tags (and not without tags)", async ({ page }) => {
    const gh = await open(page, "#/new", { repo });
    const before = repo.commits.length;
    await page.fill("#f-title", "My RFC notes");
    await page.fill("#f-abs", "Notes on a draft RFC");
    await page.fill("#f-sum", "Initial draft");
    await page.fill("#f-body", BODY1);
    await page.locator("#saveBtn").click();
    await expect(page.locator("#tags-err")).toBeVisible();
    expect(repo.commits.length).toBe(before);
    await chip(page, "PQC").click();
    await chip(page, "Lamassu RFCs").click();
    await page.locator("#saveBtn").click();
    await expect(page).toHaveURL(/#\/wiki\/my-rfc-notes$/);
    await expect(page.locator("h1.title")).toContainText("My RFC notes");
    expect(repo.commits.length).toBe(before + 1);
    const c = repo.head();
    expect(c.author.login).toBe("ada");
    expect(c.message).toBe(`Initial draft\n\nKnow-how-Page: my-rfc-notes\nKnow-how-Revision: 1\nKnow-how-Status: draft\nContent-SHA256: ${crypto.createHash("sha256").update(BODY1).digest("hex")}`);
    const meta = JSON.parse(c.files.get("pages/my-rfc-notes/meta.json"));
    expect(meta).toMatchObject({ title: "My RFC notes", tags: ["Lamassu RFCs", "PQC"], status: "draft", format: "md",
      revN: 1, size: Buffer.byteLength(BODY1), createdBy: "ada", updatedBy: "ada" });
    expect(meta.sha256).toBe(crypto.createHash("sha256").update(BODY1).digest("hex"));
    expect(meta).not.toHaveProperty("category");
    expect(c.files.get("pages/my-rfc-notes/content.md")).toBe(BODY1);
    expect(gh.unexpected).toEqual([]);
  });

  test("edits it, shows history and diff, and restores revision 1", async ({ page }) => {
    await open(page, "#/edit/my-rfc-notes", { repo });
    await page.fill("#f-body", BODY1 + "\nSecond paragraph.\n");
    await page.fill("#f-sum", "Add a paragraph");
    await page.locator("#saveBtn").click();
    await expect(page).toHaveURL(/#\/wiki\/my-rfc-notes$/);
    expect(JSON.parse(repo.head().files.get("pages/my-rfc-notes/meta.json")).revN).toBe(2);

    const [c2, c1] = pageCommits(repo, "my-rfc-notes");
    await page.goto(`/research/#/history/my-rfc-notes`);
    await expect(page.locator("ul.special li")).toHaveCount(2);
    await expect(page.locator("ul.special")).toContainText("Add a paragraph");
    await page.goto(`/research/#/diff/my-rfc-notes/${c1.oid}/${c2.oid}`);
    await expect(page.locator("#diff")).toContainText("Second paragraph");

    page.once("dialog", d => d.accept());
    await page.goto(`/research/#/diff/my-rfc-notes/${c1.oid}/cur`);
    await page.locator("#restore").click();
    await expect(page).toHaveURL(/#\/wiki\/my-rfc-notes$/);
    const head = repo.head();
    expect(JSON.parse(head.files.get("pages/my-rfc-notes/meta.json"))).toMatchObject({ revN: 3, tags: ["Lamassu RFCs", "PQC"] });
    expect(head.files.get("pages/my-rfc-notes/content.md")).toBe(BODY1);
    expect(head.message.split("\n")[0]).toBe("Restored revision 1");
  });

  test("a save that loses the race on main retries and makes one commit", async ({ page }) => {
    const gh = await open(page, "#/edit/my-rfc-notes", { repo, raceOnce: true });
    const mine = gh.commitsBy("ada").length;
    await page.fill("#f-body", BODY1 + "\nAfter the race.\n");
    await page.fill("#f-sum", "Edit during a race");
    await page.locator("#saveBtn").click();
    await expect(page).toHaveURL(/#\/wiki\/my-rfc-notes$/);
    expect(gh.raced).toBe(true);
    expect(gh.commitsBy("ada").length).toBe(mine + 1);
    expect(repo.head().message.split("\n")[0]).toBe("Edit during a race");
    expect(JSON.parse(repo.head().files.get("pages/my-rfc-notes/meta.json")).revN).toBe(4);
  });

  test("a large HTML report is saved and shown in a sandboxed iframe", async ({ page }) => {
    await open(page, "#/new", { repo });
    await page.fill("#f-title", "Big report");
    await chip(page, "CBOM").click();
    await page.locator('[data-f="html"]').click();
    const html = `<h1 id="top">Big report</h1><script>document.title="x"</script><!-- ${"a".repeat(450000)} -->`;
    await page.fill("#f-body", html);
    await page.fill("#f-sum", "Add the report");
    await page.locator("#saveBtn").click();
    await expect(page).toHaveURL(/#\/wiki\/big-report$/);
    expect(repo.head().files.get("pages/big-report/content.html")).toBe(html);
    expect(Buffer.byteLength(html)).toBeGreaterThan(400000);
    const sandbox = await page.locator("#rf").getAttribute("sandbox");
    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).not.toContain("allow-same-origin");
    await expect(page.frameLocator("#rf").locator("h1")).toHaveText("Big report");
  });

  test("tags page, tag page, home and recent changes", async ({ page }) => {
    await open(page, "#/tags", { repo });
    await expect(page.locator("#main h1.title")).toHaveText("Tags");
    const names = await page.locator("#main ul li a").allTextContents();
    expect(names.slice(0, 10)).toEqual(["Lamassu", "PKI", "X509", "Lamassu RFCs", "IETF RFCs", "PQC", "CBOM", "Updates", "RATs", "Crypto Agility"]);
    await expect(page.locator("#main li", { hasText: "PQC" })).toContainText("2 articles");
    await expect(page.locator("#main li", { hasText: "PKI" })).toContainText("0 articles");
    await page.goto("/research/#/tag/PQC");
    await expect(page.locator("#main")).toContainText("PQC migration notes");
    await expect(page.locator("#main")).toContainText("My RFC notes");
    await page.goto("/research/#/");
    await expect(page.locator(".mp-box h2", { hasText: "Browse by tag" })).toBeVisible();
    await page.goto("/research/#/recent");
    await expect(page.locator("#main")).toContainText("Add the report");
  });

  test("full-text search finds a word that is only in the content", async ({ page }) => {
    await open(page, "#/search?q=Superseded", { repo });
    await expect(page.locator("#sr")).toContainText("Welcome");
  });
});

test.describe("phone and dark mode", () => {
  test.use({ viewport: { width: 390, height: 800 }, colorScheme: "dark" });
  test("the article fits a phone and the menu opens", async ({ page }) => {
    await open(page, "#/wiki/welcome");
    await expect(page.locator("h1.title")).toContainText("Welcome");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.locator("#menuBtn").click();
    await expect(page.locator("#side")).toHaveClass(/open/);
    await expect(page.locator("#sideTags")).toContainText("PQC");
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe("rgb(17, 17, 17)");
  });
});

test.describe("theme toggle", () => {
  test.use({ colorScheme: "light" });
  test("switches between light and dark and remembers the choice", async ({ page }) => {
    await open(page, "#/wiki/welcome");
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(await bg()).toBe("rgb(244, 244, 244)");
    await page.locator("#themeBtn").click();
    expect(await bg()).toBe("rgb(17, 17, 17)");
    expect(await page.locator("html").getAttribute("data-theme")).toBe("dark");
    await page.reload();
    await expect(page.locator("h1.title")).toContainText("Welcome");
    expect(await bg()).toBe("rgb(17, 17, 17)");
    await page.locator("#themeBtn").click();
    expect(await bg()).toBe("rgb(244, 244, 244)");
  });
});
