// PDF files: upload (Git Data API), links and embeds from Markdown, in-app viewer (pdf.js).
const { test, expect } = require("@playwright/test");
const crypto = require("node:crypto");
const { installFakeGitHub, createRepo, seedFromTemplate } = require("../helpers/fake-github");
const { makePdf } = require("../helpers/pdf");
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

test.describe.configure({ mode: "serial" });
const repo = seedFromTemplate(createRepo());
const PDF1 = makePdf(["TPM page one", "TPM page two", "TPM page three"]);
const PDF2 = makePdf(["Second version"]);

test("uploads a PDF: normalised name, one commit with trailers, shown in the viewer", async ({ page }) => {
  const gh = await open(page, "#/files", { repo });
  await expect(page.locator(".empty")).toContainText("No files yet");
  await page.setInputFiles("#up-file", { name: "TPM 2.0 Spec.pdf", mimeType: "application/pdf", buffer: PDF1 });
  await expect(page.locator("#up-name")).toHaveValue("tpm-2.0-spec.pdf");
  await expect(page.locator("#up-syntax")).toHaveText("[[File:tpm-2.0-spec.pdf]]");
  await page.fill("#up-sum", "Add the TPM 2.0 specification");
  await page.locator("#up-btn").click();
  await expect(page).toHaveURL(/#\/file\/tpm-2\.0-spec\.pdf$/);
  const c = repo.head();
  expect(c.author.login).toBe("ada");
  expect(c.message).toBe(`Add the TPM 2.0 specification\n\nKnow-how-File: tpm-2.0-spec.pdf\nContent-SHA256: ${crypto.createHash("sha256").update(PDF1).digest("hex")}`);
  expect(Buffer.compare(c.files.get("files/tpm-2.0-spec.pdf"), PDF1)).toBe(0);
  expect(gh.blobUploads).toBe(1);
  await expect(page.locator(".pdfv-n")).toHaveText("3");
  await expect(page.locator(".pdfv-slot canvas")).not.toHaveCount(0);
  await expect(page.locator("ul.special li")).toHaveCount(1);
});

test("rejects a file that is not a PDF", async ({ page }) => {
  await open(page, "#/files", { repo });
  const before = repo.commits.length;
  await page.setInputFiles("#up-file", { name: "evil.pdf", mimeType: "application/pdf", buffer: Buffer.from("<html><script>alert(1)</script>") });
  await page.locator("#up-btn").click();
  await expect(page.locator("#toast")).toContainText("not a PDF");
  expect(repo.commits.length).toBe(before);
});

test("a new version that loses the race on main retries; the old version stays in the history", async ({ page }) => {
  const gh = await open(page, "#/file/tpm-2.0-spec.pdf", { repo, raceUploadOnce: true });
  await expect(page.locator(".pdfv-n")).toHaveText("3");
  await page.setInputFiles("#up-file", { name: "whatever.pdf", mimeType: "application/pdf", buffer: PDF2 });
  await page.fill("#up-sum", "Errata");
  await page.locator("#up-btn").click();
  await expect(page.locator(".pdfv-n")).toHaveText("1");
  expect(gh.uploadRaced).toBe(true);
  expect(gh.blobUploads).toBe(1);
  expect(repo.head().message.split("\n")[0]).toBe("Errata");
  await expect(page.locator("ul.special li")).toHaveCount(2);
  await page.locator("ul.special li").nth(1).locator("a").first().click();
  await expect(page.locator(".ambox.warn")).toContainText("old version");
  await expect(page.locator(".pdfv-n")).toHaveText("3");
});

test("articles link to files, to a page of a file, and embed a preview", async ({ page }) => {
  await open(page, "#/new", { repo });
  await page.fill("#f-title", "TPM notes");
  await page.locator(".tagchip", { hasText: /^PKI$/ }).locator("span").first().click();
  await page.fill("#f-sum", "Notes");
  await page.fill("#f-body", "See [[File:tpm-2.0-spec.pdf|the spec]] and [[File:TPM 2.0 Spec.pdf#page=3|section 3]] or [[File:missing.pdf]].\n\n![[File:tpm-2.0-spec.pdf]]\n");
  await page.locator("#saveBtn").click();
  await expect(page).toHaveURL(/#\/wiki\/tpm-notes$/);
  await expect(page.locator("#prose a.file-link", { hasText: "the spec" })).toHaveAttribute("href", "#/file/tpm-2.0-spec.pdf");
  await expect(page.locator("#prose a.file-link", { hasText: "section 3" })).toHaveAttribute("href", "#/file/tpm-2.0-spec.pdf?page=3");
  await expect(page.locator("#prose a.file-link", { hasText: "missing.pdf" })).toHaveClass(/new/);
  const embed = page.locator("#prose .pdf-embed");
  await expect(embed.locator(".pdf-card")).toContainText("tpm-2.0-spec.pdf");
  await embed.locator("[data-preview]").click();
  await expect(embed.locator(".pdfv-n")).toHaveText("1");
  await expect(embed.locator(".pdfv-slot canvas")).toHaveCount(1);
});

test("a page link opens the viewer on that page; zoom and navigation work", async ({ page }) => {
  // put the 3-page version back so there is a page 3
  repo.add("Restore", { "files/tpm-2.0-spec.pdf": PDF1 }, { name: "Ada Lovelace", login: "ada" });
  await open(page, "#/file/tpm-2.0-spec.pdf?page=3", { repo });
  await expect(page.locator(".pdfv-n")).toHaveText("3");
  await expect(page.locator(".pdfv-page input")).toHaveValue("3");
  expect(await page.evaluate(() => scrollY)).toBe(0);           // the viewer scrolls, not the page
  await page.locator('[data-v="prev"]').click();
  await expect(page.locator(".pdfv-page input")).toHaveValue("2");
  const z = await page.locator(".pdfv-zoom").textContent();
  await page.locator('[data-v="in"]').click();
  await expect(page.locator(".pdfv-zoom")).not.toHaveText(z);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator("#f-dl").click()]);
  expect(dl.suggestedFilename()).toBe("tpm-2.0-spec.pdf");
});

test("files page lists files; a reader can view but not upload", async ({ page }) => {
  await open(page, "#/files", { repo, permission: "read" });
  await expect(page.locator("table.files")).toContainText("tpm-2.0-spec.pdf");
  await expect(page.locator("#upf")).toHaveCount(0);
  await page.goto("/research/#/file/tpm-2.0-spec.pdf");
  await expect(page.locator(".pdfv-n")).toHaveText("3");
  await expect(page.locator("#upf")).toHaveCount(0);
  await page.goto("/research/#/file/nope.pdf");
  await expect(page.locator("#main")).toContainText("There is no file with this name");
});
