const { test, expect } = require("@playwright/test");
const { installFakeGitHub, createRepo, seedFromTemplate } = require("../helpers/fake-github");
const { watch } = require("../helpers/watch");

const diagram = `flowchart LR
    A[CA certificate records] --> B[Select managed and imported-with-key records]
    B --> C[Group by subject key ID]
    C --> D[Build KMS key record and certificate links]
    D --> E{Key already in KMS?}
    E -->|Yes| F[Skip]
    E -->|No| G{Dry run?}
    G -->|Yes| H[Report planned insert]
    G -->|No| I[Insert into KMS store]
    I --> J[Report inserted or failed]`;
const markdown = "## Migration\n\n```mermaid\n" + diagram + "\n```\n\n## Notes\n\n```js\nconst x = 1;\n```\n";
let w;
test.beforeEach(({ page }) => { w = watch(page); });
test.afterEach(() => w.check());
async function open(page, body=markdown, hash="#/wiki/general/welcome") {
  const repo = seedFromTemplate(createRepo());
  repo.add("Diagram fixture", { "projects/general/pages/welcome/content.md": body });
  w.gh = await installFakeGitHub(page, { repo });
  await page.goto("/research/" + hash, {waitUntil:"domcontentloaded"});
  await expect(page.locator("#gate")).toBeHidden();
}

test("renders the supplied Mermaid flowchart and rerenders on theme changes", async ({ page }) => {
  await open(page);
  const svg = page.locator("#prose .mermaid-diagram svg");
  await expect(svg).toBeVisible();
  await expect(svg.locator(".node")).toHaveCount(10);
  expect((await svg.locator(".node").first().textContent()).replace(/\s/g, "")).toBe("CAcertificaterecords");
  expect((await svg.locator(".node").last().textContent()).replace(/\s/g, "")).toBe("Reportinsertedorfailed");
  await expect(page.locator("#prose code.language-js")).toBeVisible();
  const before = await svg.innerHTML();
  await page.locator("#themeBtn").click();
  await expect.poll(() => svg.innerHTML()).not.toBe(before);
  await expect(page.locator(".mermaid-error")).toHaveCount(0);
  await page.setViewportSize({ width:390, height:800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test("invalid Mermaid keeps readable source and does not prevent other diagrams", async ({ page }) => {
  await open(page, "```mermaid\nflowchart LR\nA[broken\n```\n\n" + markdown);
  await expect(page.locator(".mermaid-error")).toHaveCount(1);
  await expect(page.locator("pre:not(.mermaid-ready) code.language-mermaid")).toBeVisible();
  await expect(page.locator(".mermaid-diagram svg")).toBeVisible();
});

test("editor preview renders Mermaid", async ({ page }) => {
  await open(page, markdown, "#/edit/welcome");
  await page.fill("#f-body", markdown);
  await page.locator("#pvBtn").click();
  await expect(page.locator("#pv-area .mermaid-diagram svg")).toBeVisible();
});

test("editing a diagram preserves rendering when revision highlights are toggled", async ({ page }) => {
  await open(page, markdown, "#/edit/welcome");
  await page.fill("#f-body", markdown.replace("Report inserted or failed", "Report migration result"));
  await page.fill("#f-sum", "Update diagram");
  await page.locator("#saveBtn").click();
  await expect(page.locator("#prose .mermaid-diagram svg .node")).toHaveCount(10);
  await expect(page.locator("#prose pre.chg-add")).toHaveCount(1);
  await page.locator('.chgbar [data-a="toggle"]').click();
  await page.locator('.chgbar [data-a="toggle"]').click();
  await expect(page.locator("#prose .mermaid-diagram svg .node")).toHaveCount(10);
  expect((await page.locator("#prose code.language-mermaid").textContent())).toContain("Report migration result");
  await expect(page.locator(".mermaid-error")).toHaveCount(0);
});

test("Contents collapses independently and the split resizes and persists", async ({ page }) => {
  await open(page);
  const handle = page.locator("#splitResizer"), tree = page.locator("#sideProject");
  await expect(handle).toBeVisible();
  const before = (await tree.boundingBox()).width;
  const r = await handle.boundingBox();
  await page.mouse.move(r.x + r.width / 2, r.y + 100);
  await page.mouse.down(); await page.mouse.move(r.x + r.width / 2 + 70, r.y + 100); await page.mouse.up();
  expect((await tree.boundingBox()).width).toBeGreaterThan(before + 40);
  await handle.focus(); await page.keyboard.press("ArrowLeft");
  const share = await handle.getAttribute("aria-valuenow");
  await page.locator("#tocToggle").click();
  await expect(page.locator("#tocIndex")).toBeHidden();
  await expect(handle).toBeHidden(); await expect(page.locator("#sideTree")).toBeVisible();
  await page.reload();
  await expect(page.locator("#tocToggle")).toHaveAttribute("aria-expanded", "false");
  await page.locator("#tocToggle").click();
  await expect(handle).toHaveAttribute("aria-valuenow", share);
  await handle.focus(); await page.keyboard.press("Home");
  await expect(handle).toHaveAttribute("aria-valuenow", "47");
  await page.locator("#treeToggle").click();
  await expect(handle).toBeHidden(); await expect(page.locator("#tocIndex")).toBeVisible();
  expect(await page.locator("#tocToggle .eyebrow").evaluate(e => getComputedStyle(e).writingMode)).toBe("horizontal-tb");
  await page.setViewportSize({width:390,height:800});
  await page.locator("#menuBtn").click();
  await page.locator("#tocToggle").click();
  await expect(page.locator("#tocIndex")).toBeHidden();
});
