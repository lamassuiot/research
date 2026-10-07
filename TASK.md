# TASK: implementar lama-library (Lamassu Research)

Eres el agente que implementa este proyecto. Lee este archivo entero antes de empezar. Los motivos de cada decisión están en [PLAN.md](PLAN.md); **este archivo manda** si hay alguna diferencia.

---

## 0. Resumen

Una wiki versionada, copiada del frontend de **ik-library** (`/home/ubuntu/dev/ik-library`), que:
- se publica como **un único `index.html` estático en GitHub Pages**, en `https://www.lamassu.io/research/`;
- exige **login con GitHub** antes de mostrar nada;
- lee y escribe los artículos en un **repo privado** (`lamassuiot/research-content`) **directamente desde el navegador**, con la API de GitHub y el token del usuario;
- canjea el código OAuth por el token con un **Cloudflare Worker** de unas 40 líneas;
- usa **etiquetas** (lista cerrada en `tags.json`) y **no tiene categorías**.

**No hay servidor propio.** `server.js` de ik-library **no se copia**.

---

## 1. Reglas de trabajo

1. **Directorio de trabajo:** `/home/ubuntu/dev/lamassu/lama-library`. Si no es un repo git, haz `git init -b main` al empezar.
2. **ik-library es solo de lectura.** Copia de allí lo que necesites, pero no modifiques nada en `/home/ubuntu/dev/ik-library`.
3. **No hagas nada fuera de esta máquina:**
   - No crees repos, teams ni GitHub Apps.
   - No hagas `git push` ni `wrangler deploy`.
   - No llames a la API real de GitHub con escritura.

   Todo eso lo hace una persona siguiendo `docs/SETUP.md`, que escribes tú (M11).
4. **Commits locales al terminar cada hito (M1, M2…):** mensaje en inglés, en imperativo (p. ej. `Replace categories with tags`).
5. **Sin dependencias npm en tiempo de ejecución.**
   - La app sigue siendo un HTML autocontenido con las librerías de `frontend/vendor/`.
   - En desarrollo solo se permite `@playwright/test`. `wrangler` no hace falta: el Worker se prueba con `node:test`.
6. **Entorno:**
   - Node 22 en `/home/linuxbrew/.linuxbrew/opt/node@22/bin/node`.
   - Navegadores de Playwright ya instalados en `~/.cache/ms-playwright`.
   - `python3` disponible.
7. **No digas que algo funciona sin haberlo ejecutado.** Si un test no se puede ejecutar, o un comportamiento de la API de GitHub no se puede comprobar sin la API real, anótalo en `REPORT.md` (sección 9). No lo des por bueno.
8. **El idioma de la UI sigue siendo el inglés**, como en ik-library. La documentación para personas (`README.md`, `docs/SETUP.md`) va en español.

---

## 2. Configuración

Todo lo que depende del entorno vive en **un único objeto** al principio del `<script>` de la plantilla. `frontend/build.py` lo rellena con los valores de `frontend/config.json`.

```json
{
  "siteName": "Lamassu Research",
  "basePath": "/research/",
  "owner": "lamassuiot",
  "contentRepo": "research-content",
  "branch": "main",
  "githubClientId": "REPLACE_ME",
  "authWorkerUrl": "https://research-auth.REPLACE_ME.workers.dev",
  "accessTeamUrl": "https://github.com/orgs/lamassuiot/teams/research-editors",
  "devMemoryStore": false
}
```

- **Placeholders:** `githubClientId` y la URL del Worker los rellena una persona tras el SETUP.
- **Build sin configurar:** si `githubClientId` vale `REPLACE_ME`, la app muestra un mensaje de configuración incompleta y no intenta el login.
- **Modo desarrollo:** `python3 frontend/build.py --dev` genera `public/index.dev.html` con `devMemoryStore: true` (ver M5). El build normal genera `public/index.html`, y **nunca** con `devMemoryStore: true`.

---

## 3. Estructura final del repo

```
lama-library/
├── frontend/
│   ├── index.template.html      # copiado de ik-library y modificado
│   ├── build.py                 # genera public/index.html (y public/index.dev.html con --dev)
│   ├── config.json
│   ├── assets/                  # logos Lamassu (ver M3)
│   └── vendor/                  # marked, purify, diff (copiados tal cual)
├── public/
│   ├── index.html               # build, commiteado (como en ik-library)
│   └── 404.html                 # copia de index.html (Pages lo sirve para rutas desconocidas)
├── worker/
│   ├── src/index.js             # Cloudflare Worker (M7)
│   ├── wrangler.toml
│   └── test/worker.test.js      # node:test
├── content-template/            # contenido inicial de research-content (M8)
│   ├── README.md
│   ├── tags.json
│   ├── pages/…                  # 2 artículos de ejemplo
│   ├── scripts/validate.mjs
│   ├── scripts/validate.test.mjs
│   └── .github/workflows/validate.yml
├── tests/
│   ├── helpers/fake-github.js   # GitHub simulado para Playwright (M9)
│   └── web/*.spec.js
├── .github/workflows/
│   ├── pages.yml                # build + tests + deploy a Pages
│   └── worker.yml               # deploy del Worker (solo workflow_dispatch)
├── docs/SETUP.md                # pasos manuales (GitHub, Cloudflare)
├── package.json
├── playwright.config.js
├── PLAN.md  TASK.md  README.md  CLAUDE.md  REPORT.md
└── .gitignore
```

---

## 4. Contrato de datos del repo de contenido

Es el mismo formato que ik-library, **sin `category`**. Cualquier herramienta (la app, `validate.mjs`, scripts) debe respetarlo.

