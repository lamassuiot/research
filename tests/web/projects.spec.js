// Projects: containers whose structure is one JSON tree (projects/<id>.json). Serial: one shared in-memory repository.
const { test, expect } = require("@playwright/test");
const { installFakeGitHub, createRepo, seedFromTemplate } = require("../helpers/fake-github");
const { makePdf } = require("../helpers/pdf");
const { watch } = require("../helpers/watch");

let w;
test.beforeEach(({ page }) => { w = watch(page); });
test.afterEach(() => w.check());
test.describe.configure({ mode: "serial" });
const repo = seedFromTemplate(createRepo());
const project = id => JSON.parse(repo.head().files.get(`projects/${id}.json`));
const items = id => project(id).items;

async function open(page, hash, opts) {
  w.gh = await installFakeGitHub(page, { repo, ...opts });
  await page.goto("/research/" + hash);
  await expect(page.locator("#gate")).toBeHidden();
}
const chip = (page, name) => page.locator(".tagchip", { hasText: new RegExp("^" + name + "$") }).locator("span").first();
async function newPage(page, hash, title, tag = "PKI") {
  await open(page, hash);
  await page.fill("#f-title", title); await chip(page, tag).click();
  await page.fill("#f-sum", "Create " + title); await page.fill("#f-body", `## ${title}\n\nBody.\n`);
  await page.locator("#saveBtn").click();
}

