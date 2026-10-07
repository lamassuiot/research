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
const G = (...p) => path.join("projects", "general", ...p);       // paths inside the General project
const metaPath = (dir, slug = "welcome") => path.join(dir, G("pages", slug, "meta.json"));
const editMeta = (dir, fn, slug) => { const m = JSON.parse(fs.readFileSync(metaPath(dir, slug), "utf8")); fn(m); fs.writeFileSync(metaPath(dir, slug), JSON.stringify(m, null, 2) + "\n"); };

test("the template passes", () => {
  assert.deepEqual(validate(TEMPLATE), []);
});
test("an unknown tag fails", () => {
  const errs = validate(fixture((d) => editMeta(d, (m) => { m.tags = ["Nope"]; })));
  assert.ok(errs.some((e) => e.includes('tag "Nope" is not listed in tags.json')), errs.join("\n"));
});
test("no tags is fine; more than 20 fails", () => {
  assert.deepEqual(validate(fixture((d) => editMeta(d, (m) => { m.tags = []; }))), []);
  const errs = validate(fixture((d) => editMeta(d, (m) => { m.tags = Array.from({ length: 21 }, (_, i) => "t" + i); })));
  assert.ok(errs.some((e) => e.includes("tags must be an array of at most 20 entries")), errs.join("\n"));
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
  const errs = validate(fixture((d) => fs.writeFileSync(path.join(d, G("pages", "welcome", "content.html")), "<p>x</p>")));
  assert.ok(errs.some((e) => e.includes("expected exactly one content file")), errs.join("\n"));
});
test("a content file that does not match the format fails", () => {
  const errs = validate(fixture((d) => {
    const dir = path.join(d, G("pages", "welcome"));
    const buf = fs.readFileSync(path.join(dir, "content.md"));
    fs.rmSync(path.join(dir, "content.md")); fs.writeFileSync(path.join(dir, "content.html"), buf);
  }));
  assert.ok(errs.some((e) => e.includes('does not match format "md"')), errs.join("\n"));
});
test("an invalid slug fails", () => {
  const errs = validate(fixture((d) => fs.renameSync(path.join(d, G("pages", "welcome")), path.join(d, G("pages", "Bad_Slug")))));
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
    fs.writeFileSync(path.join(dir, G("pages", "welcome", "content.md")), buf);
    editMeta(dir, (m) => { m.size = buf.length; m.sha256 = crypto.createHash("sha256").update(buf).digest("hex"); });
  });
  assert.deepEqual(validate(d), []);
});

test("a valid PDF in files/ passes", () => {
  assert.deepEqual(validate(fixture((d) => { fs.mkdirSync(path.join(d, G("files"))); fs.writeFileSync(path.join(d, G("files", "tpm-2.0-spec.pdf")), "%PDF-1.4\n%%EOF\n"); })), []);
});
test("a file that is not a PDF fails", () => {
  const errs = validate(fixture((d) => { fs.mkdirSync(path.join(d, G("files"))); fs.writeFileSync(path.join(d, G("files", "fake.pdf")), "<html>"); }));
  assert.ok(errs.some((e) => e === "projects/general/files/fake.pdf: is not a PDF"), errs.join("\n"));
});
test("a bad file name or a folder in files/ fails", () => {
  const errs = validate(fixture((d) => { fs.mkdirSync(path.join(d, G("files", "sub")), { recursive: true }); fs.writeFileSync(path.join(d, G("files", "Bad Name.pdf")), "%PDF-1.4"); }));
  assert.ok(errs.some((e) => e.startsWith("projects/general/files/Bad Name.pdf: invalid file name")), errs.join("\n"));
  assert.ok(errs.some((e) => e.startsWith("projects/general/files/sub: only PDF files")), errs.join("\n"));
});

const goodLink = { url: "https://example.org/post", title: "A post", description: "", kind: "blog", tags: ["PQC"],
  addedAt: "2026-10-07T00:00:00.000Z", addedBy: "ada", updatedAt: "2026-10-07T00:00:00.000Z", updatedBy: "ada" };