> **Actualización:** la disposición de carpetas de abajo es la original. Hoy todo vive dentro de un proyecto (`projects/<id>/pages/<slug>/…`, `projects/<id>/links/`, `projects/<id>/files/`, `projects/<id>/project.json`); el contrato vigente está en `content-template/README.md`. El script `scripts/migrate-to-project-folders.mjs` convierte un repo antiguo.

```
research-content/
├── README.md
├── tags.json                       {"tags": ["Lamassu", "PKI", …]}
└── pages/<slug>/
    ├── meta.json
    └── content.md   |   content.html     (exactamente uno, el que diga meta.format)
```

**Valores permitidos:**
- **slug:** `^[a-z0-9][a-z0-9-]{0,79}$`.
- **status:** `draft` | `reviewed` | `validated` | `deprecated`.
- **format:** `md` | `html`.

**`tags.json` inicial**, en este orden:

```json
{ "tags": ["Lamassu", "PKI", "X509", "Lamassu RFCs", "IETF RFCs", "PQC", "CBOM", "Updates", "RATs", "Crypto Agility"] }
```

**`meta.json`** (JSON con 2 espacios de sangría y `\n` final, como `savePage` de ik-library):

```json
{
  "title": "…",
  "tags": ["PQC", "Lamassu RFCs"],
  "status": "draft",
  "format": "md",
  "abstract": "…",
  "revN": 3,
  "updatedAt": "2026-10-07T10:00:00.000Z",
  "updatedBy": "<login de GitHub>",
  "createdAt": "…",
  "createdBy": "<login de GitHub>"
}
```

**Reglas de `meta.json`:**
- `tags`: de 1 a 20 elementos, todos presentes en `tags.json` y sin repetir.
- `title`: hasta 200 caracteres.
- `abstract`: hasta 240 caracteres.
- `revN`: empieza en 1 y sube de uno en uno en cada guardado del artículo.
- `title` y `createdAt/By` se conservan del primer guardado (igual que en ik-library).

**Mensaje de commit de cada guardado:**

```
<summary del usuario, hasta 300 caracteres, sin saltos de línea; "Edit" si va vacío>

Know-how-Page: <slug>
Know-how-Revision: <revN>
Know-how-Status: <status>
```

El autor del commit es el usuario. Lo pone GitHub automáticamente al usar su token.

---

## 5. Hitos

Hazlos en orden. Cada uno termina con sus criterios de aceptación en verde y un commit.

### M1. Esqueleto copiado de ik-library

1. **Copia** desde `/home/ubuntu/dev/ik-library`: `frontend/index.template.html`, `frontend/build.py`, `frontend/vendor/*`, `tests/web/open.wiki.spec.js` (como referencia, se reescribirá en M9) y `.gitignore`.
2. **No copies:** `server.js`, `openapi.json`, `Dockerfile`, `docker-compose.yml`, `deploy/`, `deploy.sh`, `nginx-example.conf`, `cyber-knowhow.service`, `.env.example`, `tests/api/`, `tests/helpers/`, `seed/`, `docs/PERMISOS.md` ni `frontend/assets/` (los logos de IKERLAN).
3. **`package.json`:**
   - Sin dependencias de ejecución; `devDependencies: {"@playwright/test": "1.63.0"}` (la misma versión que ik-library).
   - Scripts:
     - `build`: `python3 frontend/build.py && python3 frontend/build.py --dev`
     - `test`: `npm run test:unit && npm run test:web`
     - `test:unit`: `node --test worker/test/ content-template/scripts/`
     - `test:web`: `playwright test`
4. **`frontend/build.py`:**
   - Lee `config.json` e inyecta el objeto en el marcador `/*APP_CONFIG*/`. La plantilla tendrá `const CONFIG = /*APP_CONFIG*/null;`, y el build lo sustituye por el JSON.
   - Acepta `--dev`.
   - Copia `index.html` a `public/404.html`.

**Aceptación:** `npm run build` genera `public/index.html`, `public/index.dev.html` y `public/404.html` sin errores.

### M2. Quitar categorías: solo etiquetas

Busca en la plantilla todas las apariciones de `categor` (sin distinguir mayúsculas). Son unas 37 y **no debe quedar ninguna** salvo la palabra en un texto de ayuda que explique que no hay categorías. Cambios concretos (las líneas son orientativas, de ik-library; busca por texto):

