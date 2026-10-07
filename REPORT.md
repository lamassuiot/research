# REPORT: implementación de lama-library

## 1. Hecho

| Hito | Commit | Notas |
|---|---|---|
| M1 esqueleto | 9066fc4 | `build.py` con `config.json`, `--dev`, `--config`, `--out`; copia a `404.html` |
| M2 etiquetas | 3342161 | Sin `category` en ningún sitio de la plantilla. Selector de etiquetas (chips), `#/tags`, `#/tag/:t`, "Browse by tag" |
| M3-M6 (un solo commit) | 3cbae2d | Marca Lamassu, quitado todo lo del servidor, módulo `AUTH`, `GitHubStore`, `MemoryStore` de desarrollo, CSP por `<meta>`, vistas *Access* y *Automation* |
| M7 Worker | e8a7cd4 | 12 tests con `node:test` |
| M8 plantilla de contenido | 6402792 | `tags.json`, 2 artículos, `validate.mjs` (13 tests), workflow |
| M9 tests web | 9dacb0c | 20 tests con Playwright y un GitHub simulado |
| M10-M12 | 5aef31b | Workflows de Pages y Worker, `docs/SETUP.md`, `README.md`, `CLAUDE.md`, este informe |

## 2. Tests

- `npm test` en verde: **25 tests unitarios** (12 del Worker, 13 del validador) y **20 tests Playwright** (9 de login, 8 de wiki, 3 de seguridad).
- `npm run build` genera `public/index.html`, `index.dev.html` y `404.html`. `public/index.html` no contiene `devMemoryStore":true`.
- Comprobado a mano con el build de desarrollo y capturas: portada, etiquetas, editor con chips y marca Lamassu en modo claro.
- Los workflows se han leído y parseado como YAML, pero **no se han ejecutado** (necesitan GitHub).

## 3. Sin verificar (depende de la API real de GitHub o de Cloudflare)

Todo lo de `docs/SETUP.md` §7:
- Que GitHub acepte **PKCE** para la GitHub App. Si no, hay que quitar `code_challenge` del flujo.
- **Esquema GraphQL: comprobado en solo lectura.** Las 8 consultas de `GitHubStore` (`Tags`, `ListPages`, `PageMetas`, `GetPage`, `ListRevs`, `GetRev`, `Recent`, `SaveHead`) se ejecutaron contra la API real (`gh api graphql`, repo público `lamassuiot/lamassuiot`) y todas se aceptan sin errores de esquema. Los nombres de campo de la mutación (`CommittableBranch`, `CommitMessage`, `FileChanges`, `FileAddition`, `FileDeletion`, `expectedHeadOid`) coinciden con la introspección. **No se ejecutó la mutación** `createCommitOnBranch` (escribe), ni se comprobaron permisos con un token de GitHub App: eso sigue pendiente.
- Que `createCommitOnBranch` acepte un informe HTML de más de 400 KB.
- El **texto real del error** cuando `expectedHeadOid` está desfasado. La detección de reintento busca `expectedHeadOid` o `point to`.
- El despliegue del Worker, CORS real y el canje del código.
- Los workflows de GitHub Actions.
- El contraste de color del modo oscuro y el logo en distintos tamaños: solo revisado en una captura.

## 4. Decisiones tomadas (no estaban en TASK.md)