test("creates a project (a container, no content of its own)", async ({ page }) => {
  await open(page, "#/projects");
  await expect(page.locator(".empty")).toContainText("No projects yet");
  await page.fill("#np-title", "Lamassu CA");
  await expect(page.locator("#np-slug")).toHaveText("#/wiki/lamassu-ca");
  await page.fill("#np-desc", "Design of the CA");
  await page.locator("#np-btn").click();
  await expect(page).toHaveURL(/#\/wiki\/lamassu-ca$/);
  await expect(page.locator("h1.title")).toContainText("Lamassu CA");
  expect(repo.head().message).toBe("Add project: Lamassu CA\n\nKnow-how-Project: lamassu-ca");
  expect(project("lamassu-ca")).toMatchObject({ title: "Lamassu CA", description: "Design of the CA", items: [], createdBy: "ada" });
  await expect(page.locator(".empty")).toContainText("This project is empty");
});

test("adds a page to a project in one commit; its address is Project/Page", async ({ page }) => {
  await newPage(page, "#/new?project=lamassu-ca", "Design");
  await expect(page).toHaveURL(/#\/wiki\/lamassu-ca\/design$/);
  const c = repo.head();
  expect(c.message.split("\n")[0]).toBe("Create Design");
  expect(c.files.has("pages/design/meta.json")).toBe(true);           // the page and the project tree change together
  expect(items("lamassu-ca")).toEqual([{ type: "page", id: "design" }]);
  await expect(page.locator(".crumbs")).toContainText("Lamassu CA");
  await expect(page.locator(".infobox")).toContainText("Lamassu CA");
});

test("sub-pages nest: Project/Parent/Child, with breadcrumbs", async ({ page }) => {
  await newPage(page, "#/new?project=lamassu-ca&parent=design", "Key ceremony", "X509");
  await expect(page).toHaveURL(/#\/wiki\/lamassu-ca\/design\/key-ceremony$/);
  expect(items("lamassu-ca")).toEqual([{ type: "page", id: "design", children: [{ type: "page", id: "key-ceremony" }] }]);
  await expect(page.locator(".crumbs a")).toHaveText(["Projects", "Lamassu CA", "Design"]);
  await page.locator(".crumbs a", { hasText: "Design" }).click();
  await expect(page).toHaveURL(/#\/wiki\/lamassu-ca\/design$/);
  await expect(page.locator(".subpages")).toContainText("Key ceremony");
  await expect(page.locator(".subpages a", { hasText: "Add sub-page" })).toHaveAttribute("href", "#/new?project=lamassu-ca&parent=design");
});

test("old short addresses redirect to the canonical one", async ({ page }) => {
  await open(page, "#/wiki/key-ceremony");
  await expect(page).toHaveURL(/#\/wiki\/lamassu-ca\/design\/key-ceremony$/);
  await expect(page.locator("h1.title")).toContainText("Key ceremony");
  await page.goto("/research/#/wiki/wrong-project/key-ceremony");
  await expect(page).toHaveURL(/#\/wiki\/lamassu-ca\/design\/key-ceremony$/);
});

test("adds a link and a PDF to the project, under a page", async ({ page }) => {
  await open(page, "#/links?new=1&project=lamassu-ca&parent=design");
  await expect(page.locator(".addlink")).toContainText("added to the project Lamassu CA");
  await page.fill("#l-url", "https://example.org/ca-design"); await page.fill("#l-title", "CA design post");
  await page.locator(".addlink .tagchip", { hasText: /^PKI$/ }).locator("span").first().click();
  await page.locator("#l-save").click();
  await expect(page).toHaveURL(/#\/wiki\/lamassu-ca\/design$/);
  expect(repo.head().files.has("links/ca-design-post.json")).toBe(true);

  await page.goto("/research/#/files?project=lamassu-ca");
  await expect(page.locator("#upf")).toBeVisible();
  await page.setInputFiles("#up-file", { name: "CA Spec.pdf", mimeType: "application/pdf", buffer: makePdf(["CA spec"]) });
  await page.fill("#up-sum", "Add CA spec"); await page.locator("#up-btn").click();
  await expect(page).toHaveURL(/#\/wiki\/lamassu-ca$/);
  expect(items("lamassu-ca")).toEqual([
    { type: "page", id: "design", children: [{ type: "page", id: "key-ceremony" }, { type: "link", id: "ca-design-post" }] },
    { type: "file", id: "ca-spec.pdf" }]);
  await expect(page.locator("#main .ptree a", { hasText: "CA design post" })).toHaveAttribute("target", "_blank");
  await expect(page.locator("#main .ptree a", { hasText: "ca-spec.pdf" })).toHaveAttribute("href", "#/file/ca-spec.pdf");
});

test("the sidebar shows the project tree while reading inside it", async ({ page }) => {
  await open(page, "#/wiki/lamassu-ca/design/key-ceremony");
  const side = page.locator("#sideProject");
  await expect(side).toBeVisible();
  await expect(page.locator("#sideProjHead #sideProjectT")).toContainText("Lamassu CA");
  await expect(side.locator("a.cur")).toHaveText("Key ceremony");
  await expect(side).toContainText("CA design post");
  await page.goto("/research/#/tags");
  await expect(side).toBeHidden();
});

test("organize: reorder, outdent, indent and remove are single commits that only touch the project file", async ({ page }) => {
  await open(page, "#/wiki/lamassu-ca?organize=1");
  const before = repo.commits.length;
  const act = (op, id) => page.locator(`[data-op="${op}"][data-id="${id}"]`).click();
  await act("down", "design");                                                  // design moves below ca-spec.pdf
  await expect.poll(() => items("lamassu-ca")[0].id).toBe("ca-spec.pdf");
  await act("out", "key-ceremony");                                             // becomes a sibling of design
  await expect.poll(() => items("lamassu-ca").map(i => i.id)).toEqual(["ca-spec.pdf", "design", "key-ceremony"]);
  await act("in", "key-ceremony");                                              // back under design
  await expect.poll(() => JSON.stringify(items("lamassu-ca")[1].children.map(i => i.id))).toContain("key-ceremony");
  await act("rm", "ca-spec.pdf");
  await expect.poll(() => items("lamassu-ca").map(i => i.id)).toEqual(["design"]);
  expect(repo.commits.length).toBe(before + 4);
  for (const c of repo.commits.slice(before)) expect([...c.changed]).toEqual(["projects/lamassu-ca.json"]);
  expect(repo.head().message).toBe("Remove from project: Lamassu CA\n\nKnow-how-Project: lamassu-ca");
  expect(repo.head().files.has("files/ca-spec.pdf")).toBe(true);                // the file itself is not deleted
});

test("an item removed from a project can be added to another one", async ({ page }) => {
  await open(page, "#/projects");
  await page.fill("#np-title", "Research"); await page.locator("#np-btn").click();
  await expect(page).toHaveURL(/#\/wiki\/research$/);
  await page.locator(".addlink summary", { hasText: "Add existing items" }).click();
  const opts = await page.locator("#ae-item option").allTextContents();
  expect(opts).toContain("ca-spec.pdf");
  expect(opts).not.toContain("Design");                                         // already in Lamassu CA
  await page.selectOption("#ae-item", "file:ca-spec.pdf");
  await page.locator("#aef button[type=submit]").click();
  await expect(page.locator("#main .ptree a", { hasText: "ca-spec.pdf" })).toBeVisible();
  expect(items("research")).toEqual([{ type: "file", id: "ca-spec.pdf" }]);
});

test("addresses cannot clash between projects and articles", async ({ page }) => {
  await open(page, "#/projects");
  const before = repo.commits.length;
  await page.fill("#np-title", "Welcome"); await page.locator("#np-btn").click();       // an article called welcome exists
  await expect(page.locator("#toast")).toContainText("already used");
  await open(page, "#/new");
  await page.fill("#f-title", "Research"); await chip(page, "PKI").click();               // a project called research exists
  await page.fill("#f-sum", "x"); await page.fill("#f-body", "x"); await page.locator("#saveBtn").click();
  await expect(page.locator("#toast")).toContainText("already used");
  expect(repo.commits.length).toBe(before);
});

test("edit and delete a project; its items are kept", async ({ page }) => {
  await open(page, "#/wiki/research");
  await page.locator(".addlink summary", { hasText: "Edit project" }).click();
  await page.fill("#ep-title", "Research notes"); await page.locator("#epf button[type=submit]").click();
  await expect(page.locator("h1.title")).toContainText("Research notes");
  expect(repo.head().message.split("\n")[0]).toBe("Edit project: Research notes");
  page.once("dialog", d => d.accept());
  await page.locator(".addlink summary", { hasText: "Edit project" }).click();
  await page.locator("#ep-del").click();
  await expect(page).toHaveURL(/#\/projects$/);
  expect(repo.head().files.has("projects/research.json")).toBe(false);
  expect(repo.head().files.has("files/ca-spec.pdf")).toBe(true);
});

test("a reader sees projects but no controls", async ({ page }) => {
  await open(page, "#/wiki/lamassu-ca?organize=1", { permission: "read" });
  await expect(page.locator("#main .ptree").first()).toContainText("Design");
  await expect(page.locator(".pt-ctl")).toHaveCount(0);
  await expect(page.locator(".pt-add")).toHaveCount(0);
  await expect(page.locator(".addlink")).toHaveCount(0);
  await page.goto("/research/#/projects");
  await expect(page.locator("#npf")).toHaveCount(0);
});

test("the home page lists the projects", async ({ page }) => {
  await open(page, "#/");
  await expect(page.locator(".mp-box h2", { hasText: "Projects" })).toBeVisible();
  await expect(page.locator(".mp-box a", { hasText: "Lamassu CA" })).toHaveAttribute("href", "#/wiki/lamassu-ca");
});

test.describe("project tags and project mode", () => {
  test("a project can have tags; a tagged project is indexed instead of its pages", async ({ page }) => {
    await open(page, "#/projects");
    await page.fill("#np-title", "PQC programme");
    await page.locator("#npf .tagchip", { hasText: /^PQC$/ }).locator("span").first().click();
    await page.locator("#np-btn").click();
    await expect(page).toHaveURL(/#\/wiki\/pqc-programme$/);
    expect(project("pqc-programme").tags).toEqual(["PQC"]);
    await expect(page.locator(".pr-tags .badge")).toHaveText(["PQC"]);
    // the article "PQC migration notes" is tagged PQC; once it sits in the tagged project it is no longer listed under PQC
    await page.goto("/research/#/tag/PQC");
    await expect(page.locator("#main")).toContainText("PQC migration notes");                                  // still indexed: not in a project yet
    await page.goto("/research/#/wiki/pqc-programme");
    await page.locator(".addlink summary", { hasText: "Add existing items" }).click();
    await page.selectOption("#ae-item", "page:pqc-migration-notes");
    await page.locator("#aef button[type=submit]").click();
    await expect(page.locator("#main .ptree a", { hasText: "PQC migration notes" })).toBeVisible();
    await page.goto("/research/#/tag/PQC");
    await expect(page.locator("#main h2", { hasText: "Projects tagged" })).toBeVisible();
    await expect(page.locator("#main .linkcard a", { hasText: "PQC programme" })).toHaveAttribute("href", "#/wiki/pqc-programme");
    await expect(page.locator("#main")).not.toContainText("PQC migration notes");                              // the child is not indexed
    const side = page.locator("#sideTags li", { hasText: /^PQC/ });
    await expect(side.locator(".count")).toHaveText("1");                                                      // the project, not its page
    await page.goto("/research/#/tags");
    await expect(page.locator("#main li", { hasText: "PQC" }).first()).toContainText("1 article");
  });

  test("editing the project's tags changes the index; removing them re-indexes the pages", async ({ page }) => {
    await open(page, "#/wiki/pqc-programme");
    await page.locator(".addlink summary", { hasText: "Edit project" }).click();
    await page.locator("#epf .tagchip", { hasText: /^PQC$/ }).locator("span").first().click();     // untick
    await page.locator("#epf button[type=submit]").click();
    await expect(page.locator(".pr-tags")).toHaveCount(0);
    expect(project("pqc-programme").tags).toEqual([]);
    await page.goto("/research/#/tag/PQC");
    await expect(page.locator("#main")).toContainText("PQC migration notes");
    await expect(page.locator("#main h2", { hasText: "Projects tagged" })).toHaveCount(0);
  });

  test("a page inside an untagged project keeps being indexed by its own tags", async ({ page }) => {
    await open(page, "#/tag/PKI");
    await expect(page.locator("#main")).toContainText("Design");        // inside the untagged project "Lamassu CA"
  });

  test("inside a project the main menu steps aside: title, structure and contents", async ({ page }) => {
    await open(page, "#/wiki/lamassu-ca/design/key-ceremony");
    const side = page.locator("#side");
    await expect(page.locator("body")).toHaveClass(/proj-mode/);
    await expect(side.locator("nav.menu")).toBeHidden();                                // no main menu
    await expect(page.locator("#sideProjHead")).toBeVisible();
    await expect(page.locator("#sideProjectT")).toHaveText("Lamassu CA");
    await expect(page.locator("#sideProject a.cur")).toHaveText("Key ceremony");        // the whole structure, current page marked
    await expect(page.locator("#sideProject")).toContainText("Design");
    await expect(page.locator("#tocSide")).toBeVisible();                               // the contents stay
    // title on top, then two bars side by side: structure on the left, contents next to it
    const head = await page.locator("#sideProjHead").boundingBox(), tree = await page.locator("#sideProject").boundingBox(), toc = await page.locator("#tocSide").boundingBox();
    expect(head.y).toBeLessThan(tree.y);
    expect(Math.abs(tree.y - toc.y)).toBeLessThan(8);
    expect(tree.x).toBeLessThan(toc.x);
    // leaving the project brings the main menu back immediately
    await page.locator("#sideProjHead .ph-back").click();
    await expect(page).toHaveURL(/#\/projects$/);
    await expect(page.locator("body")).not.toHaveClass(/proj-mode/);
    await expect(side.locator("nav.menu")).toBeVisible();
    await expect(page.locator("#sideProjHead")).toBeHidden();
  });

  test("the sidebar switches at once when a project item is selected, and for the project itself", async ({ page }) => {
    await open(page, "#/wiki/welcome");
    await expect(page.locator("body")).not.toHaveClass(/proj-mode/);
    await page.evaluate(() => { location.hash = "#/wiki/lamassu-ca"; });
    await expect(page.locator("body")).toHaveClass(/proj-mode/);
    await expect(page.locator("#sideProjectT")).toHaveClass(/cur/);                     // the project itself is the current item
    await page.locator(".addlink summary", { hasText: "Add existing items" }).click();       // ca-spec.pdf is loose again after its project was deleted
    await page.selectOption("#ae-item", "file:ca-spec.pdf");
    await page.locator("#aef button[type=submit]").click();
    await expect(page.locator("#main .ptree a", { hasText: "ca-spec.pdf" })).toBeVisible();
    await page.evaluate(() => { location.hash = "#/file/ca-spec.pdf"; });
    await expect(page.locator("body")).toHaveClass(/proj-mode/);
    await expect(page.locator("#sideProject a.cur")).toHaveText("ca-spec.pdf");
  });
});

test.describe("project home: quick access and introduction", () => {
  const PDF_NAME = "ca-spec.pdf";
  test("links and PDFs are cards, with the introduction below them", async ({ page }) => {
    await open(page, "#/wiki/lamassu-ca");
    const qa = page.locator(".qa");
    await expect(qa.locator("h2")).toHaveText("Quick access");
    const link = qa.locator("a.qa-card", { hasText: "CA design post" });
    await expect(link).toHaveAttribute("href", "https://example.org/ca-design");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
    await expect(link.locator(".qa-s")).toHaveText("example.org");
    const pdf = qa.locator("a.qa-card", { hasText: PDF_NAME });
    await expect(pdf).toHaveAttribute("href", "#/file/" + PDF_NAME);
    await expect(pdf).toContainText("PDF");
    await expect(qa.locator("a.qa-card")).toHaveCount(2);                       // pages are not cards: they are the structure
    await pdf.click();
    await expect(page).toHaveURL(new RegExp("#/file/" + PDF_NAME + "$"));
  });

  test("the introduction is Markdown, safe, and sits between the cards and the structure", async ({ page }) => {
    await open(page, "#/wiki/lamassu-ca");
    const before = repo.commits.length;
    await page.locator(".addlink summary", { hasText: "Edit project" }).click();
    await page.fill("#ep-intro", "## About this project\n\nThe **CA** design, see [[Design]].\n\n<script>window.__pwned = 1</script>\n\n[x](javascript:alert(1))\n");
    await page.locator("#epf button[type=submit]").click();
    const intro = page.locator("#proj-intro");
    await expect(intro.locator("h2")).toHaveText("About this project");
    await expect(intro.locator("strong")).toHaveText("CA");
    await expect(intro.locator("a", { hasText: "Design" })).toHaveAttribute("href", "#/wiki/lamassu-ca/design");
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
    expect(await intro.locator("a[href^='javascript']").count()).toBe(0);
    // order on the page: quick access, introduction, structure
    const y = async sel => (await page.locator(sel).first().boundingBox()).y;
    expect(await y(".qa")).toBeLessThan(await y(".proj-intro"));
    expect(await y(".proj-intro")).toBeLessThan(await y("h2.pr-h:has-text('Structure')"));
    // one commit, only the project file; the text is stored in the project
    expect(repo.commits.length).toBe(before + 1);
    expect([...repo.head().changed]).toEqual(["projects/lamassu-ca.json"]);
    expect(project("lamassu-ca").intro).toContain("## About this project");
  });

  test("emptying the introduction removes it; an empty project has no cards", async ({ page }) => {
    await open(page, "#/wiki/lamassu-ca");
    await page.locator(".addlink summary", { hasText: "Edit project" }).click();
    await page.fill("#ep-intro", "");
    await page.locator("#epf button[type=submit]").click();
    await expect(page.locator(".proj-intro")).toHaveCount(0);
    await expect(page.locator("main, #main")).toContainText("No introduction yet");
    expect(project("lamassu-ca")).not.toHaveProperty("intro");
    await page.goto("/research/#/wiki/pqc-programme");
    await expect(page.locator(".qa")).toHaveCount(0);
  });

  test("a reader sees the cards and the introduction but no editing hints", async ({ page }) => {
    await open(page, "#/wiki/lamassu-ca", { permission: "read" });
    await expect(page.locator(".qa a.qa-card")).toHaveCount(2);
    await expect(page.locator("#main")).not.toContainText("No introduction yet");
    await expect(page.locator(".addlink")).toHaveCount(0);
  });
});

test.describe("project mode layout", () => {
  test("a selected item has one indicator, and big screens give the sidebars the extra room", async ({ page }) => {
    w.gh = await installFakeGitHub(page, { repo });
    const measure = async width => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/research/#/wiki/lamassu-ca/design/key-ceremony");
      await expect(page.locator("#tocSide")).toBeVisible();
      return { side: (await page.locator("#side").boundingBox()).width, main: (await page.locator("#main").boundingBox()).width };
    };
    const small = await measure(1366), big = await measure(2400);
    expect(big.side).toBeGreaterThan(small.side + 150);          // the margins are used by the sidebars...
    expect(big.main).toBeLessThanOrEqual(1000);                  // ...while the main column keeps its size
    expect(big.main).toBeGreaterThanOrEqual(small.main);
    // exactly one selected indicator: a tinted row for the current item, no inset bar on the link as well
    const cur = page.locator("#sideProject a.cur");
    await expect(cur).toHaveCount(1);
    const style = await cur.evaluate(a => ({ link: getComputedStyle(a), row: getComputedStyle(a.closest(".pt-row")) }) && ({
      linkShadow: getComputedStyle(a).boxShadow, linkBg: getComputedStyle(a).backgroundColor, rowBg: getComputedStyle(a.closest(".pt-row")).backgroundColor, rowShadow: getComputedStyle(a.closest(".pt-row")).boxShadow }));
    expect(style.linkShadow).toBe("none");
    expect(style.linkBg).toBe("rgba(0, 0, 0, 0)");
    expect(style.rowShadow).toBe("none");
    expect(style.rowBg).not.toBe("rgba(0, 0, 0, 0)");
  });
});