| Dónde (ik-library) | Cambio |
|---|---|
| `const CATEGORIES = [...]` (~517) | Eliminar. Las etiquetas válidas se cargan del repo al arrancar en `S.tags` (array, en el orden de `tags.json`). En el modo de desarrollo, usa la lista de la sección 4 |
| Menú lateral: `<a href="#/categories">` (~479) | Sustituir por una sección "Tags" (`<ul id="sideTags">`), igual que `sideStatus`: cada etiqueta enlaza a `#/tag/<t>` con su número de artículos. Se rellena en `renderSide()` |
| Router: `case "categories"` y `case "category"` (~932-934) | Eliminar. Nuevo `case "tags"` → `viewTags()`. Se mantiene `case "tag"` |
| `viewCategories()` (~1060) | Pasa a `viewTags()`: todas las etiquetas de `S.tags` en su orden, con recuento, y las vacías en rojo (clase `new`), como hoy las categorías vacías |
| Portada `viewHome()`: `byCat`, "Browse by category" (~1007-1026) | "Browse by tag". Agrupa por etiqueta en el orden de `S.tags`; un artículo aparece en cada una de sus etiquetas. `featured` muestra las etiquetas en lugar de la categoría |
| `viewList(..., "Category")` y textos `kind==="Category"` (~1051-1057) | Quitar las ramas de categoría. En las listas de etiqueta, el enlace "Write one" va a `#/new?tag=<t>` |
| Infobox del artículo, fila `Category` (~1097) | Fila `Tags` con enlaces `#/tag/<t>` |
| Caja `catlinks` al pie (~1110-1112) | Pasa a "Tags: a \| b \| c", cada una con su enlace, y se elimina la línea de tags duplicada |
| Diff de metadatos: `for(const k of ["title","status","category"])` (~1204) | `["title","status"]` más una comparación de `tags` (unidos con ", ") |
| Restaurar revisión (~1227) | Quitar `category`. `tags` se toman de la revisión restaurada si existen y, si no, de la página |
| Página de información (~1252) | Quitar la fila `Category` (ya hay fila `Tags`) |
| Resultados de búsqueda (~1330, 1344) y autocompletado (~1859, 1864) | Mostrar las etiquetas en lugar de la categoría, y quitar `p.category` del texto donde se busca |
| Ayuda (~1363) | Explicar las etiquetas: "Every article has one or more **tags** from a fixed list, a **maturity level** and a one-line **abstract**…". Indica que la lista está en `tags.json` del repo de contenido |
| Editor `viewEdit()` (~1434-1457, 1560-1563) | Quitar el `<select id="f-cat">` y el `<input id="f-tags">` de texto libre. Nuevo selector múltiple accesible: un `<fieldset id="f-tags">` con un checkbox estilizado como chip por cada etiqueta de `S.tags`. Si la página tiene etiquetas que ya no están en `S.tags`, salen marcadas y con aviso "not in tags.json". `#/new?tag=X` preselecciona X. **No se puede guardar sin al menos una**: mensaje junto al fieldset. La comparación "nada ha cambiado" usa `tags` en lugar de `category` |
| `MemoryStore` | Quitar `category` |

**Aceptación:** `grep -ci categor frontend/index.template.html` da 0, o solo el texto de ayuda. Con `public/index.dev.html` (M5) se puede crear un artículo con dos etiquetas, aparece en ambas páginas `#/tag/…` y en `#/tags`.

### M3. Quitar lo que dependía del servidor y aplicar la marca Lamassu

**a) Eliminar:**
- Las clases `RestStore` y `ClaudeStore`, y sus ramas en `pickStore()`.
- Las vistas `viewAccess`, `viewUsers`, `viewGroups`, `viewTokens`, `viewApi`, `directory()` y sus rutas (`access`, `admin`, `tokens`, `api`).
- El bloque `#sideAdmin`, `hasAcl()` y todo lo que dependa de ella (p. ej. *Permissions* en el menú Tools), y `lockIcon`/`visibility`.
- Los enlaces a `/auth/login` y `/auth/logout`, que se sustituyen en M4.

**b) Añadir dos vistas nuevas:**
- **`#/access`, "Access":** explica que el acceso se gestiona con el team de GitHub (enlace `CONFIG.accessTeamUrl`) y la tabla de roles: Read → Reader, Write/Maintain → Editor, Admin → Administrator. Enlázala desde el menú del usuario.
- **`#/automation`, "Automation":** cómo crear o editar artículos con `gh api` o git respetando la sección 4, con un ejemplo de `git clone` + commit con los trailers y un ejemplo `gh api graphql` de `createCommitOnBranch`. Enlázala desde Help.

**c) Marca:**
- **Nombre:** `SITE = CONFIG.siteName`. No debe quedar "IKERLAN" ni "CyberBrain" en ningún archivo del repo (`grep -ri "ikerlan\|cyberbrain"` vacío, salvo PLAN.md y TASK.md).
- **Logos:** copia `/home/ubuntu/dev/lamassu/landing/public/lamassu_logo_blue.svg` (fondo claro) y `lamassu_logo_white.svg` (fondo oscuro) a `frontend/assets/`. Ajusta `build.py` (marcadores `__LOGO_DARK_INK__` / `__LOGO_WHITE_INK__`) y los `alt` a "Lamassu".
- **Colores:** sustituye los tokens `--ikerlan-*` por `--lamassu-*`. Azul de marca `#0100f8` (el del logo). Toma el resto de la paleta de la web de Lamassu (`/home/ubuntu/dev/lamassu/landing/src`, variables `--lp-*`).
  - Mantén modo claro y oscuro.
  - Contraste AA en texto: el azul de marca sirve para enlaces y botones primarios sobre blanco; en modo oscuro usa una variante clara (p. ej. `#7e9cff`).
- **Tipografía:** Manrope (texto) y JetBrains Mono (código) desde Google Fonts, como la landing. Elimina los `@font-face` de T-Star Pro. Se mantiene el fallback `system-ui` y los Material Symbols.
- **Textos de la portada y de la ayuda:** wiki de investigación de Lamassu (PKI, PQC, RFCs…), en inglés.

**Aceptación:** grep de IKERLAN vacío; build correcto; la app en modo dev se ve con la marca Lamassu en claro y oscuro (captura de Playwright en `test-results/`).

### M4. Autenticación con GitHub (`auth`)

Módulo dentro de la plantilla. **El token vive solo en una variable JS (`AUTH.token`).** Prohibido escribirlo en `localStorage`, `sessionStorage`, cookies o la URL.

**Flujo:**
1. **Arranque**, antes de pintar nada de la wiki (se muestra solo `#gate` con "Signing in with GitHub…"):
   - **Sin token y la URL sin `?code=`:** generar `state` (32 bytes aleatorios, base64url) y un `code_verifier` PKCE (43-128 caracteres). Guardar en `sessionStorage` la clave `lr.auth` con `{state, verifier, hash: location.hash, at: Date.now()}`. Esto **no** es el token, y está permitido.
   - **Redirigir** a `https://github.com/login/oauth/authorize` con `client_id`, `redirect_uri = location.origin + CONFIG.basePath`, `state`, `code_challenge` (S256 del verifier) y `code_challenge_method=S256`. **No pidas `scope`:** las GitHub Apps no lo usan.
