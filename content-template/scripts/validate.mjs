// Validates the content repository layout. Usage: node scripts/validate.mjs [dir]   (Node >= 20, no dependencies)
// Exit code 1 and a list of "path: message" lines when something is wrong.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const STATUSES = ["draft", "reviewed", "validated", "deprecated"];
const FORMATS = ["md", "html"];
const FILE_RE = /^[a-z0-9][a-z0-9._-]{0,95}\.pdf$/;
const MAX_FILE = 50 * 1024 * 1024;
const MAX_TREE_DEPTH = 8;
const LINK_FILE_RE = /^[a-z0-9][a-z0-9-]{0,79}\.json$/;
const LINK_KINDS = ["news", "blog", "paper", "video", "docs", "other"];
const REQUIRED_STR = ["title", "abstract", "updatedAt", "updatedBy", "createdAt", "createdBy", "sha256"];

export function validate(root) {
  const errors = [];
  const err = (p, msg) => errors.push(`${p}: ${msg}`);
  const readJson = (rel) => {
    try { return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")); }
    catch (e) { err(rel, e.code === "ENOENT" ? "file is missing" : "is not valid JSON"); return null; }
  };

  let tagList = [];
  const tj = readJson("tags.json");
  if (tj) {
    if (!Array.isArray(tj.tags) || !tj.tags.every((t) => typeof t === "string" && t.trim())) err("tags.json", '"tags" must be an array of non-empty strings');
    else {
      tagList = tj.tags;
      const seen = new Set();
      for (const t of tagList) { if (seen.has(t)) err("tags.json", `duplicate tag "${t}"`); seen.add(t); }
    }
  }

  const pagesDir = path.join(root, "pages");
  const slugs = fs.existsSync(pagesDir) ? fs.readdirSync(pagesDir) : [];
  for (const slug of slugs) {
    const dir = `pages/${slug}`;
    if (!fs.statSync(path.join(pagesDir, slug)).isDirectory()) { err(dir, "only article folders are allowed in pages/"); continue; }
    if (!SLUG_RE.test(slug)) { err(dir, "invalid slug (lowercase letters, digits and hyphens, up to 80 characters)"); continue; }
    const m = readJson(`${dir}/meta.json`);
    if (!m) continue;
    const mp = `${dir}/meta.json`;
    for (const k of REQUIRED_STR) if (typeof m[k] !== "string" || (!m[k] && k !== "abstract")) err(mp, `"${k}" must be a non-empty string`);
    if (typeof m.title === "string" && m.title.length > 200) err(mp, "title is longer than 200 characters");
    if (typeof m.abstract === "string" && m.abstract.length > 240) err(mp, "abstract is longer than 240 characters");
    if (!STATUSES.includes(m.status)) err(mp, `status must be one of ${STATUSES.join(", ")}`);
    if (!FORMATS.includes(m.format)) err(mp, `format must be one of ${FORMATS.join(", ")}`);
    if (!Number.isInteger(m.revN) || m.revN < 1) err(mp, "revN must be an integer >= 1");
    if (!Number.isInteger(m.size) || m.size < 0) err(mp, "size must be a non-negative integer");
    if (m.category !== undefined) err(mp, "category is not used: use tags");
    if (!Array.isArray(m.tags) || m.tags.length < 1 || m.tags.length > 20) err(mp, "tags must have between 1 and 20 entries");
    else {
      const seen = new Set();
      for (const t of m.tags) {
        if (!tagList.includes(t)) err(mp, `tag "${t}" is not listed in tags.json`);
        if (seen.has(t)) err(mp, `duplicate tag "${t}"`);
        seen.add(t);
      }
    }
    const contents = fs.readdirSync(path.join(pagesDir, slug)).filter((f) => /^content\./.test(f));
    if (contents.length !== 1) err(dir, `expected exactly one content file, found ${contents.length}`);
    else if (FORMATS.includes(m.format) && contents[0] !== `content.${m.format}`) err(dir, `${contents[0]} does not match format "${m.format}"`);
    else {
      const buf = fs.readFileSync(path.join(pagesDir, slug, contents[0]));
      if (m.size !== buf.length) err(mp, `size is ${m.size} but the content has ${buf.length} bytes`);
      const sha = crypto.createHash("sha256").update(buf).digest("hex");
      if (m.sha256 !== sha) err(mp, "sha256 does not match the content");
    }
  }
  const linksDir = path.join(root, "links");
  for (const name of fs.existsSync(linksDir) ? fs.readdirSync(linksDir) : []) {
    const rel = `links/${name}`;
    if (!LINK_FILE_RE.test(name) || !fs.statSync(path.join(linksDir, name)).isFile()) { err(rel, "invalid link file name (lowercase letters, digits and hyphens, ending in .json)"); continue; }
    const l = readJson(rel);
    if (!l) continue;
    let ok = false;
    try { const u = new URL(l.url); ok = (u.protocol === "http:" || u.protocol === "https:") && !u.username && !u.password; } catch { /* not a URL */ }
    if (!ok) err(rel, "url must be a full http(s) address without credentials");
    if (typeof l.title !== "string" || !l.title.trim() || l.title.length > 200) err(rel, "title must be 1-200 characters");
    if (l.description !== undefined && (typeof l.description !== "string" || l.description.length > 300)) err(rel, "description must be at most 300 characters");
    if (!LINK_KINDS.includes(l.kind)) err(rel, `kind must be one of ${LINK_KINDS.join(", ")}`);
    if (!Array.isArray(l.tags) || l.tags.length < 1 || l.tags.length > 20) err(rel, "tags must have between 1 and 20 entries");
    else for (const t of l.tags) if (!tagList.includes(t)) err(rel, `tag "${t}" is not listed in tags.json`);
    for (const k of ["addedAt", "addedBy", "updatedAt", "updatedBy"]) if (typeof l[k] !== "string" || !l[k]) err(rel, `"${k}" must be a non-empty string`);
  }

  const projectsDir = path.join(root, "projects");
  const pageSlugs = new Set(slugs);
  const placedIn = new Map();                       // "type:id" -> project, an item belongs to at most one project
  for (const name of fs.existsSync(projectsDir) ? fs.readdirSync(projectsDir) : []) {
    const rel = `projects/${name}`;
    if (!LINK_FILE_RE.test(name) || !fs.statSync(path.join(projectsDir, name)).isFile()) { err(rel, "invalid project file name (lowercase letters, digits and hyphens, ending in .json)"); continue; }
    const id = name.slice(0, -5), pj = readJson(rel);
    if (!pj) continue;
    if (pageSlugs.has(id)) err(rel, `the address "${id}" is already used by an article`);
    if (typeof pj.title !== "string" || !pj.title.trim() || pj.title.length > 200) err(rel, "title must be 1-200 characters");
    if (pj.description !== undefined && (typeof pj.description !== "string" || pj.description.length > 300)) err(rel, "description must be at most 300 characters");
    for (const k of ["createdAt", "createdBy", "updatedAt", "updatedBy"]) if (typeof pj[k] !== "string" || !pj[k]) err(rel, `"${k}" must be a non-empty string`);
    const walk = (list, depth, where) => {
      if (!Array.isArray(list)) { err(rel, `${where} must be an array`); return; }
      if (depth > MAX_TREE_DEPTH) { err(rel, `the tree is deeper than ${MAX_TREE_DEPTH} levels`); return; }
      for (const it of list) {
        if (!it || typeof it !== "object" || !["page", "link", "file"].includes(it.type) || typeof it.id !== "string" || !it.id) { err(rel, "every item needs a type (page, link or file) and an id"); continue; }
        const key = `${it.type}:${it.id}`;
        if (placedIn.has(key)) err(rel, `${key} is already in ${placedIn.get(key) === id ? "this project" : `the project "${placedIn.get(key)}"`}`);
        else placedIn.set(key, id);
        if (it.children !== undefined) { if (it.type !== "page") err(rel, `only pages can have children (${key})`); else walk(it.children, depth + 1, `children of ${it.id}`); }
      }
    };
    walk(pj.items, 1, "items");
  }

  const filesDir = path.join(root, "files");
  for (const name of fs.existsSync(filesDir) ? fs.readdirSync(filesDir) : []) {
    const rel = `files/${name}`, full = path.join(filesDir, name);
    if (!fs.statSync(full).isFile()) { err(rel, "only PDF files are allowed in files/ (no folders)"); continue; }
    if (!FILE_RE.test(name)) { err(rel, "invalid file name (lowercase letters, digits, dots, hyphens and underscores, ending in .pdf)"); continue; }
    const size = fs.statSync(full).size;
    if (size > MAX_FILE) err(rel, `is ${size} bytes; the limit is ${MAX_FILE}`);
    const fd = fs.openSync(full, "r"), head = Buffer.alloc(5); fs.readSync(fd, head, 0, 5, 0); fs.closeSync(fd);
    if (head.toString("latin1") !== "%PDF-") err(rel, "is not a PDF");
  }
  return errors;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = path.resolve(process.argv[2] || ".");
  const errors = validate(root);
  if (errors.length) { console.error(errors.join("\n")); console.error(`\n${errors.length} problem(s) found`); process.exit(1); }
  console.log("Content is valid");
}