const withLink = (l) => (d) => { fs.mkdirSync(path.join(d, G("links"))); fs.writeFileSync(path.join(d, G("links", "a-post.json")), JSON.stringify(l, null, 2) + "\n"); };
test("a valid link passes", () => { assert.deepEqual(validate(fixture(withLink(goodLink))), []); });
test("a javascript: or credentialed link address fails", () => {
  for (const url of ["javascript:alert(1)", "https://user:pw@example.org/", "not a url"]) {
    const errs = validate(fixture(withLink({ ...goodLink, url })));
    assert.ok(errs.some((e) => e.includes("url must be a full http(s) address")), url + "\n" + errs.join("\n"));
  }
});
test("a link with an unknown tag, kind or no tags fails", () => {
  assert.ok(validate(fixture(withLink({ ...goodLink, tags: ["Nope"] }))).some((e) => e.includes('tag "Nope" is not listed')));
  assert.deepEqual(validate(fixture(withLink({ ...goodLink, tags: [] }))), []);
  assert.ok(validate(fixture(withLink({ ...goodLink, kind: "tweet" }))).some((e) => e.includes("kind must be one of")));
});
test("a bad link file name fails", () => {
  const errs = validate(fixture((d) => { fs.mkdirSync(path.join(d, G("links"))); fs.writeFileSync(path.join(d, G("links", "Bad Name.json")), "{}"); }));
  assert.ok(errs.some((e) => e.startsWith("projects/general/links/Bad Name.json: invalid link file name")), errs.join("\n"));
});