2. **Callback** (la URL lleva `?code=…&state=…`):
   - Leer y **borrar** `lr.auth`.
   - Comprobar que `state` coincide y que tiene menos de 10 minutos. Si no, mostrar error con un botón "Try again".
   - `POST CONFIG.authWorkerUrl + "/token"` con `{code, code_verifier}`. La respuesta es `{access_token, expires_in}`.
   - Guardar `AUTH.token` y `AUTH.expiresAt`.
   - `history.replaceState(null, "", CONFIG.basePath + savedHash)` para quitar el código de la URL.
   - Si la URL trae `?error=…` (p. ej. el usuario canceló), mostrar el mensaje y "Try again".
3. **Bucle de redirecciones:** si se vuelve del callback y el canje falla dos veces seguidas en menos de un minuto (contador en `sessionStorage`, clave `lr.auth.fail`), parar y mostrar el error en vez de redirigir otra vez.
4. **Expiración:**
   - Si `Date.now() > AUTH.expiresAt - 60 s`, o la API responde 401, ejecutar `AUTH.reauth()`: guarda el hash actual y repite el paso 1. GitHub vuelve sin preguntar si la app ya está autorizada.
   - Si hay un editor abierto con cambios sin guardar, **antes** de redirigir mostrar un aviso con "Copy text" y "Continue": se perdería el borrador.
5. **Logout** (menú del usuario): `POST /revoke` al Worker con `{access_token}` (sin esperar a que falle o no), borrar `AUTH.token` y mostrar `#gate` con "Signed out" y un botón "Sign in again". No redirigir automáticamente.
6. **Pantallas del gate** (reutilizar `showGate(kind)`, adaptando los textos):

   | kind | Cuándo |
   |---|---|
   | `signing-in` | Durante el flujo |
   | `no-access` | Login correcto pero sin acceso al repo: texto + enlace a `CONFIG.accessTeamUrl` + login actual de GitHub + "Sign out" |
   | `signed-out` | Tras cerrar sesión |
   | `error` | Fallo del canje, `state` incorrecto o cancelación |
   | `config` | `githubClientId === "REPLACE_ME"` |

7. **Ningún dato de contenido** (títulos, etiquetas, nada de `research-content`) se pide ni se pinta antes de que `me()` confirme acceso.

**Aceptación:** los tests de auth de M9 pasan, y `grep -n "localStorage\|sessionStorage" frontend/index.template.html` solo muestra preferencias de UI (`kb.menu`, tema) y `lr.auth`/`lr.auth.fail`.

### M5. Almacenes: `GitHubStore` y `MemoryStore` de desarrollo

**`pickStore()`:**
- Si `CONFIG.devMemoryStore === true`, devuelve `MemoryStore`, sin login y con un banner "Development build: data lives in this tab only". Precarga las etiquetas de la sección 4 y 2-3 artículos de ejemplo.
- En cualquier otro caso devuelve `GitHubStore`.

**`GitHubStore`** tiene la misma interfaz que usa la UI: `me`, `names`, `listPages`, `getPage`, `listRevs`, `getRev`, `recent`, `save`, más el nuevo `tags()`. `kind = "github"`.

**Peticiones comunes** (helper `gh(path, opt)` para REST y `gql(operationName, query, variables)` para GraphQL):
- Base `https://api.github.com`, GraphQL en `POST /graphql` con body `{query, variables, operationName}`.
- Cabeceras: `Authorization: Bearer <AUTH.token>`, `X-GitHub-Api-Version: 2022-11-28`, `Accept: application/vnd.github+json`.
- **Todas las consultas GraphQL llevan un `operationName` fijo** (los de la tabla). El GitHub simulado de los tests (M9) responde según él.
- **Errores:**
  - 401 → `AUTH.reauth()`.
  - 403/429 con `x-ratelimit-remaining: 0` → error "GitHub API rate limit reached, try again at HH:MM".
  - Respuesta GraphQL con `errors` → lanzar `Error(errors[0].message)` con `.gqlType = errors[0].type`.
- **El slug se valida** con la regex de la sección 4 antes de meterlo en una ruta o expresión.

