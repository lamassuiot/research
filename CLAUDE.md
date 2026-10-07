# lama-library (Lamassu Research)

Wiki versionada de investigación de Lamassu, copiada del frontend de `ik-library` (`/home/ubuntu/dev/ik-library`, solo lectura). Es una página estática en GitHub Pages (`https://www.lamassu.io/research/`); el contenido está en el repo privado `lamassuiot/research-content`. No hay servidor propio. Ver `README.md`, `PLAN.md` y `TASK.md`.

## Arquitectura
- `frontend/index.template.html`: toda la UI (HTML + CSS + JS, estilo MediaWiki). `frontend/build.py` inyecta `frontend/config.json`, los logos y `vendor/` y genera `public/index.html` (+ `404.html`); `--dev` genera `public/index.dev.html` con `MemoryStore` y sin login.
- `AUTH` (en la plantilla): login con GitHub (code + PKCE); el código se canjea en el Worker. **El token solo vive en `AUTH.token`: nunca en `localStorage`, `sessionStorage`, cookies ni URL.** `sessionStorage` solo guarda `lr.auth` (state/verifier, se borra al volver) y `lr.auth.fail` (anti-bucle).
- `GitHubStore`: lee con GraphQL (cada consulta con `operationName` fijo) y el contenido de cada revisión por REST (`Accept: application/vnd.github.raw+json`); escribe con `createCommitOnBranch` + `expectedHeadOid` (3 reintentos). El rol sale del permiso sobre el repo de contenido.
- `worker/src/index.js`: Cloudflare Worker sin estado (`/token`, `/revoke`), solo responde a `ALLOWED_ORIGIN`.
- No hay categorías: solo etiquetas, de la lista cerrada `tags.json` del repo de contenido.
- CSP por `<meta>` (Pages no permite cabeceras). Los informes HTML van en un iframe `sandbox` sin `allow-same-origin`.

## Contrato de datos del repo de contenido
Ver la sección 4 de `TASK.md` y `content-template/README.md`: `tags.json`, `pages/<slug>/meta.json` + `content.md|html`, y trailers `Know-how-*` en cada commit. `content-template/scripts/validate.mjs` lo comprueba.

## Comandos
- `npm run build`: genera `public/index.html`, `index.dev.html` y `404.html`.
- `npm test`: tests unitarios (Worker y validador) + Playwright con GitHub simulado (`tests/helpers/fake-github.js`).
- Para probar a mano: `node tests/helpers/static.js 8301` y abrir `http://127.0.0.1:8301/research/index.dev.html`.

## Convenciones
- Commits en inglés, en imperativo.
- Cambios de UI: editar la plantilla, `npm run build` y commitear la plantilla junto con `public/` (el CI comprueba `git diff --exit-code public/`).
- No añadir dependencias de ejecución ni CDNs nuevos; no relajar la CSP ni `sandbox`.
- La UI está en inglés; la documentación para personas en español.
- No hacer push ni desplegar sin que lo pida una persona: los pasos manuales están en `docs/SETUP.md`.
