# lama-library (Lamassu Research)

Wiki versionada de investigación de Lamassu, copiada del frontend de `ik-library` (`/home/ubuntu/dev/ik-library`, solo lectura). Es una página estática en GitHub Pages (`https://www.lamassu.io/research/`); el contenido está en el repo privado `lamassuiot/research-content`. No hay servidor propio. Ver `README.md`, `PLAN.md` y `TASK.md`.

## Arquitectura
- `frontend/index.template.html`: toda la UI (HTML + CSS + JS, estilo MediaWiki). `frontend/build.py` inyecta `frontend/config.json`, los logos y `vendor/` y genera `public/index.html` (+ `404.html`); `--dev` genera `public/index.dev.html` con `MemoryStore` y sin login.
- `AUTH` (en la plantilla): login con GitHub (code + PKCE); el código se canjea en el Worker. **El token solo vive en `AUTH.token`: nunca en `localStorage`, `sessionStorage`, cookies ni URL.** `sessionStorage` solo guarda `lr.auth` (state/verifier, se borra al volver) y `lr.auth.fail` (anti-bucle).
- `GitHubStore`: lee con GraphQL (cada consulta con `operationName` fijo) y el contenido de cada revisión por REST (`Accept: application/vnd.github.raw+json`); escribe con `createCommitOnBranch` + `expectedHeadOid` (3 reintentos). El rol sale del permiso sobre el repo de contenido.
- `worker/src/index.js`: Cloudflare Worker sin estado (`/token`, `/revoke`), solo responde a `ALLOWED_ORIGIN`.
- Proyectos: `projects/<id>.json` = `{title, description, items:[{type:"page"|"link"|"file", id, children?}], created/updated…}`. Es un **contenedor**: el árbol (orden = orden del array; solo las páginas tienen hijos; un elemento pertenece a un solo proyecto; profundidad máx. 8) vive en ese único archivo, así mover, reordenar o anidar es un commit pequeño que no toca las páginas, enlaces ni archivos. `updateProject` hace lectura-modificación-escritura **dentro** del bucle de commit (con `expectedHeadOid` y reintentos), para no pisar cambios concurrentes. Al crear página/enlace/PDF desde un proyecto, la colocación va en el mismo commit (`placementChange`). Direcciones: `#/wiki/<proyecto>/<padre>/<página>` se deriva del árbol (`pagePath`); `openWiki` redirige cualquier dirección no canónica. Las direcciones de proyectos y artículos comparten espacio (el validador y la UI lo comprueban). Las referencias a elementos que ya no existen se ignoran (no se podan solas). **Etiquetas de proyecto:** `tags` es opcional; si un proyecto tiene etiquetas, se indexa él en `#/tag/<t>`, en los contadores y en *Browse by tag*, y **todo lo que cuelga de él (páginas y enlaces, a cualquier profundidad) deja de indexarse** (`S.inTagged`, `visiblePages()`, `tagCounts()`); sin etiquetas, sus páginas se indexan por las suyas. **Barra lateral en modo proyecto:** al leer dentro de un proyecto (página, su edición/historial, un PDF, o el proyecto) `body.proj-mode` oculta el menú principal y la lateral pasa a ser título del proyecto arriba + dos barras (estructura | contenidos); `projectContext()` lo decide solo a partir del hash, así que cambia al instante.
- Enlaces externos: `links/<id>.json` (un archivo por enlace para que dos altas simultáneas no choquen; `url` http(s) sin credenciales, `title`, `description`, `kind`, `tags` de `tags.json`, `addedBy/At`, `updatedBy/At`). Se añaden, editan y borran con `createCommitOnBranch` (`commitChanges`, con reintentos); trailers `Know-how-Link`. Se muestran con `target=_blank rel="noopener noreferrer nofollow"` y la app nunca contacta con esos sitios (la CSP lo impide).
- PDFs: `files/<nombre>.pdf` en el repo de contenido (`FILE_RE`, máx. 50 MB, deben empezar por `%PDF-`). Se suben con la API de Git Data (blob → tree → commit → `PATCH` de la ref sin forzar, 3 reintentos) y se ven con pdf.js (`public/vendor/pdfjs/`, cargado con `import()` solo al abrir uno; sin scripts ni eval). Sintaxis Markdown: `[[File:x.pdf]]`, `[[File:x.pdf#page=3|texto]]`, `![[File:x.pdf]]` (incrustado bajo demanda).
- No hay categorías: solo etiquetas, de la lista cerrada `tags.json` del repo de contenido.
- CSP por `<meta>` (Pages no permite cabeceras). `'self'` en `connect-src`, `font-src` y `worker-src` es para pdf.js (fuentes estándar, cmaps, wasm y su worker). Los informes HTML van en un iframe `sandbox` sin `allow-same-origin`.

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