| Método | operationName | Implementación |
|---|---|---|
| `me()` | — (REST) | `GET /user` → `{login, name, avatar_url}`; `GET /repos/{owner}/{contentRepo}` → `permissions`. Un 404 o 403 lanza `{status: 403, noAccess: true, login}` y el arranque muestra el gate `no-access`. Rol: `admin` → admin; `push` o `maintain` → editor; si no, reader. Devuelve `{id: login, name: name \|\| login, role, isAdmin: role==="admin", canWrite: role!=="reader", avatar: avatar_url}` |
| `tags()` | `Tags` | `repository{ object(expression: "main:tags.json"){ ... on Blob { text } } }` → `JSON.parse(text).tags`. Si falta o no es válido, devuelve `[]` y la UI muestra un aviso para administradores |
| `listPages()` | `ListPages` | Una consulta: `repository{ object(expression: "main:pages"){ ... on Tree { entries { name object { ... on Tree { entries { name object { ... on Blob { text } } } } } } } } }`. Por cada entrada con slug válido y un `meta.json` parseable, devuelve el mismo objeto que `publicMeta()` de ik-library, sin `category` y con `tags`. Si `pages/` no existe, `[]` |
| `getPage(slug)` | `GetPage` | `meta: object(expression: "main:pages/<slug>/meta.json"){ ... on Blob { text } }` + `ref(qualifiedName: "refs/heads/main"){ target { ... on Commit { history(first: 1, path: "pages/<slug>"){ nodes { oid } } } } }`. Devuelve `null` si no hay meta, o publicMeta + `rev: oid` |
| `listRevs(slug)` | `ListRevs` | `history(first: 100, path: "pages/<slug>"){ nodes { oid authoredDate messageHeadline author { name user { login } } file(path: "pages/<slug>/meta.json"){ object { ... on Blob { text } } } } }`. Cada nodo da `{id: oid, slug, n: meta.revN, at: authoredDate, by: author.user?.login \|\| author.name, summary: messageHeadline, size, format, status, title, tags, sha256}`. Descarta los que no tengan `n`. **No pagines más allá de 100** y deja un `// TODO` |
| `getRev(slug, sha)` | `GetRev` | Valida `sha` con `^[0-9a-f]{7,40}$`. GraphQL: `commit: object(expression: "<sha>"){ ... on Commit { oid authoredDate messageHeadline author { name user { login } } } }` + `meta: object(expression: "<sha>:pages/<slug>/meta.json"){ ... on Blob { text } }`. Contenido por REST: `GET /repos/{owner}/{repo}/contents/pages/<slug>/content.<format>?ref=<oid>` con `Accept: application/vnd.github.raw+json`, leído como texto. **No uses `Blob.text` para el contenido**, porque se trunca en archivos grandes. Devuelve lo mismo que `listRevs` + `content` |
| `recent(limit=60)` | `Recent` + `RecentMetas` | 1) `history(first: limit, path: "pages"){ nodes { oid authoredDate messageHeadline message author { name user { login } } } }`. El slug se saca del trailer `Know-how-Page:` del `message`, y se descartan los nodos sin trailer. 2) Una consulta con aliases `m0: object(expression: "<oid>:pages/<slug>/meta.json"){ ... on Blob { text } }`, `m1: …` para los metadatos. Devuelve el formato de `recent()` de ik-library, sin `category` |
| `save(slug, d, baseRevN)` | `SaveHead` + `CreateCommit` | Ver más abajo |
| `names(ids)` | — | Identidad: `{id: id}`, porque ya son logins o nombres |

**`save()` paso a paso:**
1. **Validar:** título no vacío (en creación), contenido no vacío, `d.tags` con 1-20 etiquetas presentes en `S.tags` (salvo las que ya tuviera la página y se hayan conservado), `status` y `format` válidos. Limpia `summary`, `title` y `abstract` como `clean()` de ik-library: quitar `\r\n\0<>` y recortar a la longitud máxima.
2. **`SaveHead`:** `ref(qualifiedName: "refs/heads/main"){ target { oid } }` + `object(expression: "main:pages/<slug>/meta.json"){ ... on Blob { text } }`. Así se obtienen `headOid` y `prev`.
3. **Construir `meta`** según la sección 4: `n = (prev?.revN || 0) + 1`, `updatedBy = S.me.id`, y `title`/`createdAt`/`createdBy` conservados de `prev`.
4. **`CreateCommit`:**
   ```graphql
   mutation CreateCommit($input: CreateCommitOnBranchInput!) {
     createCommitOnBranch(input: $input) { commit { oid } }
   }
   ```
   Con `input = { branch: { repositoryNameWithOwner: "<owner>/<repo>", branchName: CONFIG.branch }, expectedHeadOid: headOid, message: { headline: summary, body: trailers }, fileChanges: { additions: [ {path: "pages/<slug>/content.<format>", contents: b64(content)}, {path: "pages/<slug>/meta.json", contents: b64(JSON.stringify(meta, null, 2) + "\n")} ], deletions: prev && prev.format !== format ? [{path: "pages/<slug>/content.<prev.format>"}] : [] } }`.
   - `b64()` codifica **los bytes UTF-8** (no `btoa` directamente sobre el string): `TextEncoder` → base64 por trozos.
5. **Rama movida:** si la mutación falla porque `main` cambió (el mensaje de error contiene "expected" o "Expected branch to point to"; trata como reintentable cualquier error cuyo mensaje incluya `expectedHeadOid` o `point to`), vuelve al paso 2. **Como máximo 3 intentos.** Después, error "Someone else saved at the same time; please retry".
6. **Respuesta:** `{rev: commit.oid, n, conflict: baseRevN != null && (prev?.revN || 0) !== baseRevN}`.

**Integración con la UI:**
- En el arranque, después de `me()`, se carga `S.tags = await S.store.tags()`.
- `#modeNote` muestra "Storage: GitHub · <owner>/<contentRepo>".
- El menú del usuario muestra el avatar, el login y el rol.
- `loadTexts()` (búsqueda) se mantiene: usa `getPage` + `getRev`, con concurrencia 4 como ahora.

**Aceptación:** los tests de M9 con el GitHub simulado pasan.

### M6. CSP por `<meta>`

GitHub Pages no permite cabeceras, así que añade en el `<head>` de la plantilla, **antes de cualquier script**:

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src 'self' data: blob: https://avatars.githubusercontent.com; connect-src https://api.github.com __AUTH_WORKER_ORIGIN__; frame-src 'self' about:; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
```

- **`build.py` sustituye `__AUTH_WORKER_ORIGIN__`** por el origen de `CONFIG.authWorkerUrl`.
- **En el build `--dev`** la directiva queda `connect-src 'self'`.
- `'unsafe-inline'` en scripts es necesario porque todo el JS va en línea, y porque los informes HTML (iframe `srcdoc`, que hereda la CSP) llevan scripts en línea, igual que en ik-library.
- `img-src` **no** incluye `https:` en general: las imágenes externas de los artículos no cargan. Es intencionado, para evitar que se filtren datos.
- Los informes HTML siguen en `<iframe sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox">` **sin** `allow-same-origin`. Comprueba que se mantiene.