- **`ListPages` en dos pasos.** TASK.md pedía una consulta que baja el árbol con el texto de todos los blobs. Eso descargaría también cada `content.html` (más de 400 KB cada uno) en cada listado. Ahora `ListPages` pide solo los nombres de las carpetas y `PageMetas` pide los `meta.json` con alias, en grupos de 50.
- **Variables GraphQL.** Las rutas y expresiones van como variables (`$expr`, `$path`, `$e0…`), no incrustadas en el texto de la consulta. El GitHub simulado despacha por `operationName` y lee las variables.
- **`node --test` con globs.** En Node 22 `node --test dir/` falla (no recorre directorios), así que `test:unit` usa `"worker/test/*.test.js" "content-template/scripts/*.test.mjs"`.
- **Bucle de redirecciones.** `lr.auth.fail` guarda marcas de tiempo de los reintentos automáticos (fallo del canje o re-autenticación). Con dos en menos de un minuto se para y se muestra el error. Se borra tras la primera respuesta correcta de la API. Los errores de login (state, cancelación, Worker) no redirigen solos: muestran "Try again".
- **`<body class="gated">` desde el HTML**, para que no se vea nada de la wiki antes de que `me()` confirme el acceso.
- **Orden de las etiquetas:** las que no están en `tags.json` pero sí en algún artículo se añaden al final (alfabéticas) en el menú, la portada y `#/tags`. Así un artículo con una etiqueta retirada no queda inalcanzable.
- **`GitHubStore.save`** rechaza etiquetas ajenas a `tags.json`, salvo las que el artículo ya tenía.
- **Revisión de un commit que no tocó el artículo:** `getRev` acepta cualquier SHA válido; si ese commit no tiene `meta.json` del artículo devuelve `null`.
- **El worker acepta `code_verifier` ausente** (PKCE opcional), por si GitHub no lo admite para la GitHub App.
- **Avatar** del usuario en la cabecera: se carga desde `avatars.githubusercontent.com`, permitido en `img-src`.
- **El servidor estático de los tests** sirve `index.test.html` como `/research/` y también `index.dev.html` por nombre.
- **`.gitignore`:** se ignoran `node_modules/`, `test-results/`, `playwright-report/` y `public/index.test.html`. Se commitean `public/index.html`, `404.html` e `index.dev.html`.
- **`package-lock.json`** commiteado para que `npm ci` funcione en el CI.

## 5. Diferencias con TASK.md

- `ListPages` (ver arriba).
- M3-M6 en un solo commit, no uno por hito: los cambios están entrelazados en el mismo archivo.
- El script `test:web` genera antes `public/index.test.html` con `tests/config.test.json`. TASK.md lo describía pero no lo ponía en `package.json`.
- La autorización de `fonts.googleapis.com` en la CSP (`style-src`, `font-src`) se mantiene porque la tipografía (Manrope, JetBrains Mono, Material Symbols) viene de Google Fonts, como en la landing de Lamassu.
- La ayuda y la portada están reescritas para Lamassu, pero el texto de los estados de madurez sigue hablando de "customer deliverables" (heredado).

## 6. Mejoras pendientes

- Paginación del historial por encima de 100 revisiones (`// TODO` en `listRevs`).
- Validar en `validate.mjs` que `revN` sube de uno en uno (necesita `git log`).
- La búsqueda de texto completo descarga todos los artículos en la primera búsqueda; con muchos informes HTML grandes convendrá un `index.json` mantenido por una Action.
- Diff renderizado para informes HTML (ahora compara el código fuente).
- Artículos restringidos por persona o grupo: requeriría otro repositorio de contenido con otro team.
- Quitar el comentario "self-hosted server" y la rama `S.store.search` heredados en `viewSearch`.
- Un test de `fake-github` que valide las consultas GraphQL contra el esquema (descargado) evitaría regresiones de nombres de campo.

## 7. Ampliación: PDFs (después del informe inicial)

