# lama-library: wiki de investigación de Lamassu en GitHub Pages

**Objetivo:** una wiki versionada como `ik-library` (IKERLAN CyberBrain), servida en **`https://www.lamassu.io/research`**. Solo pueden entrar personas que inicien sesión con GitHub y pertenezcan a un team concreto de la organización `lamassuiot`.

**Modelo elegido:** no hay servidor propio.
- **GitHub Pages** sirve solo la aplicación (HTML/JS estático, sin contenido).
- El **contenido** vive en un **repo privado** y el navegador lo lee y escribe con la API de GitHub, usando el token del propio usuario.
- **GitHub decide quién accede:** basta con tener permiso sobre el repo privado a través de un team.
- Una **función mínima en Cloudflare Workers** (plan gratuito) canjea el código OAuth por el token, porque eso exige el *client secret*.

---

## 1. Contexto comprobado

| Hecho | Consecuencia |
|---|---|
| La organización `lamassuiot` tiene el plan **Free** y exige 2FA | No hay Pages privadas (requieren Enterprise Cloud). En Free, Pages solo publica desde **repos públicos** |
| `lamassuiot.github.io` tiene CNAME `www.lamassu.io` (`lamassu.io` → 301 → `www`) | Un repo `lamassuiot/research` con Pages se publica solo en `www.lamassu.io/research`. **El nombre del repo es la ruta** |
| `lamassuiot/research` y `lamassuiot/research-content` no existen | Los nombres están libres |
| `www.lamassu.io` solo carga `bootstrap.bundle.min.js` local | Hoy no hay scripts de terceros en el mismo origen (ver 4.3) |
| El frontend de ik-library ya cambia de almacenamiento (`RestStore`, `ClaudeStore`, `MemoryStore`) | Se añade un `GitHubStore` con la misma interfaz y el resto de la UI no cambia |

---

## 2. Arquitectura

```
                      ┌──────────────────────────────────────────────┐
 Navegador ──────────▶│ www.lamassu.io/research   (GitHub Pages)     │  repo PÚBLICO lamassuiot/research
                      │ index.html: app, sin contenido               │  (código de la app)
                      └──────────────────────────────────────────────┘
     │ 1. login ──▶ github.com/login/oauth/authorize (GitHub App "Lamassu Research")
     │ 2. code  ──▶ Cloudflare Worker /token ──▶ github.com/login/oauth/access_token  (con client secret)
     │             ◀── access_token (8 h)
     │ 3. lectura/escritura con el token del usuario
     ▼
 api.github.com (REST + GraphQL) ──▶ repo PRIVADO lamassuiot/research-content
                                       pages/<slug>/meta.json
                                       pages/<slug>/content.md | content.html
```

### Quién ve qué
- **Sin login:** solo el código de la app, que es público igual que el resto de Lamassu. Ningún artículo, título ni etiqueta.
- **Con login de GitHub pero fuera del team:** el token no tiene acceso al repo privado. La API responde 404 y la app muestra "No tienes acceso; pide que te añadan al team `lamassuiot/research-editors`".
- **En el team:** el permiso del team sobre `research-content` decide el rol.

| Permiso efectivo en `research-content` | Rol en la wiki |
|---|---|
| Read | Lector |
| Write / Maintain | Editor |
| Admin | Administrador (en la práctica, quien gestiona el team en GitHub) |

El token de una GitHub App solo da acceso a lo que **el usuario tenga y la app tenga a la vez**, y la app se instala solo en `research-content`. Así que el token no sirve para ningún otro repo del usuario. Por eso se usa una GitHub App y no una OAuth App, que necesitaría el scope `repo` (todos los repos privados del usuario).

### Qué se reutiliza de ik-library

