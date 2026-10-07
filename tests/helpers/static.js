// Minimal static server for the tests: serves public/ under /research/ (no dependencies).
// Usage: node tests/helpers/static.js [port]
// /research/ serves public/index.test.html (built with tests/config.test.json); /research/index.dev.html is served as is.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PUB = path.resolve(__dirname, "..", "..", "public");
const port = Number(process.argv[2] || 8301);
const BASE = "/research/";

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/research") { res.writeHead(301, { Location: BASE }); return res.end(); }
  if (!url.pathname.startsWith(BASE)) { res.writeHead(404); return res.end("not found"); }
  let rel = url.pathname.slice(BASE.length) || "index.html";
  if (rel === "index.html") rel = "index.test.html";
  const file = path.join(PUB, rel);
  if (!file.startsWith(PUB + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end("not found"); }
  const TYPES = { ".html": "text/html; charset=utf-8", ".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm",
    ".ttf": "font/ttf", ".pfb": "application/octet-stream", ".bcmap": "application/octet-stream", ".icc": "application/octet-stream" };
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1", () => console.log(`static on http://127.0.0.1:${port}${BASE}`));