**Aceptación:** test de M9 que comprueba que la meta existe y que `connect-src` solo permite `api.github.com` y el Worker; sin errores de CSP en la consola durante los tests.

### M7. Cloudflare Worker

**`worker/src/index.js`** es un módulo ES con `export default { async fetch(req, env) }`:
- **Origen:** si `Origin !== env.ALLOWED_ORIGIN`, responde 403. `OPTIONS` → 204 con las cabeceras CORS. Otro método que no sea `POST` → 405.
- **CORS:** `Access-Control-Allow-Origin: env.ALLOWED_ORIGIN`, `Access-Control-Allow-Methods: POST`, `Access-Control-Allow-Headers: Content-Type`, `Access-Control-Max-Age: 600`, `Vary: Origin`.
- **Body:** JSON de hasta 4 KB. Si es mayor o no es válido → 400.
- **`POST /token {code, code_verifier}`:**
  - `code` obligatorio, string de hasta 100 caracteres.
  - Hace `POST https://github.com/login/oauth/access_token` con `Accept: application/json` y body `{client_id, client_secret, code, code_verifier, redirect_uri: env.REDIRECT_URI}`.
  - Devuelve **solo** `{access_token, expires_in}`; nunca `refresh_token`.
  - Si GitHub responde con `error` → 400 `{error}`.
- **`POST /revoke {access_token}`:** `DELETE https://api.github.com/applications/<client_id>/token` con autenticación básica `client_id:client_secret`, `Accept: application/vnd.github+json`, `User-Agent: lamassu-research-auth` y body `{access_token}`. Responde 204 aunque GitHub falle (no da información).
- **Otra ruta:** 404.
- **Nunca registres en el log** el código, el token ni el secreto.

**`worker/wrangler.toml`:**
- `name = "research-auth"`, `main = "src/index.js"` y `compatibility_date` reciente.
- `[vars]`: `ALLOWED_ORIGIN = "https://www.lamassu.io"`, `REDIRECT_URI = "https://www.lamassu.io/research/"`, `GITHUB_CLIENT_ID = "REPLACE_ME"`.
- El secreto `GITHUB_CLIENT_SECRET` se configura con `wrangler secret put`. Déjalo indicado en un comentario.

**`worker/test/worker.test.js`** (`node:test`): importa el módulo y sustituye `globalThis.fetch` por un doble. Casos:
1. Un `Origin` ajeno da 403.
2. `OPTIONS` devuelve las cabeceras CORS.
3. `GET` da 405.
4. `/token` sin `code` da 400.
5. `/token` correcto envía a GitHub el `client_secret` y el `code_verifier`, y devuelve solo `access_token` y `expires_in` aunque GitHub incluya `refresh_token`.
6. Un error de GitHub da 400 `{error}`.
7. `/revoke` llama a `DELETE` con autenticación básica correcta y responde 204, también si GitHub falla.
8. Un body de más de 4 KB da 400.
9. Una ruta desconocida da 404.

**Aceptación:** `node --test worker/test/` en verde.

### M8. Plantilla del repo de contenido

Crea `content-template/`. Una persona lo copiará como contenido inicial de `research-content`.

1. **`tags.json`:** el de la sección 4.
2. **`README.md`** (español): qué es el repo, el contrato de la sección 4, cómo editar con git respetando los trailers, y un aviso de no hacer force-push.
3. **Dos artículos de ejemplo:**
   - `pages/welcome/`: Markdown, etiqueta `Lamassu`, cómo usar la wiki.
   - `pages/pqc-migration-notes/`: Markdown, etiquetas `PQC` y `Crypto Agility`, un esqueleto con secciones vacías.

   Ambos con `meta.json` válido (`revN: 1`) y `createdBy: "lamassu-research"`.
4. **`scripts/validate.mjs`** (Node ≥ 20, sin dependencias, `node scripts/validate.mjs [dir]`). Comprueba:
   - que `tags.json` existe, es válido y no tiene duplicados;
   - que cada `pages/<slug>` tiene un slug válido;
   - que `meta.json` es válido y tiene los campos y tipos de la sección 4;
   - que las etiquetas están en `tags.json` (de 1 a 20);
   - que existe exactamente un `content.*` y coincide con `format`;

   Imprime todos los errores (`path: mensaje`) y termina con código 1 si hay alguno.

   **No compruebes la secuencia de `revN` contra el historial** (requiere git log). Déjalo como mejora en `REPORT.md`.
5. **`scripts/validate.test.mjs`** (`node:test`): la plantilla pasa la validación, y casos rotos (etiqueta desconocida, sin etiquetas, sha incorrecto, dos contenidos, slug inválido) fallan con el mensaje esperado. Usa directorios temporales.
6. **`.github/workflows/validate.yml`:** en cada `push` y `pull_request`, `actions/checkout` + `actions/setup-node` (20) + `node scripts/validate.mjs`. Si falla en `push` a `main`, abre un issue con `gh issue create` (permiso `issues: write`) con la salida.

**Aceptación:** `node --test content-template/scripts/` en verde y `node content-template/scripts/validate.mjs content-template` termina con código 0.

### M9. Tests web (Playwright) con GitHub simulado