| Pieza | Uso |
|---|---|
| `frontend/index.template.html`: UI tipo MediaWiki, editor, preview, historial, diff, restaurar, etiquetas, madurez, `[[enlaces]]`, informes HTML en iframe sandbox | Igual, con la marca Lamassu |
| `frontend/build.py` + `vendor/` (marked, DOMPurify, jsdiff) | Igual: sigue saliendo un único `index.html` |
| Estructura de datos `pages/<slug>/meta.json` + `content.{md,html}` y trailers `Know-how-*` en los commits | Igual: el repo de contenido es compatible con el de ik-library |
| Búsqueda de texto completo en el cliente | Igual |
| `tests/web` (Playwright) | Se adaptan, simulando la API de GitHub y el Worker |

**No se usa:** `server.js`, `openapi.json`, la API REST propia, los tokens API propios, `tests/api`, Docker, compose, nginx, `deploy.sh` ni systemd.

### Equivalencias de funciones

| ik-library (servidor) | lama-library |
|---|---|
| Login Entra ID / OIDC | GitHub App + Worker |
| Roles reader/editor/admin en `access/users.json` | Permiso del team en `research-content` |
| Grupos y artículos restringidos por persona | **No hay.** Si hace falta, otro repo de contenido con otro team (sección 7) |
| Administración de usuarios en la UI | Teams de GitHub (org owners o maintainers del team) |
| Tokens API `kbt_…` | PAT de GitHub o `gh` contra `research-content` |
| API REST `/api/v1` | La API de GitHub sobre el repo; el contrato es la estructura de archivos |
| Espejo a GitLab | No hace falta: GitHub es el origen. Copia externa opcional (sección 5) |
| Conflicto = aviso `conflict: true` | Bloqueo optimista real (`expectedHeadOid`) más el mismo aviso por `revN` |

---

## 3. Componentes que hay que construir

### 3.1 GitHub (configuración, la hace un owner de la organización)
1. **Repo `lamassuiot/research` (público):** código de la app. Pages se publica con GitHub Actions (`actions/deploy-pages`).
2. **Repo `lamassuiot/research-content` (privado):** contenido.
   - **Ruleset en `main`:** prohibir el force-push y el borrado, para que el historial sea inmutable.
   - **No exigir PR**, porque bloquearía los commits directos de la app.
3. **Teams:** `research-editors` (Write) y, si hace falta, `research-readers` (Read), ambos sobre `research-content`.
4. **GitHub App "Lamassu Research"** propiedad de `lamassuiot`:
   - Permisos de repositorio: **Contents: Read & write** y Metadata: Read. Ningún permiso de organización.
   - Instalada **solo** en `research-content`.
   - Callback URL: `https://www.lamassu.io/research/`.
   - *Expire user authorization tokens*: activado (8 h).
   - Webhook desactivado.
   - Se guardan el *Client ID* (público, va en la app) y el *Client secret* (solo en el Worker).

### 3.2 Cloudflare Worker `research-auth` (en `worker/` del repo `research`)
No guarda estado. Tiene dos rutas, solo acepta `Origin: https://www.lamassu.io` y responde con CORS para ese origen.
- `POST /token {code, code_verifier}`: llama a `github.com/login/oauth/access_token` con `client_id` y `client_secret`. Devuelve solo `access_token` y `expires_in`, **sin refresh token** (ver 4.3).
- `POST /revoke {access_token}`: revoca el token al cerrar sesión (`DELETE /applications/{client_id}/token` con autenticación básica).

Boceto:

