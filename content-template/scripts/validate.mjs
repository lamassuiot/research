// Validates the content repository layout. Usage: node scripts/validate.mjs [dir]   (Node >= 20, no dependencies)
// Exit code 1 and a list of "path: message" lines when something is wrong.
//
// Layout: everything lives inside a project.
//   projects/<id>/project.json
//   projects/<id>/pages/<slug>/meta.json + content.md|html|json|yaml|yml
//   projects/<id>/links/<id>.json
//   projects/<id>/files/<name>.pdf|json|yaml|yml
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const STATUSES = ["draft", "reviewed", "validated", "deprecated"];
const FORMATS = ["md", "html", "json", "yaml", "yml"];
const FILE_RE = /^[a-z0-9][a-z0-9._-]{0,95}\.(?:pdf|json|yaml|yml)$/;
const MAX_FILE = 50 * 1024 * 1024;
const MAX_TREE_DEPTH = 8;
const LINK_FILE_RE = /^[a-z0-9][a-z0-9-]{0,79}\.json$/;
const LINK_KINDS = ["news", "blog", "paper", "video", "docs", "other"];
const REQUIRED_STR = ["title", "abstract", "updatedAt", "updatedBy", "createdAt", "createdBy"];

export function validate(root) {
  const errors = [];
  const err = (p, msg) => errors.push(`${p}: ${msg}`);
  const readJson = (rel) => {
    try { return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")); }
    catch (e) { err(rel, e.code === "ENOENT" ? "file is missing" : "is not valid JSON"); return null; }
  };
  const listDir = (rel) => { const full = path.join(root, rel); return fs.existsSync(full) ? fs.readdirSync(full) : []; };
  const isDir = (rel) => fs.statSync(path.join(root, rel)).isDirectory();

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

  for (const old of ["pages", "links", "files"]) {
    if (fs.existsSync(path.join(root, old))) err(old, `no longer used: everything lives inside a project (projects/<id>/${old}/)`);
  }

  const owner = { page: new Map(), link: new Map(), file: new Map() };   // item id -> project, ids are unique across projects
  const claim = (type, id, project, rel) => {
    if (owner[type].has(id)) err(rel, `the ${type} "${id}" also exists in the project "${owner[type].get(id)}"`);
    else owner[type].set(id, project);
  };

  const projectDirs = new Map(), physicalParents = new Map();
  function discover(container, parent, ancestors=new Set()) {
    const full = path.join(root, container);
    if (!fs.existsSync(full)) return;
    const real = fs.realpathSync(full);
    if (ancestors.has(real)) { err(container, 'project folders create a cycle'); return; }
    const next = new Set(ancestors).add(real);
    for (const id of listDir(container)) {
      const base = `${container}/${id}`;
      if (!isDir(base)) { err(base, 'only project folders are allowed in projects/'); continue; }
      if (!SLUG_RE.test(id)) { err(base, 'invalid project address (lowercase letters, digits and hyphens, up to 80 characters)'); continue; }
      if (projectDirs.has(id)) { err(base, `duplicate project id "${id}"`); continue; }
      projectDirs.set(id, base); physicalParents.set(id, parent);
      discover(`${base}/projects`, id, next);
    }
  }
  discover('projects', null);
  const projects = new Map();
  for (const [id, base] of projectDirs) {
    const rel = `${base}/project.json`;
    const pj = readJson(rel);
    if (pj) projects.set(id, pj);
    for (const n of listDir(base)) if (!["project.json", "pages", "links", "files", "projects"].includes(n)) err(`${base}/${n}`, "unexpected entry in a project folder");
    if (pj) {
      if (typeof pj.title !== "string" || !pj.title.trim() || pj.title.length > 200) err(rel, "title must be 1-200 characters");
      if (pj.description !== undefined && (typeof pj.description !== "string" || pj.description.length > 300)) err(rel, "description must be at most 300 characters");
      for (const k of ["createdAt", "createdBy", "updatedAt", "updatedBy"]) if (typeof pj[k] !== "string" || !pj[k]) err(rel, `"${k}" must be a non-empty string`);
      if (pj.intro !== undefined && (typeof pj.intro !== "string" || pj.intro.length > 50000)) err(rel, "intro must be a Markdown string of at most 50000 characters");
      if (pj.tags !== undefined) {                     // optional; a tagged project is indexed in the tags instead of its children
        if (!Array.isArray(pj.tags) || pj.tags.length > 20) err(rel, "tags must be an array of at most 20 entries");
        else { const seen = new Set(); for (const t of pj.tags) { if (!tagList.includes(t)) err(rel, `tag "${t}" is not listed in tags.json`); if (seen.has(t)) err(rel, `duplicate tag "${t}"`); seen.add(t); } }
      }
    }

    /* pages */
    const slugs = [];
    for (const slug of listDir(`${base}/pages`)) {
      const dir = `${base}/pages/${slug}`;
      if (!isDir(dir)) { err(dir, "only article folders are allowed in pages/"); continue; }
      if (!SLUG_RE.test(slug)) { err(dir, "invalid slug (lowercase letters, digits and hyphens, up to 80 characters)"); continue; }
      slugs.push(slug); claim("page", slug, id, dir);
      const mp = `${dir}/meta.json`, m = readJson(mp);
      if (!m) continue;
      for (const k of REQUIRED_STR) if (typeof m[k] !== "string" || (!m[k] && k !== "abstract")) err(mp, `"${k}" must be a non-empty string`);
      if (typeof m.title === "string" && m.title.length > 200) err(mp, "title is longer than 200 characters");
      if (typeof m.abstract === "string" && m.abstract.length > 240) err(mp, "abstract is longer than 240 characters");
      if (!STATUSES.includes(m.status)) err(mp, `status must be one of ${STATUSES.join(", ")}`);
      if (!FORMATS.includes(m.format)) err(mp, `format must be one of ${FORMATS.join(", ")}`);
      if (!Number.isInteger(m.revN) || m.revN < 1) err(mp, "revN must be an integer >= 1");
      if (m.category !== undefined) err(mp, "category is not used: use tags");
      if (!Array.isArray(m.tags) || m.tags.length > 20) err(mp, "tags must be an array of at most 20 entries");
      else {
        const seen = new Set();
        for (const t of m.tags) {
          if (!tagList.includes(t)) err(mp, `tag "${t}" is not listed in tags.json`);
          if (seen.has(t)) err(mp, `duplicate tag "${t}"`);
          seen.add(t);
        }
      }
      const contents = listDir(dir).filter((f) => /^content\./.test(f));
      if (contents.length !== 1) err(dir, `expected exactly one content file, found ${contents.length}`);
      else if (FORMATS.includes(m.format) && contents[0] !== `content.${m.format}`) err(dir, `${contents[0]} does not match format "${m.format}"`);
    }

    /* links */
    const linkIds = [];
    for (const name of listDir(`${base}/links`)) {
      const lrel = `${base}/links/${name}`;
      if (!LINK_FILE_RE.test(name) || !fs.statSync(path.join(root, lrel)).isFile()) { err(lrel, "invalid link file name (lowercase letters, digits and hyphens, ending in .json)"); continue; }
      linkIds.push(name.slice(0, -5)); claim("link", name.slice(0, -5), id, lrel);
      const l = readJson(lrel);
      if (!l) continue;
      let ok = false;
      try { const u = new URL(l.url); ok = (u.protocol === "http:" || u.protocol === "https:") && !u.username && !u.password; } catch { /* not a URL */ }
      if (!ok) err(lrel, "url must be a full http(s) address without credentials");
      if (typeof l.title !== "string" || !l.title.trim() || l.title.length > 200) err(lrel, "title must be 1-200 characters");
      if (l.description !== undefined && (typeof l.description !== "string" || l.description.length > 300)) err(lrel, "description must be at most 300 characters");
      if (!LINK_KINDS.includes(l.kind)) err(lrel, `kind must be one of ${LINK_KINDS.join(", ")}`);
      for (const k of ["image", "icon"]) if (l[k] !== undefined) {              // optional preview data read by the Worker
        let good = typeof l[k] === "string" && l[k].length <= 600;
        try { const u = new URL(l[k]); good = good && (u.protocol === "http:" || u.protocol === "https:") && !u.username && !u.password; } catch { good = false; }
        if (!good) err(lrel, `${k} must be an http(s) address of at most 600 characters`);
      }
      if (l.siteName !== undefined && (typeof l.siteName !== "string" || !l.siteName.trim() || l.siteName.length > 80)) err(lrel, "siteName must be 1-80 characters");
      if (!Array.isArray(l.tags) || l.tags.length > 20) err(lrel, "tags must be an array of at most 20 entries");
      else for (const t of l.tags) if (!tagList.includes(t)) err(lrel, `tag "${t}" is not listed in tags.json`);
      for (const k of ["addedAt", "addedBy", "updatedAt", "updatedBy"]) if (typeof l[k] !== "string" || !l[k]) err(lrel, `"${k}" must be a non-empty string`);
    }

    /* files */
    const fileNames = [];
    for (const name of listDir(`${base}/files`)) {
      const frel = `${base}/files/${name}`, full = path.join(root, frel);
      if (!fs.statSync(full).isFile()) { err(frel, "only PDF, JSON and YAML files are allowed in files/ (no folders)"); continue; }
      if (!FILE_RE.test(name)) { err(frel, "invalid file name (lowercase letters, digits, dots, hyphens and underscores, ending in .pdf, .json, .yaml or .yml)"); continue; }
      fileNames.push(name); claim("file", name, id, frel);
      const size = fs.statSync(full).size;
      if (size > MAX_FILE) err(frel, `is ${size} bytes; the limit is ${MAX_FILE}`);
      if (name.endsWith(".pdf")) {
        const fd = fs.openSync(full, "r"), head = Buffer.alloc(5); fs.readSync(fd, head, 0, 5, 0); fs.closeSync(fd);
        if (head.toString("latin1") !== "%PDF-") err(frel, "is not a PDF");
      }
    }

    /* the structure: only items that live in this project, each at most once. Items missing from it are appended at the top level when read. */
    if (pj) {
      const have = { page: new Set(slugs), link: new Set(linkIds), file: new Set(fileNames) }, seen = new Set();
      const walk = (list, depth, where) => {
        if (!Array.isArray(list)) { err(rel, `${where} must be an array`); return; }
        if (depth > MAX_TREE_DEPTH) { err(rel, `the tree is deeper than ${MAX_TREE_DEPTH} levels`); return; }
        for (const it of list) {
          if (!it || typeof it !== "object" || !["page", "link", "file"].includes(it.type) || typeof it.id !== "string" || !it.id) { err(rel, "every item needs a type (page, link or file) and an id"); continue; }
          const key = `${it.type}:${it.id}`;
          if (seen.has(key)) err(rel, `${key} appears twice in the structure`);
          seen.add(key);
          if (!have[it.type].has(it.id)) err(rel, `${key} is in the structure but not in this project's folder`);
          if (it.children !== undefined) { if (it.type !== "page") err(rel, `only pages can have children (${key})`); else walk(it.children, depth + 1, `children of ${it.id}`); }
        }
      };
      walk(pj.items, 1, "items");
    }
  }

  for (const [id, pj] of projects) {
    if (pj.parentProject === undefined) continue;
    const rel = `${projectDirs.get(id)}/project.json`;
    if (typeof pj.parentProject !== 'string' || !SLUG_RE.test(pj.parentProject)) {
      err(rel, 'parentProject must be a valid project id');
      continue;
    }
    if (pj.parentProject !== physicalParents.get(id)) err(rel, 'parentProject must match the containing project folder');
    const seen = new Set([id]);
    let parent = pj.parentProject;
    while (parent) {
      if (seen.has(parent)) { err(rel, 'parentProject creates a cycle'); break; }
      seen.add(parent);
      if (!projects.has(parent)) { err(rel, `parent project "${parent}" does not exist`); break; }
      const next = projects.get(parent).parentProject;
      if (next !== undefined && (typeof next !== 'string' || !SLUG_RE.test(next))) break;
      parent = next;
    }
  }

  /* a project address and an article slug share the #/wiki/ namespace */
  for (const [id, base] of projectDirs) if (owner.page.has(id)) err(base, `the address "${id}" is already used by an article`);
  return errors;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = path.resolve(process.argv[2] || ".");
  const errors = validate(root);
  if (errors.length) { console.error(errors.join("\n")); console.error(`\n${errors.length} problem(s) found`); process.exit(1); }
  console.log("Content is valid");
}
