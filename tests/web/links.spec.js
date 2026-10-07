// External links: links/<id>.json, one commit per change. Serial: the tests share one in-memory repository.
const { test, expect } = require("@playwright/test");
const { installFakeGitHub, createRepo, seedFromTemplate } = require("../helpers/fake-github");
const { watch } = require("../helpers/watch");

let w;
test.beforeEach(({ page }) => { w = watch(page); });
test.afterEach(() => w.check());
test.describe.configure({ mode: "serial" });
const repo = seedFromTemplate(createRepo());

async function open(page, hash, opts) {
  w.gh = await installFakeGitHub(page, { repo, ...opts });
  await page.goto("/research/" + hash);
  await expect(page.locator("#gate")).toBeHidden();
}
async function add(page, url, title, tags, extra = {}) {
  await page.locator(".addlink summary").click();
  await page.fill("#l-url", url); await page.fill("#l-title", title);
  if (extra.desc) await page.fill("#l-desc", extra.desc);
  if (extra.kind) await page.selectOption("#l-kind", extra.kind);
  await page.locator("#l-save").click();
}

test("adds a link: one commit with the file and trailers; shown with safe attributes", async ({ page }) => {
  await open(page, "#/links");
  await expect(page.locator(".empty")).toContainText("No links yet");
  const before = repo.commits.length;
  await add(page, "https://blog.example.org/pq-migration?utm=1", "Migrating a PKI to PQC", ["PQC", "PKI"], { desc: "Good overview of hybrid certs.", kind: "blog" });
  await expect(page.locator(".linkcard")).toHaveCount(1);
  expect(repo.commits.length).toBe(before + 1);
  const c = repo.head();
  expect(c.author.login).toBe("ada");
  expect(c.message).toBe("Add link: Migrating a PKI to PQC\n\nKnow-how-Link: migrating-a-pki-to-pqc\nKnow-how-Project: general\nLink-Host: blog.example.org");
  const meta = JSON.parse(c.files.get("projects/general/links/migrating-a-pki-to-pqc.json"));
  expect(meta).toMatchObject({ url: "https://blog.example.org/pq-migration?utm=1", title: "Migrating a PKI to PQC", kind: "blog", addedBy: "ada", updatedBy: "ada" });
  const a = page.locator(".linkcard .lc-title");
  await expect(a).toHaveAttribute("target", "_blank");
  await expect(a).toHaveAttribute("rel", "noopener noreferrer nofollow");
  await expect(page.locator(".lc-host")).toHaveText("blog.example.org");
  await expect(page.locator(".linkcard")).toContainText("Good overview of hybrid certs.");
  await expect(page.locator(".linkcard .pill.kind")).toHaveText("Blog");
});

test("refuses unsafe addresses and duplicates", async ({ page }) => {
  await open(page, "#/links");
  const before = repo.commits.length;
  await page.locator(".addlink summary").click();
  await page.fill("#l-title", "x");
  for (const url of ["javascript:alert(1)", "https://user:pw@example.org/", "ftp://example.org/x"]) {
    await page.fill("#l-url", url); await page.locator("#l-save").click();
    await expect(page.locator("#toast")).toContainText("http(s) address");
  }
  await page.fill("#l-url", "https://blog.example.org/pq-migration?utm=1"); await page.locator("#l-save").click();
  await expect(page.locator("#toast")).toContainText("Already added");
  expect(repo.commits.length).toBe(before);
});

test("edits a link and removes one; both are single commits", async ({ page }) => {
  await open(page, "#/links");
  await page.locator('[data-edit="migrating-a-pki-to-pqc"]').click();
  await expect(page.locator("#l-title")).toHaveValue("Migrating a PKI to PQC");
  await page.fill("#l-title", "Migrating a PKI to PQC (hybrid)");
  await page.locator("#l-save").click();
  await expect(page.locator(".linkcard .lc-title")).toContainText("(hybrid)");
  expect(repo.head().message.split("\n")[0]).toBe("Edit link: Migrating a PKI to PQC (hybrid)");
  const meta = JSON.parse(repo.head().files.get("projects/general/links/migrating-a-pki-to-pqc.json"));
  expect(meta.addedBy).toBe("ada");
  expect(meta.updatedAt >= meta.addedAt).toBe(true);

  await add(page, "https://news.example.com/x509-news", "X.509 news", ["X509", "Updates"], { kind: "news" });
  await expect(page.locator(".linkcard")).toHaveCount(2);
  page.once("dialog", d => d.accept());
  await page.locator('.linkcard[data-id="x-509-news"]').locator("[data-del]").click();
  await expect(page.locator(".linkcard")).toHaveCount(1);
  expect(repo.head().message).toBe("Remove link: X.509 news\n\nKnow-how-Link: x-509-news\nKnow-how-Project: general");
  expect(repo.head().files.has("projects/general/links/x-509-news.json")).toBe(false);
});

test("filters by type and text (links are no longer tagged by hand)", async ({ page }) => {
  await open(page, "#/links?kind=news");
  await expect(page.locator(".empty")).toContainText("No links match");
  await page.goto("/research/#/links?q=hybrid");
  await expect(page.locator(".linkcard")).toHaveCount(1);
  await expect(page.locator("#main [data-del]")).toHaveCount(1);
});

test("a reader sees the links but cannot add, edit or remove", async ({ page }) => {
  await open(page, "#/links", { permission: "read" });
  await expect(page.locator(".linkcard")).toHaveCount(1);
  await expect(page.locator(".addlink")).toHaveCount(0);
  await expect(page.locator("[data-edit], [data-del]")).toHaveCount(0);
});
