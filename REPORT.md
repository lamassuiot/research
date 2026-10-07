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