```js
export default {
  async fetch(req, env) {
    const cors = { "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN, "Access-Control-Allow-Methods": "POST",
                   "Access-Control-Allow-Headers": "Content-Type", "Vary": "Origin" };
    if (req.headers.get("Origin") !== env.ALLOWED_ORIGIN) return new Response("Forbidden", { status: 403 });
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });
    const body = await req.json().catch(() => ({}));
    const path = new URL(req.url).pathname;
    if (path === "/token") {
      const r = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET,
                               code: body.code, code_verifier: body.code_verifier, redirect_uri: env.REDIRECT_URI }) });
      const t = await r.json();
      return t.access_token
        ? Response.json({ access_token: t.access_token, expires_in: t.expires_in }, { headers: cors })
        : Response.json({ error: t.error || "exchange_failed" }, { status: 400, headers: cors });
    }
    if (path === "/revoke") {
      await fetch(`https://api.github.com/applications/${env.GITHUB_CLIENT_ID}/token`, {
        method: "DELETE", headers: { Authorization: "Basic " + btoa(env.GITHUB_CLIENT_ID + ":" + env.GITHUB_CLIENT_SECRET),
        Accept: "application/vnd.github+json", "User-Agent": "lamassu-research" },
        body: JSON.stringify({ access_token: body.access_token }) });
      return new Response(null, { status: 204, headers: cors });
    }
    return new Response("Not found", { status: 404, headers: cors });
  }
};
```

- Variables: `ALLOWED_ORIGIN=https://www.lamassu.io`, `REDIRECT_URI`, `GITHUB_CLIENT_ID`. Secreto: `wrangler secret put GITHUB_CLIENT_SECRET`.
- URL `research-auth.<cuenta>.workers.dev`: no hay que mover el DNS de lamassu.io.
- Despliegue con `wrangler deploy` desde una Action con `CLOUDFLARE_API_TOKEN`, o a mano.
- El Worker no da acceso a nada por sí mismo: el código OAuth es de un solo uso y el token resultante solo tiene los permisos del usuario.

### 3.3 Frontend: cambios sobre `index.template.html`

**a) Autenticación (módulo nuevo `auth`)**
- **Al cargar:** si no hay token en memoria, redirigir a `github.com/login/oauth/authorize?client_id=…&redirect_uri=…&state=…`. Antes se guardan en `sessionStorage` el `state`, el hash actual (`#/wiki/...`) y, si GitHub lo admite, el `code_verifier` de PKCE. **No se pinta nada de la wiki antes del login.**
- **Callback** (`/research/?code=…&state=…`): comprobar `state`, enviar el código al Worker, guardar el token **solo en memoria**, limpiar la URL con `history.replaceState` y volver al hash guardado.
- **Token caducado o 401:** se repite la redirección. Como la app ya está autorizada, GitHub vuelve sin preguntar nada: es un parpadeo de un segundo.
- **Cerrar sesión:** `/revoke` en el Worker y borrar el token de memoria.

**b) `GitHubStore`** (misma interfaz que `RestStore` y `ClaudeStore`; los ids de revisión son SHAs de commit, igual que en `RestStore`, así que las rutas de diff no cambian)

| Método | Implementación |
|---|---|
| `me()` | `GET /user` + `GET /repos/lamassuiot/research-content` → `permissions` (`push` → `canWrite`, `admin`). Un 404 lleva a la pantalla "sin acceso" |
| `listPages()` | **Una** consulta GraphQL que recorre el árbol `main:pages` y trae el texto de cada `meta.json` |
| `getPage(slug)` | GraphQL: `meta.json` en `main` + `history(path: "pages/<slug>", first: 1)` para el SHA actual |
| `listRevs(slug)` | GraphQL: `history(path: "pages/<slug>", first: 100)` con autor, fecha y mensaje, y por cada commit `file(path: ".../meta.json")` para `revN`, tamaño, estado y título. Es una sola petición |
| `getRev(slug, sha)` | `meta.json` en ese commit (GraphQL) + contenido con `GET /repos/…/contents/<path>?ref=<sha>` y `Accept: application/vnd.github.raw`. Se usa la vía REST porque GraphQL puede truncar blobs grandes, y los informes HTML pasan de 400 KB |
| `recent(limit)` | GraphQL: `history(path: "pages", first: limit)`. El slug sale del trailer `Know-how-Page`, y los metadatos de cada revisión se piden en una segunda consulta con aliases |
| `save(slug, d, baseRevN)` | Leer `meta.json` y el `oid` de `main`, calcular `revN + 1` y hacer la mutación **`createCommitOnBranch`** con `expectedHeadOid`: un commit atómico de `meta.json` y `content.*` (y el borrado del formato anterior si cambia), con el mensaje `summary` y los trailers `Know-how-Page/Revision/Status`, `Content-SHA256`. Si `main` se movió entretanto, se relee y se reintenta (hasta 3 veces). `conflict` se calcula con `baseRevN`, como ahora. El autor del commit es el propio usuario |
| `names(ids)` | Los autores ya vienen con nombre en los commits |
| búsqueda | En el cliente: primero metadatos; la primera búsqueda descarga con GraphQL el texto de los `content.md` y lo guarda en memoria |