const proj = (items, extra = {}) => ({ title: "P", description: "", items, createdAt: "2026-10-07T00:00:00.000Z", createdBy: "ada", updatedAt: "2026-10-07T00:00:00.000Z", updatedBy: "ada", ...extra });
const editProject = (d, fn, id = "general") => { const p = path.join(d, "projects", id, "project.json"); const j = JSON.parse(fs.readFileSync(p, "utf8")); fn(j); fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n"); };
const newProject = (d, id, p) => { fs.mkdirSync(path.join(d, "projects", id), { recursive: true }); fs.writeFileSync(path.join(d, "projects", id, "project.json"), JSON.stringify(p, null, 2) + "\n"); };

test("a valid project with nested sub-pages, a link and a file passes", () => {
  const d = fixture((dir) => {
    withLink(goodLink)(dir); fs.mkdirSync(path.join(dir, G("files"))); fs.writeFileSync(path.join(dir, G("files", "a.pdf")), "%PDF-1.4\n");
    editProject(dir, (p) => { p.items = [{ type: "page", id: "welcome", children: [{ type: "page", id: "pqc-migration-notes" }] }, { type: "link", id: "a-post" }, { type: "file", id: "a.pdf" }]; });
  });
  assert.deepEqual(validate(d), []);
});
test("items that exist but are missing from the structure are fine", () => {
  assert.deepEqual(validate(fixture((d) => editProject(d, (p) => { p.items = []; }))), []);
});
test("the structure cannot name an item that is not in the project", () => {
  const errs = validate(fixture((d) => { newProject(d, "other", proj([{ type: "page", id: "welcome" }, { type: "link", id: "nope" }])); }));
  assert.ok(errs.some((e) => e.includes("page:welcome is in the structure but not in this project's folder")), errs.join("\n"));
  assert.ok(errs.some((e) => e.includes("link:nope is in the structure but not")), errs.join("\n"));
});
test("an item twice in the structure fails", () => {
  const errs = validate(fixture((d) => editProject(d, (p) => { p.items = [{ type: "page", id: "welcome" }, { type: "page", id: "welcome" }]; })));
  assert.ok(errs.some((e) => e.includes("page:welcome appears twice")), errs.join("\n"));
});
test("a slug, link id or file name cannot exist in two projects", () => {
  const errs = validate(fixture((d) => { newProject(d, "other", proj([])); fs.cpSync(path.join(d, G("pages", "welcome")), path.join(d, "projects", "other", "pages", "welcome"), { recursive: true }); }));
  assert.ok(errs.some((e) => e.includes('the page "welcome" also exists in the project "general"')), errs.join("\n"));
});
test("a project cannot share an address with an article", () => {
  const errs = validate(fixture((d) => newProject(d, "welcome", proj([]))));
  assert.ok(errs.some((e) => e.includes('"welcome" is already used by an article')), errs.join("\n"));
});
test("the old top-level pages/, links/ and files/ are rejected", () => {
  for (const old of ["pages", "links", "files"]) {
    const errs = validate(fixture((d) => fs.mkdirSync(path.join(d, old))));
    assert.ok(errs.some((e) => e.startsWith(`${old}: no longer used`)), errs.join("\n"));
  }
});
test("a stray file in projects/ or in a project folder fails", () => {
  assert.ok(validate(fixture((d) => fs.writeFileSync(path.join(d, "projects", "old.json"), "{}"))).some((e) => e.includes("only project folders are allowed")));
  assert.ok(validate(fixture((d) => fs.writeFileSync(path.join(d, G("notes.md")), "x"))).some((e) => e.includes("unexpected entry in a project folder")));
});
test("only pages can have children; unknown types and a too deep tree fail", () => {
  assert.ok(validate(fixture((d) => { withLink(goodLink)(d); editProject(d, (p) => { p.items = [{ type: "link", id: "a-post", children: [{ type: "page", id: "welcome" }] }]; }); })).some((e) => e.includes("only pages can have children")));
  assert.ok(validate(fixture((d) => editProject(d, (p) => { p.items = [{ type: "note", id: "n" }]; }))).some((e) => e.includes("every item needs a type")));
  let deep = [{ type: "page", id: "p0" }]; for (let i = 1; i < 10; i++) deep = [{ type: "page", id: "p" + i, children: deep }];
  assert.ok(validate(fixture((d) => editProject(d, (p) => { p.items = deep; }))).some((e) => e.includes("deeper than 8 levels")));
});
test("a project without a title or without project.json fails", () => {
  assert.ok(validate(fixture((d) => editProject(d, (p) => { p.title = ""; }))).some((e) => e.includes("title must be 1-200 characters")));
  const errs = validate(fixture((d) => fs.mkdirSync(path.join(d, "projects", "empty"))));
  assert.ok(errs.some((e) => e === "projects/empty/project.json: file is missing"), errs.join("\n"));
  assert.ok(validate(fixture((d) => fs.mkdirSync(path.join(d, "projects", "Bad Name")))).some((e) => e.startsWith("projects/Bad Name: invalid project address")));
});
test("a project may have tags; unknown or duplicate tags fail", () => {
  assert.deepEqual(validate(fixture((d) => editProject(d, (p) => { p.tags = ["PQC", "Lamassu RFCs"]; }))), []);
  assert.ok(validate(fixture((d) => editProject(d, (p) => { p.tags = ["Nope"]; }))).some((e) => e.includes('tag "Nope" is not listed')));
  assert.ok(validate(fixture((d) => editProject(d, (p) => { p.tags = ["PQC", "PQC"]; }))).some((e) => e.includes('duplicate tag "PQC"')));
  assert.ok(validate(fixture((d) => editProject(d, (p) => { p.tags = "PQC"; }))).some((e) => e.includes("tags must be an array")));
});
test("a project may have an introduction; a non-string or oversized one fails", () => {
  assert.deepEqual(validate(fixture((d) => editProject(d, (p) => { p.intro = "## Hello\n\nSome *Markdown*."; }))), []);
  assert.ok(validate(fixture((d) => editProject(d, (p) => { p.intro = 5; }))).some((e) => e.includes("intro must be a Markdown string")));
  assert.ok(validate(fixture((d) => editProject(d, (p) => { p.intro = "x".repeat(50001); }))).some((e) => e.includes("at most 50000")));
});