**`tests/helpers/fake-github.js`** exporta `installFakeGitHub(page, opts)`, que usa `page.route()` para interceptar:
- `https://github.com/login/oauth/authorize*`: responde 302 a `redirect_uri?code=fake-code&state=<state recibido>`, o a `?error=access_denied` si `opts.denyLogin`. Guarda el `code_challenge` recibido. Si `route.fulfill` con 302 no provoca la navegación en Chromium, responde un HTML mínimo que haga `location.replace(...)`.
- `<authWorkerUrl>/token`: comprueba que el `code_verifier` corresponde al `code_challenge` (S256) y devuelve `{access_token: "tok-<user>", expires_in: opts.expiresIn ?? 28800}`. También `/revoke`, que registra la llamada.
- `https://api.github.com/user` y `/repos/<owner>/<repo>`: según `opts.user` (`{login, name}`) y `opts.permission` (`"admin" | "write" | "read" | "none"`; `"none"` da 404).
- `https://api.github.com/graphql`: despacha por `operationName` contra un **repo en memoria**:
  - commits como `{oid, parent, files: Map(path → string), message, author, date}`;
  - `main` apuntando al último;
  - helpers para resolver `rev:path`, `history(path)` (commits que cambian algo bajo `path`, del más nuevo al más viejo) y `file(path)`.
  - `CreateCommit` aplica `additions` y `deletions` (decodificando base64 a UTF-8) y falla con `{errors: [{type: "STALE_DATA", message: "Expected branch to point to \"<x>\" but it did not"}]}` si `expectedHeadOid` no es la cabeza. `opts.raceOnce` mete un commit ajeno justo antes del primer `CreateCommit`, para probar el reintento.
- `https://api.github.com/repos/<owner>/<repo>/contents/<path>?ref=<oid>`: el contenido en bruto.
- **Cualquier otra petición a `api.github.com` o `github.com`** se responde con 500 y se registra. El test falla si hubo alguna: así se detectan llamadas no previstas.

El repo en memoria arranca con el contenido de `content-template/` (lee `tags.json` y `pages/` del disco).

**`playwright.config.js`:**
- Un servidor estático mínimo en Node (`tests/helpers/static.js`, sin dependencias) que sirve `public/` bajo `/research/`, en `http://127.0.0.1:8301`.
- Los tests usan un `index.html` construido con un `config.test.json`: `githubClientId: "test-client"`, `authWorkerUrl: "https://auth.test"`. Añade a `build.py` la opción `--config <file> --out <file>` para generarlo antes de los tests (`public/index.test.html`). El servidor estático sirve ese archivo como `/research/index.html` durante los tests. `public/index.test.html` va en `.gitignore`; `public/index.dev.html` sí se commitea.

**Tests mínimos** (`tests/web/auth.spec.js`, `tests/web/wiki.spec.js`, `tests/web/security.spec.js`):

*Autenticación:*
1. Al entrar se redirige a GitHub con `client_id`, `state` y `code_challenge`, **sin** `scope`. Vuelve, y la wiki carga en el hash original (`/research/#/wiki/welcome`). La URL final no contiene `code=`.
2. **Antes del login no se pide ni se pinta ningún dato:** no hay peticiones a `graphql` antes de que `/user` responda, y `#main` no contiene títulos de artículos mientras se ve el gate.
3. Con `state` incorrecto se muestra el gate `error` y no hay bucle de redirecciones.
4. Con `denyLogin` se muestra el gate `error` con "Try again".
5. Con `permission: "none"` se muestra el gate `no-access` con el login y el enlace al team, y no hay peticiones `graphql`.
6. Tras recargar la página, el token no persiste: se repite la redirección. Además, `localStorage`/`sessionStorage` **no contienen** `tok-`.
7. Un 401 de la API provoca re-autenticación y la vuelta al mismo hash.
8. Logout llama a `/revoke` y muestra `signed-out` sin redirigir.

*Wiki:*
9. Con `permission: "read"` no hay "Edit" ni "Create" y sí se puede leer.
10. Con `permission: "write"`: crear un artículo con dos etiquetas (se valida que no se puede guardar sin etiquetas). Comprobar el mensaje y los trailers del commit, y el `meta.json` en el repo simulado (`revN 1`, `createdBy` = login).
11. Editar el artículo (revN 2), ver el historial, ver el diff y restaurar la revisión 1 (revN 3).
12. Con `raceOnce`, guardar reintenta y termina bien con un solo commit propio.
13. `#/tags` muestra todas las etiquetas en el orden de `tags.json`, con recuentos; `#/tag/PQC` lista el artículo de ejemplo; la portada tiene "Browse by tag".
14. Búsqueda de una palabra que solo está en el contenido.
15. Un artículo `html` grande (más de 400 KB, generado en el test) se guarda y se muestra en un iframe con `sandbox` **sin** `allow-same-origin`.
16. Móvil (viewport de 390 px) y modo oscuro, adaptando los tests equivalentes de `open.wiki.spec.js` de ik-library.

*Seguridad:*
17. La meta CSP existe; `connect-src` solo contiene `https://api.github.com` y `https://auth.test`.
18. El HTML servido no contiene "IKERLAN" ni "category".
19. No hay errores de JavaScript ni de CSP en ningún test (`pageerror` + mensajes de consola con "Content Security Policy").

**Aceptación:** `npm test` en verde.

### M10. Workflows de GitHub Actions

**`.github/workflows/pages.yml`:** en `push` a `main` y `workflow_dispatch`.
- **Job `test`:** `actions/checkout`, `actions/setup-node` (22), `npm ci`, `npx playwright install --with-deps chromium`, `npm run build`, `git diff --exit-code public/` (el build commiteado debe estar al día) y `npm test`.
- **Job `deploy`:** necesita `test`; permisos `pages: write`, `id-token: write`; usa `actions/configure-pages`, `actions/upload-pages-artifact` con `path: public` (excluye `index.dev.html` e `index.test.html` copiando a un directorio aparte) y `actions/deploy-pages`.