**c) UI**
- `pickStore()`: se usa siempre `GitHubStore`. `MemoryStore` queda solo para tests y demo.
- **Pantallas que se quitan** (`hasAcl()` ya las oculta fuera de `RestStore`): administración de usuarios y grupos, permisos por artículo, tokens API y documentación OpenAPI.
- **Pantallas nuevas:**
  - **Acceso:** quién gestiona los teams y enlace al team.
  - **Automatización:** ejemplos con `gh api` / PAT para crear y editar artículos respetando la estructura y los trailers.
- **CSP con `<meta http-equiv="Content-Security-Policy">`** (Pages no permite cabeceras):
  - `default-src 'none'`.
  - `connect-src https://api.github.com https://research-auth.<cuenta>.workers.dev`.
  - `img-src 'self' data: https://avatars.githubusercontent.com`.
  - `script-src`/`style-src` solo lo necesario para el `index.html` autocontenido y los CDN de los informes HTML (el iframe `srcdoc` hereda la CSP, igual que en ik-library).
- **Marca Lamassu:**
  - Nombre (p. ej. "Lamassu Research"), logos y tokens de color.
  - Quitar las fuentes T-Star Pro de `ikerlan.es` y los valores `ikerlan`.
  - Mantener el modo oscuro y el diseño móvil.

### 3.4 Etiquetas (sin categorías)
lama-library **no tiene categorías**: cada artículo tiene una o varias **etiquetas** (`meta.tags`), elegidas de una lista cerrada. Un artículo sobre un RFC de Lamassu para PQC lleva, por ejemplo, `Lamassu RFCs` + `PQC` + `Crypto Agility`.

Etiquetas iniciales:

| Etiqueta |
|---|
| Lamassu |
| PKI |
| X509 |
| Lamassu RFCs |
| IETF RFCs |
| PQC |
| CBOM |
| Updates |
| RATs |
| Crypto Agility |

**Reglas:**
- **Lista cerrada en `tags.json`**, en la raíz de `research-content`:
  ```json
  { "tags": ["Lamassu", "PKI", "X509", "Lamassu RFCs", "IETF RFCs", "PQC", "CBOM", "Updates", "RATs", "Crypto Agility"] }
  ```
  - Así se evitan duplicados como `PQC` / `pqc` / `post-quantum`.
  - Añadir una etiqueta es editar el archivo, que queda versionado como cualquier otro cambio, sin desplegar la app.
  - El orden del archivo es el que muestra la app.
- **Al menos una etiqueta por artículo**, para que todo artículo aparezca en alguna página de etiqueta. Es lo que antes garantizaba la categoría obligatoria.
- **Renombrar o quitar una etiqueta** obliga a actualizar los `meta.json` que la usan. Se hace con un script en un solo commit.
- **La Action `validate` (3.5)** comprueba que las etiquetas de cada artículo están en `tags.json` y que hay al menos una.

**Cambios en el frontend respecto a ik-library** (unas 30 referencias a `category` en `index.template.html`):

