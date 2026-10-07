// Phones: no view scrolls sideways, the sidebars are a full-height drawer, the search opens over the top bar, and menus stay on screen.
const { test, expect } = require("@playwright/test");
const { installFakeGitHub, createRepo, seedFromTemplate, projectJson, pageFiles } = require("../helpers/fake-github");
const { watch } = require("../helpers/watch");

let w;
test.beforeEach(({ page }) => { w = watch(page); });
test.afterEach(() => w.check());

const WIDE = "## Wide things\n\n| Algorithm | Security level | Public key | Signature | Notes |\n|---|---|---|---|---|\n| ML-DSA-65 | 3 | 1952 bytes | 3309 bytes | FIPS 204 |\n\n"
  + "```\nopenssl req -new -newkey ml-dsa-65 -keyout key.pem -out req.csr -subj /CN=averyveryverylongcommonname.example.com\n```\n\n"
  + "https://example.com/a/very/long/path/that/does/not/break/naturally/anywhere/at/all/xxxxxxxxxxxxxxxxxxxx\n\n## Second\n\nText.\n";
const TITLE = "A rather long article title about post-quantum certificate authorities";
function repo() {
  const r = seedFromTemplate(createRepo());
  r.add("project", {
    ...pageFiles("lamassu-ca", "ca-notes", { content: WIDE, meta: { title: TITLE } }), ...pageFiles("lamassu-ca", "ca-child"),
    "projects/lamassu-ca/links/nist-pqc.json": JSON.stringify({ url: "https://csrc.nist.gov/projects/post-quantum-cryptography", title: "NIST PQC standardization",
      description: "The NIST project page", kind: "reference", tags: ["PQC"], addedBy: "ada", addedAt: "2026-10-07T00:00:00.000Z" }),
    "projects/lamassu-ca/project.json": projectJson({ title: "Lamassu CA", description: "Certificate authority research",
      items: [{ type: "page", id: "ca-notes", children: [{ type: "page", id: "ca-child" }] }, { type: "link", id: "nist-pqc" }] }),
  });
  r.add("edit", pageFiles("lamassu-ca", "ca-notes", { content: WIDE + "\nMore text.\n", meta: { title: TITLE, revN: 2 } }));
  return r;
}
/* The icon font is not reachable from the tests; give every icon its real footprint so the top bar is as crowded as in production. */
async function withIcons(page) {
  await page.addInitScript(() => addEventListener("DOMContentLoaded", () => {
    document.documentElement.classList.add("icons");
    const st = document.createElement("style"); st.textContent = ".ms{color:transparent!important;width:22px!important;height:22px!important}"; document.head.appendChild(st);
  }));
}
async function open(page, hash, width) {
  w.gh = await installFakeGitHub(page, { repo: repo() });
  await withIcons(page);
  await page.setViewportSize({ width, height: 740 });
  await page.goto("/research/" + hash);
  await expect(page.locator("#gate")).toBeHidden();
}
/* Elements that stick out of the viewport without a scrolling or clipping ancestor (drawers, toasts and closed menus aside). */
const overflowing = page => page.evaluate(() => {
  const W = innerWidth, out = [];
  const contained = el => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p); if (s.position === "fixed") return true;
    if (/(auto|scroll|hidden|clip)/.test(s.overflowX) && p.getBoundingClientRect().right <= W + 1) return true; } return false; };
  for (const el of document.querySelectorAll("body *")) {
    if (getComputedStyle(el).position === "fixed" || el.closest("#side, .backdrop, .toast, details:not([open])")) continue;
    const b = el.getBoundingClientRect();
    if (b.width && b.height && (b.right > W + 1 || b.left < -1) && !contained(el)) out.push(`${el.tagName.toLowerCase()}#${el.id}.${el.className} [${Math.round(b.left)}..${Math.round(b.right)}]`);
  }
  return { scrollWidth: document.documentElement.scrollWidth, width: W, out: out.slice(0, 5) };
});
const onScreen = async (page, sel) => {
  const b = await page.locator(sel).boundingBox(), W = page.viewportSize().width;
  expect(b.x, sel + " left edge").toBeGreaterThanOrEqual(0);
  expect(b.x + b.width, sel + " right edge").toBeLessThanOrEqual(W);
};

