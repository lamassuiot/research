// Link previews: the Worker reads the page when a link is added and serves its image; no browser ever contacts the external site.
const { test, expect } = require("@playwright/test");
const { installFakeGitHub, createRepo, seedFromTemplate, projectJson, PNG_PIXEL } = require("../helpers/fake-github");
const { watch } = require("../helpers/watch");

let w;
test.beforeEach(({ page }) => { w = watch(page); });
test.afterEach(() => w.check());

const PAGE = "https://blog.example.org/ca-for-the-internet";
const PREVIEWS = { [PAGE]: { title: "Building a certificate authority for the whole Internet", description: "Twelve years after launching Universal SSL, Cloudflare is applying to become a certificate authority.",
  image: "https://blog.example.org/cover.png", siteName: "Example Blog", icon: "https://blog.example.org/favicon.png" } };
const IMAGES = { "https://blog.example.org/cover.png": PNG_PIXEL, "https://blog.example.org/favicon.png": PNG_PIXEL };
// every request the page makes to a host that is not ours or GitHub's
const watchOutside = page => { const out = []; page.on("request", r => { const h = new URL(r.url()).hostname; if (!/^(127\.0\.0\.1|api\.github\.com|github\.com|auth\.test|avatars\.githubusercontent\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(h) && !r.url().startsWith("blob:") && !r.url().startsWith("data:")) out.push(r.url()); }); return out; };

async function open(page, hash, opts = {}) {
  const repo = opts.repo || seedFromTemplate(createRepo());
  w.gh = await installFakeGitHub(page, { repo, previews: PREVIEWS, images: IMAGES, ...opts });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/research/" + hash);
  await expect(page.locator("#gate")).toBeHidden();
  return repo;
}

test("pasting an address fetches a preview through the Worker, fills the empty fields and shows the card", async ({ page }) => {
  const outside = watchOutside(page);
  const repo = await open(page, "#/links?new=1");
  await page.fill("#l-url", PAGE);
  await page.locator("#l-url").dispatchEvent("change");
  await expect(page.locator("#l-title")).toHaveValue(PREVIEWS[PAGE].title);
  await expect(page.locator("#l-desc")).toHaveValue(PREVIEWS[PAGE].description);
  const card = page.locator("#l-prev .ucard");
  await expect(card).toContainText("Example Blog");
  await expect(card.locator(".uc-media")).toHaveClass(/has-img/);                       // the image arrived (as a blob served by the Worker)
  expect(await card.locator(".uc-media").evaluate(e => getComputedStyle(e).backgroundImage)).toContain("blob:");
  await expect(card.locator(".uc-ico img")).toHaveCount(1);
  await expect(page.locator("#l-useimg")).toBeChecked();
  expect(w.gh.previewCalls).toEqual([PAGE]);
  expect(w.gh.imgCalls.every(c => /^Bearer tok-/.test(c.auth))).toBe(true);              // images are fetched with the reader's token
 
  await page.locator("#l-save").click();
  await expect(page.locator(".linkcard")).toHaveCount(1);
  const meta = JSON.parse(repo.head().files.get("projects/general/links/building-a-certificate-authority-for-the-whole-internet.json"));
  expect(meta).toMatchObject({ url: PAGE, siteName: "Example Blog", image: "https://blog.example.org/cover.png", icon: "https://blog.example.org/favicon.png" });
  await expect(page.locator(".linkcard .lc-host")).toHaveText("Example Blog");
  await expect(page.locator(".linkcard .uc-media")).toHaveClass(/has-img/);              // shown on the saved card too
  expect(outside, "the page never contacted the external site").toEqual([]);
});

test("what the person already typed is kept, and the image can be switched off", async ({ page }) => {
  const repo = await open(page, "#/links?new=1");
  await page.fill("#l-title", "My own title");
  await page.fill("#l-url", PAGE);
  await page.locator("#l-url").dispatchEvent("change");
  await expect(page.locator("#l-prev .uc-media")).toHaveClass(/has-img/);
  await expect(page.locator("#l-title")).toHaveValue("My own title");                    // not overwritten
  await expect(page.locator("#l-desc")).toHaveValue(PREVIEWS[PAGE].description);          // the empty one was filled
  await page.locator("#l-useimg").uncheck();
  await expect(page.locator("#l-prev .uc-media")).not.toHaveClass(/has-img/);
 
  await page.locator("#l-save").click();
  await expect(page.locator(".linkcard")).toHaveCount(1);
  const meta = JSON.parse(repo.head().files.get("projects/general/links/my-own-title.json"));
  expect(meta).not.toHaveProperty("image");
  expect(meta.siteName).toBe("Example Blog");
});

test("when no preview is available the link is added by hand, with the generated card", async ({ page }) => {
  const repo = await open(page, "#/links?new=1");
  await page.fill("#l-url", "https://nowhere.example.org/x");
  await page.locator("#l-url").dispatchEvent("change");
  await expect(page.locator("#l-status")).toContainText("No preview");
  await page.fill("#l-title", "By hand");
  await page.locator("#l-save").click();
  await expect(page.locator(".linkcard")).toHaveCount(1);
  const meta = JSON.parse(repo.head().files.get("projects/general/links/by-hand.json"));
  expect(meta).not.toHaveProperty("image");
  await expect(page.locator(".linkcard .lc-host")).toHaveText("nowhere.example.org");
  await expect(page.locator(".linkcard .uc-media")).not.toHaveClass(/has-img/);
});

test("readers see the images too, each one fetched once; a failing image keeps the generated panel", async ({ page }) => {
  const repo = seedFromTemplate(createRepo()), now = new Date().toISOString();
  const L = (title, image, extra = {}) => JSON.stringify({ url: "https://blog.example.org/" + title, title, description: "", kind: "blog", tags: ["PQC"], addedAt: now, addedBy: "ada", updatedAt: now, updatedBy: "ada", ...(image ? { image } : {}), ...extra });
  repo.add("links", { "projects/p/links/a.json": L("a", "https://blog.example.org/cover.png"), "projects/general/links/b.json": L("b", "https://blog.example.org/cover.png"), "projects/p/links/c.json": L("c", "https://blog.example.org/missing.png"),
    "projects/p/project.json": projectJson({ title: "P", items: [{ type: "link", id: "a" }, { type: "link", id: "c" }] }) });
  await open(page, "#/links", { repo, permission: "read" });
  const cards = page.locator(".linkcard");
  await expect(cards).toHaveCount(3);
  await expect(page.locator('.linkcard[data-id="a"] .uc-media')).toHaveClass(/has-img/);
  await expect(page.locator('.linkcard[data-id="b"] .uc-media')).toHaveClass(/has-img/);
  await expect(page.locator('.linkcard[data-id="c"] .uc-big')).toBeVisible();              // 502 from the Worker: the generated panel stays
  await expect(page.locator('.linkcard[data-id="c"] .uc-media')).not.toHaveClass(/has-img/);
  expect(w.gh.imgCalls.filter(c => c.url.endsWith("cover.png"))).toHaveLength(1);          // two cards, one image, one request
  await page.evaluate(() => { location.hash = "#/wiki/p"; });
  await expect(page.locator(".qa .qa-card").first().locator(".uc-media")).toHaveClass(/has-img/);       // quick access uses the same image...
  expect(w.gh.imgCalls.filter(c => c.url.endsWith("cover.png"))).toHaveLength(1);                       // ...without asking again
});
