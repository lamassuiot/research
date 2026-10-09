# lama-library · Lamassu Research

Wiki versionada de investigación de Lamassu (PKI, X.509, PQC, RFCs…), publicada como una página estática en **GitHub Pages** (`https://www.lamassu.io/research/`). No hay servidor propio.

- **Todo exige login con GitHub.** El acceso lo decide GitHub: hay que tener permiso sobre el repositorio privado de contenido (a través de un team).
- Los artículos viven en **`lamassuiot/research-content`** (privado). El navegador los lee y escribe con la API de GitHub y el token del propio usuario; cada guardado es un commit suyo.
- Una función de **Cloudflare Workers** (plan gratuito) canjea el código OAuth por el token, porque eso exige el *client secret*.
- Los artículos se clasifican con **etiquetas** (lista cerrada en `tags.json`). No hay categorías.
- **Proyectos:** son el núcleo. Todo vive dentro de uno: sus páginas (con subpáginas), enlaces y PDFs están en la carpeta del proyecto (`projects/<id>/`), y un único árbol JSON, `projects/<id>/project.json`, fija el orden y la anidación. La portada de la app es la lista de proyectos; mover algo a otro proyecto es un commit. El ancho de la barra lateral se ajusta arrastrando su borde (el contenido ocupa el resto). La portada de un proyecto muestra sus enlaces y PDFs como tarjetas de acceso rápido y, debajo, una introducción en Markdown. Un proyecto puede tener etiquetas: entonces se indexa él y no sus páginas hijas. Dentro de un proyecto la barra lateral muestra su título, su estructura y los contenidos de la página, en lugar del menú principal. Las páginas de un proyecto tienen direcciones estilo MediaWiki, `#/wiki/proyecto/padre/pagina`; la dirección corta antigua redirige.
- **Subproyectos:** se anidan físicamente en `projects/<padre>/projects/<hijo>/`. Cada uno tiene su portada, estructura y contenidos. La carpeta determina el padre; `parentProject` es opcional y debe coincidir con ella. Cambiar de padre mueve el proyecto y todos sus descendientes en un solo commit, conservando sus IDs y URLs.
- **Enlaces externos** (noticias, blogs, papers): un archivo `projects/<id>/links/<id>.json` por enlace en el repo de contenido, con título, nota, tipo y etiquetas. Página *External links* con filtros; también salen en la página de cada etiqueta.
- **PDFs** (manuales, especificaciones) en `projects/<id>/files/` del mismo repo privado, hasta 50 MB. Se enlazan con `[[File:nombre.pdf]]` (o `#page=12`), se incrustan con `![[File:nombre.pdf]]` y se ven en un visor propio (pdf.js, en `public/vendor/pdfjs/`).

```
Navegador ──▶ www.lamassu.io/research (GitHub Pages: solo la app, sin contenido)
   │ 1. login ─▶ github.com (GitHub App, PKCE)
   │ 2. code  ─▶ Cloudflare Worker ─▶ token (8 h, solo en memoria)
   ▼ 3. lectura/escritura con el token del usuario
 api.github.com ─▶ repo privado lamassuiot/research-content
```

El token vive solo en una variable JavaScript: no se guarda en `localStorage`, `sessionStorage`, cookies ni en la URL. Al recargar, GitHub devuelve uno nuevo sin preguntar.

## Desarrollo
Requiere Node.js >=20 y pnpm 10.15.1 (fijado en `package.json`). Con Corepack instalado, ejecuta `corepack enable` para activar pnpm.

```bash
pnpm install                           # solo @playwright/test
pnpm exec playwright install chromium  # la primera vez
python3 frontend/build.py               # public/index.html (+ 404.html)
python3 frontend/build.py --dev         # public/index.dev.html: datos en memoria, sin login
node tests/helpers/static.js 8301       # sirve public/ en http://127.0.0.1:8301/research/ (index.dev.html para probar)
pnpm test                              # worker + validador (node:test) y Playwright con un GitHub simulado
```
`public/index.html` es una salida del build pero se commitea. Tras editar `frontend/index.template.html`, ejecuta `pnpm run build` y commitea la plantilla junto con `public/`.

## Estructura
- `public/vendor/pdfjs/`: pdf.js 6.4.299 (build *legacy*, Apache-2.0), copiado sin cambios del paquete npm; se carga solo al abrir un PDF.
- `public/vendor/mermaid/`: Mermaid Tiny 12.1.0 (MIT), copiado sin cambios de `@mermaid-js/tiny`; se carga al mostrar bloques Markdown con lenguaje `mermaid`, también en las vistas previas. Los diagramas siguen el tema claro/oscuro; si no se pueden renderizar, se muestra su código. Tiny no incluye mindmaps, diagramas de arquitectura, KaTeX ni ELK.
- `frontend/`: plantilla de la UI (`index.template.html`), `build.py`, `config.json`, logos y librerías (`vendor/`: marked, DOMPurify, jsdiff).
- `worker/`: Cloudflare Worker (`src/index.js`) y sus tests.
- `content-template/`: contenido inicial de `research-content`, con su validador y workflow.
- `tests/`: Playwright, con `helpers/fake-github.js` (GitHub, OAuth y Worker simulados).
- `docs/SETUP.md`: pasos manuales en GitHub y Cloudflare.
- `PLAN.md`, `TASK.md`: diseño y tarea de implementación. `REPORT.md`: resultado de la implementación.

Los botones **Structure** y **Contents** permiten contraer cada índice. En escritorio, arrastra el separador entre ambos para repartir el ancho de la barra lateral; también admite las flechas del teclado. Doble clic o **Home** restablece la proporción. Estas preferencias se recuerdan en el navegador.

Los enlaces Markdown locales, por ejemplo `[Servicios](certificate-lifecycle-services.md)`, se resuelven a la dirección de la página con su proyecto y sus páginas padre (`#/wiki/<proyecto>/<padre>/<página>`). También se reconocen los enlaces publicados bajo `https://www.lamassu.io/research/`. Los fragmentos como `#renewal` se conservan como destinos de sección. Los enlaces externos y a archivos no se modifican.

La caché de datos privados vive en memoria durante la sesión. El índice se reutiliza durante 60 segundos y, al renovarlo, el OID del árbol de Git evita descargar otra vez los metadatos si nada cambió. Las lecturas simultáneas del mismo contenido comparten una petición. El contenido actual tiene una caché de 30 segundos, limitada a 12 millones de caracteres y 200 entradas; después se revalida con ETag (`If-None-Match` / `304`). Las revisiones identificadas por commit conservan su caché de contenido inmutable. Guardar o detectar otro árbol invalida las lecturas mutables; cerrar sesión vacía las cachés.