const VIEWS = ["#/", "#/projects", "#/wiki/lamassu-ca", "#/wiki/lamassu-ca/ca-notes", "#/edit/ca-notes", "#/new", "#/history/ca-notes", "#/info/ca-notes",
  "#/links", "#/files", "#/recent", "#/search?q=pqc", "#/help", "#/tags", "#/all", "#/access", "#/automation"];
for (const width of [320, 390]) test(`no view scrolls sideways at ${width}px`, async ({ page }) => {
  await open(page, "#/", width);
  for (const hash of VIEWS) {
    await page.goto("/research/" + hash);
    await expect(page.locator("#main")).not.toBeEmpty();
    await page.waitForLoadState("networkidle");
    const r = await overflowing(page);
    expect({ hash, ...r }).toEqual({ hash, scrollWidth: width, width, out: [] });
  }
});

test("project pages use the whole width and the project bars are a full-height drawer", async ({ page }) => {
  await open(page, "#/history/ca-notes", 375);
  await expect(page.locator("h1.title")).toContainText("Revision history");
  const main = await page.locator("#main").boundingBox();
  expect(main.width).toBeGreaterThan(375 - 30);                  // no desktop sidebar column left behind
  await expect(page.locator("#side")).not.toBeInViewport();
  await page.locator("#menuBtn").click();
  await expect(page.locator("#side")).toHaveClass(/open/);
  await expect(page.locator("#sideProject")).toBeVisible();
  await expect.poll(async () => (await page.locator("#side").boundingBox()).x).toBe(0);   // once it has slid in
  expect((await page.locator("#side").boundingBox()).height).toBe(740);
  await page.locator(".backdrop").click({ position: { x: 360, y: 400 } });
  await expect(page.locator("#side")).not.toHaveClass(/open/);
});

test("the search shrinks to its icon and opens over the top bar until you leave it", async ({ page }) => {
  await open(page, "#/wiki/lamassu-ca/ca-notes", 375);
  for (const sel of ["#menuBtn", ".brand", "#searchForm", "#themeBtn", ".user-dd summary", "#newBtn"]) await onScreen(page, sel);
  expect((await page.locator("#searchForm").boundingBox()).width).toBeLessThanOrEqual(40);
  await page.locator("#q").click();
  await page.keyboard.type("pqc");
  await expect(page.locator("#qr")).toBeVisible();
  const box = await page.locator("#searchForm").boundingBox();
  expect(box.x).toBe(10);
  expect(box.width).toBe(375 - 20);
  await page.keyboard.press("Escape");                            // closes the suggestions…
  await expect(page.locator("#qr")).toBeHidden();
  await page.keyboard.press("Escape");                            // …then gives the bar back
  expect((await page.locator("#searchForm").boundingBox()).width).toBeLessThanOrEqual(40);
  await page.locator("#q").click();
  await page.keyboard.type("pqc");
  await page.keyboard.press("Enter");                             // searching goes to another page, which gives the bar back too
  await expect(page).toHaveURL(/#\/search/);
  expect((await page.locator("#searchForm").boundingBox()).width).toBeLessThanOrEqual(40);
});

test("menus open inside the screen", async ({ page }) => {
  await open(page, "#/wiki/lamassu-ca/ca-notes", 320);
  await page.locator("#tools summary").click();
  await onScreen(page, "#tools .dd-menu");
  await page.keyboard.press("Escape");
  await page.locator(".user-dd summary").click();
  await onScreen(page, ".user-dd .dd-menu");
  await page.keyboard.press("Escape");
  await expect(page.locator(".chgbar")).toBeVisible();
  await onScreen(page, ".chgbar");
});