**`.github/workflows/worker.yml`:** solo `workflow_dispatch`. Ejecuta `npx wrangler@3 deploy` en `worker/` con el secreto `CLOUDFLARE_API_TOKEN`. Comentario: el secreto del cliente se configura una vez con `wrangler secret put`.

**Aceptación:** YAML válido (`python3 -c "import yaml,sys; [yaml.safe_load(open(f)) for f in sys.argv[1:]]" .github/workflows/*.yml`; si falta PyYAML, anótalo). No se puede probar sin GitHub: indícalo en `REPORT.md`.

### M11. Documentación

1. **`docs/SETUP.md`** (español). Checklist para una persona owner de `lamassuiot`, con casillas:
   1. Crear `lamassuiot/research` (público) y `lamassuiot/research-content` (privado).
   2. Copiar `content-template/` como primer commit de `research-content`. La rama `main` debe existir antes de usar la app.
   3. Ruleset en `research-content/main`: bloquear force-push y borrado, **sin** exigir PR.
   4. Teams `research-editors` (Write) y, si hace falta, `research-readers` (Read) sobre `research-content`.
   5. Crear la GitHub App en *Organization settings → Developer settings → GitHub Apps*:
      - Callback URL `https://www.lamassu.io/research/`.
      - *Expire user authorization tokens* activado.
      - Webhook desactivado.
      - Permisos: Repository → Contents: Read and write, Metadata: Read-only.
      - Instalable solo en esta cuenta.
      - Instalarla **solo** en `research-content`.
      - Generar el client secret.
   6. Cloudflare: cuenta, `npx wrangler login`, `npx wrangler secret put GITHUB_CLIENT_SECRET`, poner el client ID en `wrangler.toml` y `npx wrangler deploy`. Anotar la URL `*.workers.dev`.
   7. Rellenar `frontend/config.json` (`githubClientId`, `authWorkerUrl`), `npm run build` y commit.
   8. En `research`: *Settings → Pages → Source: GitHub Actions*, y el secreto `CLOUDFLARE_API_TOKEN` si se usa `worker.yml`. Hacer push.
   9. **Verificación con tres cuentas:**
      - miembro del team → entra;
      - miembro de la organización fuera del team → `no-access`;
      - cuenta ajena → `no-access`.
   10. **Comprobaciones con la API real**, que en los tests están simuladas (marcar cada una):
       - GitHub acepta PKCE para la GitHub App.
       - El `operationName` y las consultas funcionan.
       - `createCommitOnBranch` con un HTML de más de 400 KB.
       - El mensaje de error real cuando `expectedHeadOid` está desfasado. Si no contiene `point to`, ajustar la detección de M5 paso 5.
       - `file(path:)` devuelve el meta en `ListRevs`.
2. **`README.md`** (español): qué es, la arquitectura (diagrama de PLAN.md), cómo desarrollar (`npm run build`, abrir `public/index.dev.html` con el servidor estático y `npm test`) y la estructura.
3. **`CLAUDE.md`:** contexto para futuros agentes. Arquitectura, convenciones (editar la plantilla y regenerar `public/`; commits en inglés; token solo en memoria), contrato de datos (enlace a la sección 4 de TASK.md) y comandos.

### M12. Cierre

1. `npm run build && npm test` en verde, y `git status` limpio.
2. Escribe **`REPORT.md`** (sección 9).

---

## 6. Prohibido

- Guardar el token de GitHub en cualquier almacenamiento persistente o en la URL, o pedir o guardar el refresh token.
- Usar una OAuth App o pedir el scope `repo`.
- Pintar o pedir contenido antes de que `me()` confirme el acceso.
- Añadir `allow-same-origin` al iframe de los informes, o relajar `connect-src`/`img-src`.
- Añadir dependencias npm de ejecución o CDNs nuevos para la app.
- Reintroducir categorías.
- Inventar endpoints de GitHub que no estén en este documento. Si necesitas otro, anótalo en `REPORT.md` y justifícalo.
- Desplegar, hacer push o crear recursos en GitHub o Cloudflare.

## 7. Si algo no encaja

- **Una instrucción contradice el código de ik-library** (p. ej. una función tiene otro nombre): sigue la intención de este documento y anótalo en `REPORT.md`.
- **Una decisión no está cubierta aquí ni en PLAN.md:** elige la opción más simple y segura, y anótala en `REPORT.md` en "Decisiones tomadas".
- **Un test no se puede hacer pasar sin violar la sección 6:** deja el test en rojo, no lo debilites, y explícalo.

## 8. Definición de terminado

- [ ] Todos los hitos M1-M12 hechos, con un commit cada uno.
- [ ] `npm run build && npm test` en verde, y `git diff --exit-code public/` limpio tras el build.
- [ ] `grep -riE "ikerlan|cyberbrain" --exclude=PLAN.md --exclude=TASK.md -l .` vacío (sin contar `.git` y `node_modules`).
- [ ] `grep -ci categor frontend/index.template.html` da 0 (o solo el texto de ayuda).
- [ ] `public/index.html` sin `"devMemoryStore":true`.
- [ ] `REPORT.md` escrito.

## 9. `REPORT.md`

Secciones:
1. **Hecho:** por hito, con el hash del commit.
2. **Tests:** comandos ejecutados y resultado (número de tests y estado).
3. **Sin verificar:** todo lo que depende de la API real de GitHub o de Cloudflare (mínimo, los puntos de SETUP 10).
4. **Decisiones tomadas** que no venían en este documento.
5. **Diferencias con TASK.md** y motivo.
6. **Mejoras pendientes:** paginación del historial (más de 100 revisiones), validación de la secuencia de `revN`, búsqueda en artículos `html` grandes, etc.
