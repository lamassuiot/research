"""Builds the single self-contained page from the template.
Usage: python3 frontend/build.py [--dev] [--config FILE] [--out FILE]
  (default)  public/index.html (+ public/404.html copy), config from frontend/config.json
  --dev      public/index.dev.html with devMemoryStore=true (in-memory data, no sign-in)
  --config   use another config file; --out sets the output file (no 404.html copy)"""
import argparse, base64, json, pathlib
from urllib.parse import urlparse

here = pathlib.Path(__file__).resolve().parent
ap = argparse.ArgumentParser()
ap.add_argument("--dev", action="store_true")
ap.add_argument("--config")
ap.add_argument("--out")
a = ap.parse_args()

cfg = json.loads(pathlib.Path(a.config or here / "config.json").read_text(encoding="utf-8"))
cfg["devMemoryStore"] = bool(a.dev)
s = (here / "index.template.html").read_text(encoding="utf-8")

b64 = lambda f: "data:image/svg+xml;base64," + base64.b64encode((here / "assets" / f).read_bytes()).decode()
s = s.replace("__LOGO_DARK_INK__", b64("lamassu_logo_blue.svg")).replace("__LOGO_WHITE_INK__", b64("lamassu_logo_white.svg"))
for tag, f in [("VENDOR_MARKED", "marked.min.js"), ("VENDOR_PURIFY", "purify.min.js"), ("VENDOR_DIFF", "diff.min.js"), ("VENDOR_YAML", "js-yaml.min.js")]:
    s = s.replace(f"/*{tag}*/", (here / "vendor" / f).read_text(encoding="utf-8"))

u = urlparse(cfg["authWorkerUrl"])
worker_origin = f"{u.scheme}://{u.netloc}" if u.scheme and u.netloc else ""
s = s.replace("__AUTH_WORKER_ORIGIN__", "'self'" if a.dev else worker_origin)
s = s.replace("/*APP_CONFIG*/null", json.dumps(cfg, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/"))
s = s.replace("__SITE_NAME__", cfg["siteName"])
# the icon font only carries the icons listed in frontend/icons.txt (Google wants them in alphabetical order)
icons = sorted({l.strip() for l in (here / "icons.txt").read_text(encoding="utf-8").splitlines() if l.strip()})
s = s.replace("__ICON_NAMES__", ",".join(icons))
s = s.replace("__PRECONNECT_WORKER__", "" if a.dev or not worker_origin else f'<link rel="preconnect" href="{worker_origin}" crossorigin>')

public = here.parent / "public"
public.mkdir(exist_ok=True)
out = pathlib.Path(a.out) if a.out else public / ("index.dev.html" if a.dev else "index.html")
out.write_text(s, encoding="utf-8")
print(f"wrote {out} ({len(s)} chars)")
if not a.out and not a.dev:
    (public / "404.html").write_text(s, encoding="utf-8")
    print(f"wrote {public / '404.html'}")
