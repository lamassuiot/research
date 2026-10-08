# Puesta en marcha (pasos manuales)

Lista para una persona **owner de la organización `lamassuiot`**. El código no crea nada en GitHub ni en Cloudflare: todo esto se hace a mano. Marca cada casilla al terminar.

Resultado: la wiki en `https://www.lamassu.io/research/`, con login de GitHub y acceso solo para el team elegido.

## 1. Repositorios
- [ ] Crear **`lamassuiot/research`** (público): contiene el código de la app (este repositorio). El nombre fija la ruta `/research` de GitHub Pages.
- [ ] Crear **`lamassuiot/research-content`** (privado): contiene los artículos.
- [ ] En `research-content`, hacer el primer commit en `main` con el contenido de `content-template/` de este repositorio (`tags.json`, `projects/`, `scripts/`, `.github/`, `README.md`). La rama `main` tiene que existir antes de usar la app.

## 2. Protección y teams
- [ ] Ruleset en `research-content` sobre `main`: **bloquear force-push y borrado de la rama**. **No** exigir pull request: la wiki hace commits directos.
- [ ] Crear el team `research-editors` con permiso **Write** sobre `research-content` (y, si hace falta, `research-readers` con **Read**). Añadir a las personas.
- [ ] Si el team tiene otro nombre, cambiar `accessTeamUrl` en `frontend/config.json`.

## 3. GitHub App
En *Organization settings → Developer settings → GitHub Apps → New GitHub App*:
- [ ] Nombre: p. ej. *Lamassu Research*. Homepage: `https://www.lamassu.io/research/`.
- [ ] **Callback URL:** `https://www.lamassu.io/research/`
- [ ] **Expire user authorization tokens:** activado (los tokens duran 8 h).
- [ ] **Request user authorization (OAuth) during installation:** desactivado. **Webhook:** desactivado.
- [ ] Permisos de repositorio: **Contents: Read and write** y **Metadata: Read-only**. Ningún permiso de organización ni de cuenta.
- [ ] *Where can this GitHub App be installed?* **Only on this account**.
- [ ] Crear la app, **instalarla solo en `research-content`** (*Install App → Only select repositories*).
- [ ] Anotar el **Client ID** (empieza por `Iv`) y generar un **client secret**.

> Una GitHub App (y no una OAuth App) hace que el token solo sirva para `research-content`, no para el resto de repositorios privados de cada persona.

## 4. Cloudflare Worker
- [ ] Cuenta de Cloudflare (el plan gratuito basta) y `cd worker && pnpm dlx wrangler login`.
- [ ] En `worker/wrangler.toml`, poner el Client ID en `GITHUB_CLIENT_ID`.
- [ ] `pnpm dlx wrangler secret put GITHUB_CLIENT_SECRET` y pegar el secret **a mano** (nunca en el chat ni en git).
- [ ] `pnpm dlx wrangler deploy`. Anotar la URL `https://research-auth.<cuenta>.workers.dev`.
- [ ] Opcional: secreto `CLOUDFLARE_API_TOKEN` en el repo `research` para usar el workflow `worker.yml`.

## 5. Configurar y publicar la app
- [ ] En `frontend/config.json`: `githubClientId` (el Client ID) y `authWorkerUrl` (la URL del Worker).
- [ ] `pnpm install && pnpm run build` y commit de `public/`.
- [ ] En `lamassuiot/research`: *Settings → Pages → Source: GitHub Actions*.
- [ ] Hacer push de este código a `lamassuiot/research` (`main`). El workflow `pages` ejecuta los tests y publica.

## 6. Verificación con tres cuentas
- [ ] Miembro del team: entra y ve los artículos de ejemplo.
- [ ] Miembro de la organización **fuera** del team: ve la pantalla *No access*.
- [ ] Cuenta ajena a la organización: ve la pantalla *No access*.
- [ ] Sin sesión, ningún título ni etiqueta se ve antes del login.

## 7. Comprobaciones con la API real
Los tests usan un GitHub simulado, así que esto solo se puede comprobar aquí. Marca cada punto.
- [ ] **PKCE:** GitHub acepta `code_challenge` / `code_verifier` para la GitHub App. Si el canje falla con `bad_verification_code` o similar, quitar PKCE del flujo (el canje sigue protegido por el client secret del Worker).
- [ ] **Consultas GraphQL:** la portada, un artículo, su historial y *Recent changes* cargan sin errores (consola del navegador).
- [ ] **Informes HTML grandes:** guardar un informe de más de 400 KB (`createCommitOnBranch`).
- [ ] **Guardado concurrente:** dos pestañas guardando a la vez. Si el mensaje de error real no contiene `point to` ni `expectedHeadOid`, ajustar la detección en `GitHubStore.save` (`frontend/index.template.html`).
- [ ] **Historial por revisión:** *View history* muestra el número de revisión, el tamaño y el estado de cada commit (`file(path:)` en `ListRevs`).
- [ ] **PDFs:** subir un PDF de 20–50 MB (API de Git Data: `POST /git/blobs`) y verlo en el visor. Comprobar también un PDF con imágenes JPEG 2000 y uno con fuentes no incrustadas.
- [ ] **Subida concurrente:** si `main` se movió, el `PATCH` de la ref devuelve 422 y la app reintenta.
- [ ] **Avatares:** se ve la foto de perfil en el menú de usuario (CSP: `img-src https://avatars.githubusercontent.com`).
- [ ] **Renovación del token:** a las 8 h (o con `expires_in` corto) la app vuelve a GitHub sin preguntar y regresa a la misma página.

## 8. Copia de seguridad
GitHub es la copia principal. Conviene una copia externa periódica:
```
git clone --mirror git@github.com:lamassuiot/research-content.git
git -C research-content.git bundle create ../research-content-$(date +%F).bundle --all
```
Probar una restauración (`git clone <bundle>`) antes de dar el sistema por bueno.