- **Dónde:** `files/<nombre>.pdf` en `research-content`, una carpeta común para reutilizar el mismo manual en varios artículos. Máximo 50 MB, deben empezar por `%PDF-`, y los nombres se normalizan (`TPM 2.0 Spec.pdf` → `tpm-2.0-spec.pdf`).
- **Subida:** API de Git Data (blob → tree → commit → `PATCH refs/heads/main` con `force:false`). Si `main` se movió entretanto (422), se reintenta hasta 3 veces reutilizando el blob. Subir con el mismo nombre crea una versión nueva.
- **Markdown:** `[[File:x.pdf]]`, `[[File:x.pdf#page=3|texto]]` y `![[File:x.pdf]]`. Este último muestra una tarjeta con "Preview here", que carga el visor dentro del artículo solo bajo demanda. Los enlaces a archivos que no existen salen en rojo.
- **Visor propio:** pdf.js 6.4.299 (build legacy) en `public/vendor/pdfjs/`, cargado con `import()` solo al abrir un PDF. Las páginas se dibujan en canvas de forma diferida, con navegación, zoom, ajuste al ancho, `?page=N` y descarga. Se usa `enableScripting:false`; el visor nativo del navegador no se usa.
- **CSP:** se añade `'self'` a `connect-src`, `font-src` y `worker-src`, solo para que pdf.js cargue sus fuentes, cmaps, wasm y su worker desde el mismo origen.
- **Pages:** el workflow publica también `public/vendor/` (4,8 MB, que solo se descargan al abrir un PDF).
- **Validador:** comprueba `files/` (nombre, tamaño y cabecera `%PDF-`), con 3 tests nuevos.
- **Tests:** 6 tests Playwright nuevos con un PDF generado: subida, rechazo de no-PDF, versión nueva con carrera en `main`, enlaces, incrustado, visor con página, zoom y descarga, y lector sin subida. El GitHub simulado implementa la API de Git Data.
- **Verificado contra GitHub real (solo lectura):** las consultas `ListFiles` y `FileRevs` se aceptan sin errores de esquema.
- **Sin verificar:** el tamaño máximo real que acepta `POST /git/blobs` (se asume que hasta el límite de 100 MB por archivo); que el `PATCH` de la ref funcione con el ruleset (sin force-push); el visor en Safari e iOS; y PDFs reales grandes o con JPEG 2000 / JBIG2 (wasm incluido).
- **Sin hacer:** búsqueda dentro de los PDFs, borrado de archivos y lista de "artículos que enlazan este archivo".

## 8. Ampliación: enlaces externos

- **Datos:** un archivo `links/<id>.json` por enlace (no un único `links.json`, para que dos altas simultáneas no choquen). Campos: `url`, `title`, `description` (opcional), `kind` (`news`, `blog`, `paper`, `video`, `docs`, `other`), `tags` (de `tags.json`, al menos una), `addedAt/By`, `updatedAt/By`. El id sale del título (con sufijo `-2`, `-3` si existe).
- **Interfaz:** página *External links* (menú lateral) con filtro por texto, tipo y etiqueta, y formulario para añadir y editar. La página de cada etiqueta lista también sus enlaces. Cualquier editor puede añadir, editar y borrar: los borrados quedan en el historial de git. Un lector solo los ve.
- **Seguridad:** solo `http(s)`, sin usuario ni contraseña (se rechazan `javascript:`, `ftp:`…); detección de duplicados por URL; enlaces con `target="_blank" rel="noopener noreferrer nofollow"`. La app no contacta con esos sitios, así que no hay vistas previas ni favicons (la CSP los bloquearía y expondrían qué se lee).
- **Git:** `createCommitOnBranch` con reintentos (`commitChanges`), mensaje `Add|Edit|Remove link: <título>` y trailers `Know-how-Link` y `Link-Host`.
- **Validador:** comprueba `links/` (nombre, URL, tipo, etiquetas, campos), con 4 tests nuevos. **Tests:** 5 tests Playwright nuevos (alta con commit y trailers, URLs peligrosas/sin etiqueta/duplicados, editar y borrar, filtros y página de etiqueta, lector sin permisos).
- **Sin verificar con GitHub real:** las consultas `ListLinks` y `LinkBlobs` tienen la misma forma que `ListFiles`/`PageMetas`, que sí se validaron contra el esquema, pero no se ejecutaron tal cual.
- **Sin hacer:** los enlaces no entran en la búsqueda global ni en *Recent changes*; no hay importación masiva ni extracción automática del título de la página.
