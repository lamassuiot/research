# lama-library · Lamassu Research

Wiki versionada de investigación de Lamassu (PKI, X.509, PQC, RFCs…), publicada como una página estática en **GitHub Pages** (`https://www.lamassu.io/research/`). No hay servidor propio.

- **Todo exige login con GitHub.** El acceso lo decide GitHub: hay que tener permiso sobre el repositorio privado de contenido (a través de un team).
- Los artículos viven en **`lamassuiot/research-content`** (privado). El navegador los lee y escribe con la API de GitHub y el token del propio usuario; cada guardado es un commit suyo.
- Una función de **Cloudflare Workers** (plan gratuito) canjea el código OAuth por el token, porque eso exige el *client secret*.
- Los artículos se clasifican con **etiquetas** (lista cerrada en `tags.json`). No hay categorías.
- **PDFs** (manuales, especificaciones) en `files/` del mismo repo privado, hasta 50 MB. Se enlazan con `[[File:nombre.pdf]]` (o `#page=12`), se incrustan con `![[File:nombre.pdf]]` y se ven en un visor propio (pdf.js, en `public/vendor/pdfjs/`).

```
Navegador ──▶ www.lamassu.io/research (GitHub Pages: solo la app, sin contenido)
   │ 1. login ─▶ github.com (GitHub App, PKCE)
   │ 2. code  ─▶ Cloudflare Worker ─▶ token (8 h, solo en memoria)
   ▼ 3. lectura/escritura con el token del usuario
 api.github.com ─▶ repo privado lamassuiot/research-content
```

El token vive solo en una variable JavaScript: no se guarda en `localStorage`, `sessionStorage`, cookies ni en la URL. Al recargar, GitHub devuelve uno nuevo sin preguntar.

## Desarrollo
```bash
npm install                          # solo @playwright/test
npx playwright install chromium      # la primera vez
python3 frontend/build.py            # public/index.html (+ 404.html)
python3 frontend/build.py --dev      # public/index.dev.html: datos en memoria, sin login
node tests/helpers/static.js 8301    # sirve public/ en http://127.0.0.1:8301/research/ (index.dev.html para probar)
npm test                             # worker + validador (node:test) y Playwright con un GitHub simulado
```
`public/index.html` es una salida del build pero se commitea. Tras editar `frontend/index.template.html`, ejecuta `npm run build` y commitea la plantilla junto con `public/`.

## Estructura
- `public/vendor/pdfjs/`: pdf.js 6.4.299 (build *legacy*, Apache-2.0), copiado sin cambios del paquete npm; se carga solo al abrir un PDF.
- `frontend/`: plantilla de la UI (`index.template.html`), `build.py`, `config.json`, logos y librerías (`vendor/`: marked, DOMPurify, jsdiff).
- `worker/`: Cloudflare Worker (`src/index.js`) y sus tests.
- `content-template/`: contenido inicial de `research-content`, con su validador y workflow.
- `tests/`: Playwright, con `helpers/fake-github.js` (GitHub, OAuth y Worker simulados).
- `docs/SETUP.md`: pasos manuales en GitHub y Cloudflare.
- `PLAN.md`, `TASK.md`: diseño y tarea de implementación. `REPORT.md`: resultado de la implementación.
