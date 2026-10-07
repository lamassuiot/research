// Run: node --test "content-template/scripts/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { validate } from "./validate.mjs";

const TEMPLATE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fixture(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lr-validate-"));
  fs.cpSync(TEMPLATE, dir, { recursive: true, filter: (s) => !s.includes(`${path.sep}scripts`) && !s.includes(`${path.sep}.github`) });
  if (mutate) mutate(dir);
  return dir;
}
const metaPath = (dir, slug = "welcome") => path.join(dir, "pages", slug, "meta.json");
const editMeta = (dir, fn, slug) => { const m = JSON.parse(fs.readFileSync(metaPath(dir, slug), "utf8")); fn(m); fs.writeFileSync(metaPath(dir, slug), JSON.stringify(m, null, 2) + "\n"); };

test("the template passes", () => {
  assert.deepEqual(validate(TEMPLATE), []);
});
test("an unknown tag fails", () => {
  const errs = validate(fixture((d) => editMeta(d, (m) => { m.tags = ["Nope"]; })));
  assert.ok(errs.some((e) => e.includes('tag "Nope" is not listed in tags.json')), errs.join("\n"));
});
test("no tags fails", () => {
  const errs = validate(fixture((d) => editMeta(d, (m) => { m.tags = []; })));
  assert.ok(errs.some((e) => e.includes("tags must have between 1 and 20 entries")), errs.join("\n"));
});
test("a leftover category fails", () => {
  const errs = validate(fixture((d) => editMeta(d, (m) => { m.category = "PKI"; })));
  assert.ok(errs.some((e) => e.includes("category is not used")), errs.join("\n"));
});
test("a wrong sha256 fails", () => {
  const errs = validate(fixture((d) => editMeta(d, (m) => { m.sha256 = "0".repeat(64); })));
  assert.ok(errs.some((e) => e.includes("sha256 does not match")), errs.join("\n"));
});
test("a wrong size fails", () => {
  const errs = validate(fixture((d) => editMeta(d, (m) => { m.size = 1; })));
  assert.ok(errs.some((e) => e.includes("size is 1")), errs.join("\n"));
});
test("two content files fail", () => {
  const errs = validate(fixture((d) => fs.writeFileSync(path.join(d, "pages", "welcome", "content.html"), "<p>x</p>")));
  assert.ok(errs.some((e) => e.includes("expected exactly one content file")), errs.join("\n"));
});
test("a content file that does not match the format fails", () => {
  const errs = validate(fixture((d) => {
    const dir = path.join(d, "pages", "welcome");
    const buf = fs.readFileSync(path.join(dir, "content.md"));
    fs.rmSync(path.join(dir, "content.md")); fs.writeFileSync(path.join(dir, "content.html"), buf);
  }));
  assert.ok(errs.some((e) => e.includes('does not match format "md"')), errs.join("\n"));
});
test("an invalid slug fails", () => {
  const errs = validate(fixture((d) => fs.renameSync(path.join(d, "pages", "welcome"), path.join(d, "pages", "Bad_Slug"))));
  assert.ok(errs.some((e) => e.includes("invalid slug")), errs.join("\n"));
});
test("a missing tags.json fails", () => {
  const errs = validate(fixture((d) => fs.rmSync(path.join(d, "tags.json"))));
  assert.ok(errs.some((e) => e.startsWith("tags.json: file is missing")), errs.join("\n"));
});
test("duplicate tags in tags.json fail", () => {
  const errs = validate(fixture((d) => fs.writeFileSync(path.join(d, "tags.json"), JSON.stringify({ tags: ["PQC", "PQC", "Lamassu", "Crypto Agility"] }))));
  assert.ok(errs.some((e) => e.includes('duplicate tag "PQC"')), errs.join("\n"));
});
test("an invalid status fails", () => {
  const errs = validate(fixture((d) => editMeta(d, (m) => { m.status = "final"; })));
  assert.ok(errs.some((e) => e.includes("status must be one of")), errs.join("\n"));
});
test("an article whose content matches a recomputed hash passes", () => {
  const d = fixture((dir) => {
    const buf = Buffer.from("## Changed\n");
    fs.writeFileSync(path.join(dir, "pages", "welcome", "content.md"), buf);
    editMeta(dir, (m) => { m.size = buf.length; m.sha256 = crypto.createHash("sha256").update(buf).digest("hex"); });
  });
  assert.deepEqual(validate(d), []);
});

test("a valid PDF in files/ passes", () => {
  assert.deepEqual(validate(fixture((d) => { fs.mkdirSync(path.join(d, "files")); fs.writeFileSync(path.join(d, "files", "tpm-2.0-spec.pdf"), "%PDF-1.4\n%%EOF\n"); })), []);
});
test("a file that is not a PDF fails", () => {
  const errs = validate(fixture((d) => { fs.mkdirSync(path.join(d, "files")); fs.writeFileSync(path.join(d, "files", "fake.pdf"), "<html>"); }));
  assert.ok(errs.some((e) => e === "files/fake.pdf: is not a PDF"), errs.join("\n"));
});
test("a bad file name or a folder in files/ fails", () => {
  const errs = validate(fixture((d) => { fs.mkdirSync(path.join(d, "files", "sub"), { recursive: true }); fs.writeFileSync(path.join(d, "files", "Bad Name.pdf"), "%PDF-1.4"); }));
  assert.ok(errs.some((e) => e.startsWith("files/Bad Name.pdf: invalid file name")), errs.join("\n"));
  assert.ok(errs.some((e) => e.startsWith("files/sub: only PDF files")), errs.join("\n"));
});
