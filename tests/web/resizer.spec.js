// The sidebar can be made wider or narrower; the content takes the rest. Widths are remembered per layout.
const { test, expect } = require("@playwright/test");
const { installFakeGitHub, createRepo, seedFromTemplate, projectJson, pageFiles } = require("../helpers/fake-github");
const { watch } = require("../helpers/watch");

let w;
test.beforeEach(({ page }) => { w = watch(page); });
test.afterEach(() => w.check());

function repoWithProject() {
  const r = seedFromTemplate(createRepo());
  r.add("project", { ...pageFiles("lamassu-ca", "ca-notes"), "projects/lamassu-ca/project.json": projectJson({ title: "Lamassu CA", items: [{ type: "page", id: "ca-notes" }] }) });
  return r;
}
async function open(page, hash, width = 1400) {
  w.gh = await installFakeGitHub(page, { repo: repoWithProject() });
  await page.setViewportSize({ width, height: 800 });
  await page.goto("/research/" + hash);
  await expect(page.locator("#gate")).toBeHidden();
}
const box = (page, sel) => page.locator(sel).boundingBox();
async function drag(page, dx) {
  const h = await box(page, "#sideResizer"), x = h.x + h.width / 2, y = h.y + h.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx / 2, y, { steps: 4 }); await page.mouse.move(x + dx, y, { steps: 4 }); await page.mouse.up();
}

test("dragging the edge resizes the sidebar and the content takes the difference; it is remembered", async ({ page }) => {
  await open(page, "#/tags");
  await expect(page.locator("#sideResizer")).toBeVisible();
  const before = { side: (await box(page, "#side")).width, main: (await box(page, "#main")).width };
  await drag(page, 100);
  const after = { side: (await box(page, "#side")).width, main: (await box(page, "#main")).width };
  expect(after.side).toBeGreaterThan(before.side + 90);
  expect(after.side).toBeLessThan(before.side + 110);
  expect(after.main).toBeLessThan(before.main - 90);                           // the content gave way
  expect(await page.evaluate(() => localStorage.getItem("kb.sidew.n"))).toBe(String(Math.round(after.side - 8)));
  await page.reload();
  await expect(page.locator("#sideResizer")).toBeVisible();
  expect(Math.round((await box(page, "#side")).width)).toBe(Math.round(after.side));     // remembered
  await drag(page, -150);                                                         // and narrower
  expect((await box(page, "#side")).width).toBeLessThan(after.side - 140);
  expect((await box(page, "#main")).width).toBeGreaterThan(after.main + 140);        // the content took the room
});

test("the width is clamped, can be set with the keyboard, and is reset by double-click or Home", async ({ page }) => {
  await open(page, "#/tags");
  const def = (await box(page, "#side")).width;
  await drag(page, -400);
  expect((await box(page, "#side")).width).toBeGreaterThanOrEqual(200);            // never below the minimum
  await drag(page, 1500);
  expect((await box(page, "#side")).width).toBeLessThanOrEqual(1400 * 0.4 + 9);    // never above the maximum
  await page.locator("#sideResizer").dblclick();
  expect(Math.round((await box(page, "#side")).width)).toBe(Math.round(def));       // back to the default
  expect(await page.evaluate(() => document.body.classList.contains("sw-n"))).toBe(false);
  await page.locator("#sideResizer").focus();
  const w0 = (await box(page, "#side")).width;
  await page.keyboard.press("ArrowRight");
  expect(Math.round((await box(page, "#side")).width)).toBe(Math.round(w0 + 16));
  await page.keyboard.press("Shift+ArrowLeft");
  expect(Math.round((await box(page, "#side")).width)).toBe(Math.round(w0 + 16 - 64));
  await page.keyboard.press("Home");
  expect(Math.round((await box(page, "#side")).width)).toBe(Math.round(def));
  await expect(page.locator("#sideResizer")).toHaveAttribute("aria-valuenow", String(Math.round(def - 8)));
});

test("project mode has its own width, and the main menu keeps its own", async ({ page }) => {
  await open(page, "#/tags", 1700);
  await drag(page, 60);
  const menuW = (await box(page, "#side")).width;
  await page.evaluate(() => { location.hash = "#/wiki/lamassu-ca/ca-notes"; });
  await expect(page.locator("body")).toHaveClass(/proj-mode/);
  await expect(page.locator("#tocSide")).toBeVisible();
  const projDefault = (await box(page, "#side")).width;
  expect(Math.abs(projDefault - menuW)).toBeGreaterThan(100);                      // a different layout, not the menu width
  await drag(page, 120);
  const projW = (await box(page, "#side")).width;
  expect(projW).toBeGreaterThan(projDefault + 100);
  // with a custom width the content takes the rest of the screen instead of keeping a fixed maximum
  const main = await box(page, "#main"); expect(Math.round(main.x + main.width)).toBeGreaterThan(1700 - 60);
  await page.evaluate(() => { location.hash = "#/tags"; });
  await expect(page.locator("body")).not.toHaveClass(/proj-mode/);
  expect(Math.round((await box(page, "#side")).width)).toBe(Math.round(menuW));    // the menu width was kept
  expect(await page.evaluate(() => [localStorage.getItem("kb.sidew.n") > "", localStorage.getItem("kb.sidew.p") > ""])).toEqual([true, true]);
});

test("no resize handle on a phone, and none while the sidebar is hidden", async ({ page }) => {
  await open(page, "#/wiki/general/welcome", 700);
  await expect(page.locator("#sideResizer")).toBeHidden();
  await page.setViewportSize({ width: 1400, height: 800 });
  await expect(page.locator("#sideResizer")).toBeVisible();
});