| Sitio | ik-library | lama-library |
|---|---|---|
| `meta.json` y revisiones | `category` + `tags` | Solo `tags` |
| Menú lateral | Enlace *Categories* | Lista de etiquetas con su número de artículos |
| Rutas | `#/categories`, `#/category/:c`, `#/tag/:t` | `#/tags` (todas, con recuento) y `#/tag/:t` |
| Portada | "Browse by category" | "Browse by tag" (un artículo puede salir bajo varias) |
| Artículo | Infobox *Category* + caja de categoría al pie | Infobox *Tags* + caja de etiquetas al pie (estilo MediaWiki) |
| Editor | Desplegable de categoría + campo libre de tags | Selector múltiple (chips) con las etiquetas de `tags.json`; no se puede guardar sin al menos una |
| Diff de metadatos y restaurar | Comparan `category` | Comparan `tags` |
| Búsqueda y autocompletado | Muestran la categoría | Muestran las etiquetas |
| Crear desde una lista | `#/new?category=…` | `#/new?tag=…` (la etiqueta viene preseleccionada) |
| Ayuda | "Every article has a category…" | Explica las etiquetas |
| `MemoryStore` / `ClaudeStore` | Guardan `category` | Se quita el campo |

El formato de contenido deja de ser idéntico al de ik-library: para importar artículos de allí habría que convertir `category` en una etiqueta.

### 3.5 Repo de contenido: validación
Cualquiera con Write puede hacer push directo con git, lo que viene bien para importaciones masivas. Para que eso no rompa la wiki:
- **Action `validate`** en `research-content` en cada push: comprueba que el slug cumple `^[a-z0-9][a-z0-9-]{0,79}$`, que existe `meta.json` con los campos obligatorios, que las etiquetas están en `tags.json` (al menos una), que el `content.<format>` coincide con `meta.format`, que el `sha256` es correcto y que `revN` sube de uno en uno. Si algo falla, el check queda en rojo y se abre un issue.
- `README.md` en el repo de contenido con la estructura y el formato de los trailers.

---

## 4. Decisiones y sus motivos

### 4.1 Una sola rama y commits directos
La wiki es colaborativa y pequeña. Las PRs añadirían una revisión que ya cubre el flujo de madurez (Draft → Reviewed → Validated). `createCommitOnBranch` con `expectedHeadOid` evita pisar commits ajenos.

### 4.2 GraphQL para leer, `createCommitOnBranch` para escribir
- **Lectura:** el listado y el historial se resuelven en una petición cada uno, en lugar de N llamadas REST.
- **Escritura:** la mutación es atómica (varios archivos en un commit), comprueba la cabeza de la rama y firma el commit como *Verified*.
- **Límites:** los tokens de usuario tienen 5.000 peticiones/hora, de sobra para un equipo.

### 4.3 Token solo en memoria, sin refresh token
La app comparte origen (`https://www.lamassu.io`) con la web principal. Lo que se guarde en `localStorage` o `sessionStorage` podría leerlo cualquier JS que se publique en el futuro en `lamassuiot.github.io`. Por eso:
- El access token vive solo en una variable JS: se pierde al recargar y se recupera con la redirección silenciosa.
- No se pide ni guarda el refresh token.
- La navegación dentro de la app es por hash (`#/wiki/...`), así que no recarga la página.
- Los informes HTML siguen en un iframe `sandbox` sin `allow-same-origin`, y los Markdown pasan por DOMPurify: ninguno puede leer el token.

*Alternativa:* publicar en `research.lamassu.io` (dominio propio del repo `research`). Daría un origen aislado y permitiría guardar el token en `sessionStorage`, pero cambia la URL. Ver la pregunta 2 de la sección 7.

### 4.4 PKCE
Se envía `state` siempre y PKCE (`code_challenge` S256) si GitHub lo admite para GitHub Apps. Hay que confirmarlo en la fase 1. Aunque no lo admita, el canje exige el *client secret*, que solo tiene el Worker.

---

