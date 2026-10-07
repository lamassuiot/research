// One-off migration of the content repository to "everything lives inside a project":
//
//   projects/<id>.json   ->  projects/<id>/project.json
//   pages/<slug>/        ->  projects/<project>/pages/<slug>/
//   links/<id>.json      ->  projects/<project>/links/<id>.json
//   files/<name>.pdf     ->  projects/<project>/files/<name>.pdf
//
// An item goes to the project whose structure mentions it; everything else goes to the "general" project (created if needed).
// Usage, on a clone of the content repository:   node scripts/migrate-to-project-folders.mjs <dir> [--dry-run]
// Then:  node <dir>/scripts/validate.mjs <dir>   and commit. Nothing is pushed by this script.
import fs from "node:fs";
import path from "node:path";

const GENERAL = "general";
const args = process.argv.slice(2), dry = args.includes("--dry-run"), root = path.resolve(args.find((a) => !a.startsWith("--")) || ".");
const p = (...x) => path.join(root, ...x);
const ls = (rel) => (fs.existsSync(p(rel)) ? fs.readdirSync(p(rel)) : []);
const log = (m) => console.log((dry ? "[dry-run] " : "") + m);
const move = (from, to) => { log(`${from} -> ${to}`); if (dry) return; fs.mkdirSync(path.dirname(p(to)), { recursive: true }); fs.renameSync(p(from), p(to)); };

const now = new Date().toISOString();
const projects = new Map();                                    // id -> project object
for (const n of ls("projects")) {
  if (!n.endsWith(".json") || !fs.statSync(p("projects", n)).isFile()) continue;
  projects.set(n.slice(0, -5), JSON.parse(fs.readFileSync(p("projects", n), "utf8")));
}
if (!projects.size && !ls("pages").length && !ls("links").length && !ls("files").length) { console.log("Nothing to migrate."); process.exit(0); }
if (!projects.has(GENERAL)) projects.set(GENERAL, { title: "General", description: "Everything that does not belong to a more specific project.", tags: [], items: [], createdAt: now, createdBy: "migration", updatedAt: now, updatedBy: "migration" });

const exists = { page: new Set(ls("pages")), link: new Set(ls("links").map((n) => n.replace(/\.json$/, ""))), file: new Set(ls("files")) };
const placed = new Map();                                      // "type:id" -> project id
for (const [id, pj] of projects) {
  const prune = (items) => (items || []).filter((it) => {
    const key = `${it.type}:${it.id}`;
    if (!exists[it.type] || !exists[it.type].has(it.id)) { log(`dropping ${key} from ${id}: it does not exist`); return false; }
    if (placed.has(key)) { log(`dropping ${key} from ${id}: already in ${placed.get(key)}`); return false; }
    placed.set(key, id);
    if (it.children) { it.children = prune(it.children); if (!it.children.length) delete it.children; }
    return true;
  });
  pj.items = prune(pj.items);
}
const general = projects.get(GENERAL);
for (const type of ["page", "link", "file"]) {
  for (const id of [...exists[type]].sort()) if (!placed.has(`${type}:${id}`)) { log(`${type}:${id} is in no project: it goes to ${GENERAL}`); general.items.push({ type, id }); placed.set(`${type}:${id}`, GENERAL); }
}

// 1. projects/<id>.json -> projects/<id>/project.json (written after the items have moved)
const dirs = { page: ["pages", (id) => id], link: ["links", (id) => `${id}.json`], file: ["files", (id) => id] };
for (const [key, project] of placed) {
  const [type, ...rest] = key.split(":"), id = rest.join(":"), [folder, name] = dirs[type];
  move(`${folder}/${name(id)}`, `projects/${project}/${folder}/${name(id)}`);
}
for (const [id, pj] of projects) {
  const from = `projects/${id}.json`, to = `projects/${id}/project.json`;
  log(`${from} -> ${to}`);
  if (dry) continue;
  fs.mkdirSync(p("projects", id), { recursive: true });
  fs.rmSync(p(from), { force: true });
  fs.writeFileSync(p(to), JSON.stringify(pj, null, 2) + "\n");
}
if (!dry) for (const d of ["pages", "links", "files"]) if (fs.existsSync(p(d)) && !fs.readdirSync(p(d)).length) fs.rmdirSync(p(d));
log(`done: ${projects.size} project(s), ${placed.size} item(s)`);
