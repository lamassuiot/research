// The wiki on top of the simulated GitHub. Serial: the tests of a block share one in-memory repository.
const { test, expect } = require("@playwright/test");
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
const pageCommits = (repo, slug) => repo.history("projects/general/pages/" + slug);

test.describe("read-only account", () => {
  test("can read but sees no Edit or Create", async ({ page }) => {
    await open(page, "#/wiki/general/welcome", { permission: "read" });
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

  test("creates an article (no tags to pick)", async ({ page }) => {
    const gh = await open(page, "#/new", { repo });
    const before = repo.commits.length;
    await page.fill("#f-title", "My RFC notes");
    await page.fill("#f-abs", "Notes on a draft RFC");
    await page.fill("#f-sum", "Initial draft");
    await page.fill("#f-body", BODY1);
    await page.locator("#saveBtn").click();
    await expect(page).toHaveURL(/#\/wiki\/general\/my-rfc-notes$/);
    await expect(page.locator("h1.title")).toContainText("My RFC notes");
    expect(repo.commits.length).toBe(before + 1);
    const c = repo.head();
    expect(c.author.login).toBe("ada");
    expect(c.message).toBe(`Initial draft\n\nKnow-how-Page: my-rfc-notes\nKnow-how-Project: general\nKnow-how-Revision: 1\nKnow-how-Status: draft`);
    const meta = JSON.parse(c.files.get("projects/general/pages/my-rfc-notes/meta.json"));
    expect(meta).toMatchObject({ title: "My RFC notes", tags: [], status: "draft", format: "md",
      revN: 1, createdBy: "ada", updatedBy: "ada" });
    expect(meta).not.toHaveProperty("sha256");
    expect(meta).not.toHaveProperty("size");
    expect(meta).not.toHaveProperty("category");
    expect(c.files.get("projects/general/pages/my-rfc-notes/content.md")).toBe(BODY1);
    expect(gh.unexpected).toEqual([]);
  });

  test("edits it, shows history and diff, and restores revision 1", async ({ page }) => {
    await open(page, "#/edit/my-rfc-notes", { repo });
    await page.fill("#f-body", BODY1 + "\nSecond paragraph.\n");
    await page.fill("#f-sum", "Add a paragraph");
    await page.locator("#saveBtn").click();
    await expect(page).toHaveURL(/#\/wiki\/general\/my-rfc-notes$/);
    expect(JSON.parse(repo.head().files.get("projects/general/pages/my-rfc-notes/meta.json")).revN).toBe(2);

    const [c2, c1] = pageCommits(repo, "my-rfc-notes");
    await page.goto(`/research/#/history/my-rfc-notes`);
    await expect(page.locator("ul.special li")).toHaveCount(2);
    await expect(page.locator("ul.special")).toContainText("Add a paragraph");
    await page.goto(`/research/#/diff/my-rfc-notes/${c1.oid}/${c2.oid}`);
    await expect(page.locator("#diff")).toContainText("Second paragraph");

    page.once("dialog", d => d.accept());
    await page.goto(`/research/#/diff/my-rfc-notes/${c1.oid}/cur`);
    await page.locator("#restore").click();
    await expect(page).toHaveURL(/#\/wiki\/general\/my-rfc-notes$/);
    const head = repo.head();
    expect(JSON.parse(head.files.get("projects/general/pages/my-rfc-notes/meta.json"))).toMatchObject({ revN: 3, tags: [] });
    expect(head.files.get("projects/general/pages/my-rfc-notes/content.md")).toBe(BODY1);
    expect(head.message.split("\n")[0]).toBe("Restored revision 1");
  });

  test("a save that loses the race on main retries and makes one commit", async ({ page }) => {
    const gh = await open(page, "#/edit/my-rfc-notes", { repo, raceOnce: true });
    const mine = gh.commitsBy("ada").length;
    await page.fill("#f-body", BODY1 + "\nAfter the race.\n");
    await page.fill("#f-sum", "Edit during a race");
    await page.locator("#saveBtn").click();
    await expect(page).toHaveURL(/#\/wiki\/general\/my-rfc-notes$/);
    expect(gh.raced).toBe(true);
    expect(gh.commitsBy("ada").length).toBe(mine + 1);
    expect(repo.head().message.split("\n")[0]).toBe("Edit during a race");
    expect(JSON.parse(repo.head().files.get("projects/general/pages/my-rfc-notes/meta.json")).revN).toBe(4);
  });

  test("the change bar highlights what changed against the previous revision and walks the changes", async ({ page }) => {
    await open(page, "#/wiki/general/my-rfc-notes", { repo });
    const bar = page.locator(".chgbar");
    await expect(bar).toBeVisible();
    await expect(page.locator("#prose .chg-add, #prose .chg-mod").first()).toContainText("After the race.");
    await expect(bar.locator(".chg-n")).toHaveText("– / 1");
    const options = await bar.locator("select option").count();
    expect(options).toBe(3);                                                       // revisions 3, 2 and 1
    await bar.locator('[data-a="next"]').click();
    await expect(bar.locator(".chg-n")).toHaveText("1 / 1");
    await expect(page.locator("#prose .chg-cur")).toHaveCount(1);
    await bar.locator("select").selectOption({ index: options - 1 });              // against the first revision
    await expect(page.locator("#prose .chg-add, #prose .chg-mod").first()).toBeVisible();
    await bar.locator('[data-a="toggle"]').click();
    await expect(page.locator("#prose .chg-add, #prose .chg-mod, #prose .chg-ghost")).toHaveCount(0);
    await bar.locator('[data-a="toggle"]').click();
    await expect(bar.locator("select")).toBeVisible();
  });

  test("an edited paragraph is diffed inline, word by word, in green and red", async ({ page }) => {
    await open(page, "#/edit/my-rfc-notes", { repo });
    const body = await page.inputValue("#f-body");
    await page.fill("#f-body", body.replace("bigger than ECDSA ones", "much larger than ECDSA keys"));
    await page.fill("#f-sum", "Reword");
    await page.locator("#saveBtn").click();
    await expect(page).toHaveURL(/#\/wiki\/general\/my-rfc-notes$/);
    const p = page.locator("#prose p.chg-mod");
    await expect(p).toHaveCount(1);
    expect((await p.locator("ins.chg-ins").allTextContents()).join("")).toContain("larger");
    expect((await p.locator("ins.chg-ins").allTextContents()).join("")).toContain("much");
    await expect(p.locator("del.chg-del").first()).toContainText("bigger");
    await expect(p).toContainText("ML-DSA signatures are");                         // the unchanged words stay as they are
  });

  test("lists and tables are diffed item by item and row by row; rewrites read as one removed and one added span", async ({ page }) => {
    const V1 = "## 9.6 OCSP\n\n1. Resolve the CA from `CertID`.\n2. Look up the certificate with `SelectByIssuerAndSerial(ca.id, serial)`. This replaces the global serial lookup; serials are only unique per issuer.\n3. Old step that goes away.\n4. Sign with the CA's key.\n\n| Field | Value |\n|---|---|\n| hashAlgorithm | SHA-1 |\n| nonce | optional |\n| obsolete | row |\n";
    const V2 = "## 9.6 OCSP\n\n1. Resolve the CA from `CertID`.\n2. Look up the certificate with `SelectByIssuerAndSerial(ca.id, serial)`. Although the serial is globally unique, it must belong to the CA resolved from `CertID`; a certificate issued by another CA must not be returned for that request.\n3. Sign with the CA's key.\n\n| Field | Value |\n|---|---|\n| hashAlgorithm | SHA-256 |\n| nonce | optional |\n";
    await open(page, "#/new", { repo });
    await page.fill("#f-title", "OCSP diff"); await page.fill("#f-sum", "v1"); await page.fill("#f-body", V1);
    await page.locator("#saveBtn").click();
    await expect(page).toHaveURL(/#\/wiki\/general\/ocsp-diff$/);
    await page.goto("/research/#/edit/ocsp-diff");
    await page.fill("#f-body", V2); await page.fill("#f-sum", "v2"); await page.locator("#saveBtn").click();
    await expect(page).toHaveURL(/#\/wiki\/general\/ocsp-diff$/);
    const li = page.locator("#prose ol > li.chg-mod");
    await expect(li).toHaveCount(1);
    await expect(page.locator("#prose ol")).not.toHaveClass(/chg-/);                 // the list itself is not marked, only its item
    await expect(li.locator("del.chg-del")).toHaveCount(1);
    await expect(li.locator("del.chg-del")).toHaveText("This replaces the global serial lookup; serials are only unique per issuer.");
    expect((await li.locator("ins.chg-ins").allTextContents()).join("")).toBe("Although the serial is globally unique, it must belong to the CA resolved from CertID; a certificate issued by another CA must not be returned for that request.");
    await expect(page.locator("#prose ol > li.chg-ghost")).toContainText("Old step that goes away.");
    const row = page.locator("#prose table tr.chg-mod");
    await expect(row).toHaveCount(1);
    await expect(row.locator("td").nth(1).locator("ins.chg-ins")).toHaveText("SHA-256");
    await expect(row.locator("td").nth(0).locator("ins, del")).toHaveCount(0);
    await expect(page.locator("#prose table tbody > tr.chg-ghost")).toContainText("obsolete · row");
    await expect(page.locator(".chgbar .chg-n")).toHaveText("– / 3");                 // the item and the removed one are one change; the row, the removed row
    await page.screenshot({ path: "/tmp/claude-1000/-home-ubuntu-dev-lamassu-lama-library/a633621d-1269-478a-a134-b5b7f7015251/scratchpad/ocsp-diff.png", fullPage: true });
  });

  test("selectors are shadcn-style listboxes: mouse and keyboard, and the native value follows", async ({ page }) => {
    await open(page, "#/wiki/general/my-rfc-notes", { repo });
    const btn = page.locator(".chgbar .ui-select-btn");
    await btn.click();
    const opts = page.locator(".ui-select-pop [role=option]");
    expect(await opts.count()).toBeGreaterThan(1);
    await expect(opts.first()).toHaveAttribute("aria-selected", "true");
    await opts.nth(1).click();
    await expect(page.locator(".ui-select-pop")).toHaveCount(0);
    expect(await page.locator(".chgbar select").evaluate(s => s.selectedIndex)).toBe(1);
    await expect(btn).toContainText(/rev \d/);
    await btn.focus(); await page.keyboard.press("ArrowDown");                    // opens
    await expect(page.locator(".ui-select-pop")).toBeVisible();
    await page.keyboard.press("Home"); await page.keyboard.press("Enter");
    expect(await page.locator(".chgbar select").evaluate(s => s.selectedIndex)).toBe(0);
    await btn.click(); await page.keyboard.press("Escape");
    await expect(page.locator(".ui-select-pop")).toHaveCount(0);
  });

  test("a large HTML report is saved and shown in a sandboxed iframe", async ({ page }) => {
    await open(page, "#/new", { repo });
    await page.fill("#f-title", "Big report");
   
    await page.locator('[data-f="html"]').click();
    const html = `<h1 id="top">Big report</h1><script>document.title="x"</script><!-- ${"a".repeat(450000)} -->`;
    await page.fill("#f-body", html);
    await page.fill("#f-sum", "Add the report");
    await page.locator("#saveBtn").click();
    await expect(page).toHaveURL(/#\/wiki\/general\/big-report$/);
    expect(repo.head().files.get("projects/general/pages/big-report/content.html")).toBe(html);
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
    await expect(page.locator("#main li", { hasText: "PQC" })).toContainText("1 article");
    await expect(page.locator("#main li", { hasText: "PKI" })).toContainText("0 articles");
    await page.goto("/research/#/tag/PQC");
    await expect(page.locator("#main")).toContainText("PQC migration notes");
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
    await open(page, "#/wiki/general/welcome");
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
    await open(page, "#/wiki/general/welcome");
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

test.describe("article facts", () => {
  test("shows maturity, tags, author and contributor avatars, and the last edit as relative time", async ({ page }) => {
    const repo = seedFromTemplate(createRepo());
    const m = JSON.parse(repo.head().files.get("projects/general/pages/pqc-migration-notes/meta.json"));
    for (const [who, name, n] of [["grace", "Grace Hopper", 2], ["alan", "Alan Turing", 3]]) {
      const c = repo.add(`Edit by ${name}\n\nKnow-how-Page: pqc-migration-notes\nKnow-how-Revision: ${n}`,
        { "projects/general/pages/pqc-migration-notes/meta.json": JSON.stringify({ ...m, revN: n, updatedBy: who }) }, { name, login: who });
      c.date = new Date(Date.now() - (n === 3 ? 13 : 60) * 60000).toISOString();
    }
    await open(page, "#/wiki/pqc-migration-notes", { repo });
    const box = page.locator(".infobox");
    await expect(box.locator(".badge.status")).toHaveText("Draft");
    await expect(box.locator(".sc-tags .badge")).toHaveText(["PQC", "Crypto Agility"]);
    await expect(box.locator(".sc-stack .sc-av")).toHaveCount(3);                       // creator + grace + alan
    await expect(box.locator(".sc-stack img").first()).toHaveAttribute("src", /avatars\.githubusercontent\.com\/u\/lamassu-research/);
    await expect(box.locator(".sc-stack .sc-av").nth(2)).toHaveAttribute("title", "alan · 1 edit");
    const last = box.locator(".sc-row", { hasText: "Last edit" });
    await expect(last).toContainText("alan");
    await expect(last.locator("time.ago")).toHaveText("13 minutes ago");
    await expect(last.locator("time.ago")).toHaveAttribute("title", /\d{2}:\d{2}, \d+ \w+ \d{4}/);
    await expect(last.locator("a", { hasText: "changes" })).toHaveAttribute("href", /#\/diff\/pqc-migration-notes\/[0-9a-f]{40}\/[0-9a-f]{40}$/);
    await expect(box.locator(".sc-row", { hasText: "Revision" })).toContainText("3 / 3");
  });
});