## 5. Copias de seguridad
- GitHub es la copia principal, con el historial completo.
- **Copia externa periódica:** una Action programada (semanal) en otro repo privado, o un cron en una máquina de Lamassu, que haga `git clone --mirror` de `research-content` y guarde un `git bundle`. Opcional: empujarlo también a un GitLab (p. ej. el de IKERLAN).
- La restauración se prueba una vez antes de pasar a producción.

---

## 6. Fases

Cada fase deja algo funcionando y comprobable. La primera atraviesa el sistema de punta a punta, porque el login es el riesgo principal.

1. **Configuración en GitHub y Cloudflare.**
   - Repos, teams, ruleset, GitHub App instalada en `research-content` y Worker desplegado.
   - Hecho cuando el Worker responde 403 a un `Origin` ajeno.
2. **Prueba de punta a punta del login.**
   - Un `index.html` mínimo en Pages (`www.lamassu.io/research`): login con GitHub → Worker → `GET /user` + permisos sobre `research-content`, mostrando "rol: editor" o "sin acceso".
   - Comprobar con tres cuentas: miembro del team, miembro de la organización fuera del team y cuenta ajena.
   - Comprobar también si GitHub acepta PKCE.
3. **Frontend copiado y limpio.**
   - Copiar `frontend/` y la UI de ik-library, aplicar la marca Lamassu, la CSP por `<meta>` y el módulo `auth`, y quitar las pantallas exclusivas del servidor.
   - Pipeline `build.py` → `actions/deploy-pages`.
   - Hecho cuando la app carga detrás del login con `MemoryStore`.
4. **`GitHubStore`, lectura.**
   - Sembrar a mano dos o tres artículos en `research-content` con la estructura (Markdown, un informe HTML grande y uno con varias revisiones).
   - Implementar listado, artículo, historial, revisión, diff y cambios recientes.
5. **`GitHubStore`, escritura.**
   - `save` con `createCommitOnBranch`, restaurar versión, reintentos y aviso de conflicto.
   - Probar dos pestañas guardando a la vez y un informe HTML de más de 400 KB.
6. **Pulido.**
   - Búsqueda, pantalla "sin acceso", caducidad del token y redirección silenciosa, cerrar sesión con revocación, y las pantallas Acceso y Automatización.
7. **Calidad.**
   - Tests Playwright con `page.route()` simulando `api.github.com` y el Worker (sin tocar GitHub real).
   - Action `validate` en `research-content`.
   - `README.md` y `CLAUDE.md` de ambos repos.
8. **Puesta en marcha.**
   - Contenido inicial, alta de personas en los teams y comprobar que una cuenta fuera del team no ve nada.
   - Primera copia externa y prueba de restauración.

---

## 7. Preguntas abiertas
1. **Nombres:** ¿`research` (fija la URL `/research`) y `research-content`? ¿Teams `research-editors` y `research-readers`, o reutilizar un team existente?
2. **Origen:** ¿se mantiene `www.lamassu.io/research` (token solo en memoria) o se pasa a `research.lamassu.io` (origen aislado)? Recomiendo mantener `/research` mientras la web principal no cargue scripts de terceros.
3. **Artículos restringidos:** ¿hace falta que algunos artículos solo los vea parte del equipo? Si es así, habría un segundo repo de contenido con su team, y la app tendría que leer de varios repos.
4. **Cuenta de Cloudflare:** ¿quién la crea y la administra? Si no se quiere Cloudflare, el mismo Worker funciona casi sin cambios en Deno Deploy, Netlify o Vercel Functions.
5. **Copia externa:** ¿dónde? Por ejemplo, otro repo privado, una máquina de Lamassu o el GitLab de IKERLAN.
6. **Contenido inicial:** ¿se migra algo de ik-library? Su repo de contenido tiene casi la misma estructura (habría que convertir `category` en etiqueta), aunque los artículos son de IKERLAN.
