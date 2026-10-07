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

## 9. Ampliación: proyectos

Decisiones del usuario: el proyecto es **solo un contenedor** (sin contenido propio), un elemento pertenece a **un único proyecto**, **sin privacidad por proyecto**, orden **manual**, direcciones estilo **MediaWiki** `Proyecto/Subpágina`.

- **Modelo:** `projects/<id>.json` con el árbol completo: `items: [{type: page|link|file, id, children?}]`. Solo las páginas tienen hijos (subpáginas), la profundidad máxima es 8 y el orden es el del array. Las páginas, enlaces y PDFs **no cambian** al agruparlos: no llevan `parent` ni `order`. Así mover, reordenar o anidar es un commit pequeño que solo toca el archivo del proyecto, no hay ciclos posibles y mover un PDF de 30 MB no lo vuelve a subir.
- **Direcciones:** `#/wiki/<proyecto>` es el proyecto; `#/wiki/<proyecto>/<padre>/<página>` es una página, derivada del árbol. La clave del artículo sigue siendo su slug (último segmento), así que **cualquier dirección antigua o equivocada redirige a la canónica** (`location.replace`) y mover una página nunca rompe los enlaces. Las direcciones de proyectos y artículos comparten espacio: la UI y el validador impiden que coincidan.
- **Interfaz:** página *Projects* (lista y alta); portada de proyecto con su árbol y los botones *Add page / Add link / Upload PDF*; **Organize** (↑ ↓ reordenar, → hacer subpágina del elemento de arriba, ← sacarla, ✕ quitar del proyecto sin borrar el elemento); *Add existing items* (solo los que no están en otro proyecto); editar y borrar proyecto (los elementos se conservan); migas de pan y sección *In this page* con las subpáginas, enlaces y PDFs y atajos para añadir más; el árbol del proyecto en la **barra lateral** mientras se lee dentro de él; fila *Project* en la ficha del artículo; caja *Projects* en la portada.
- **Atomicidad:** crear una página, un enlace o un PDF desde un proyecto escribe el elemento y su colocación en el árbol **en el mismo commit** (`createCommitOnBranch`; para PDFs, el mismo árbol de Git Data). Los cambios del árbol se leen, modifican y escriben **dentro del bucle de commit** con `expectedHeadOid`, de modo que dos personas reorganizando a la vez se reintentan sobre el estado nuevo en lugar de pisarse.
- **Validador:** comprueba `projects/` (nombre, título, campos, tipos, solo páginas con hijos, profundidad, un elemento en un único proyecto, y que el id no coincida con un artículo), con 9 tests nuevos.
- **Tests:** 12 tests Playwright nuevos (crear proyecto, página en un commit, subpáginas con migas, redirecciones, enlace y PDF bajo una página, árbol en la barra lateral, organizar con cuatro commits que solo tocan el archivo del proyecto, mover entre proyectos, colisión de direcciones, editar y borrar, lector sin controles, portada).
- **Sin verificar con GitHub real:** las consultas `ListProjects`, `ProjectBlobs` y `ReadFiles` tienen la misma forma que otras ya validadas, pero no se ejecutaron tal cual; y que la API de Git Data acepte entradas de árbol con `content` en línea (usadas al colocar un PDF en un proyecto).
- **Límites conocidos:** las referencias a elementos que se han borrado (por ejemplo un enlace quitado) se ignoran pero no se podan solas del árbol; no se puede arrastrar para ordenar (solo flechas); un proyecto no puede contener otros proyectos; mover una página a otro proyecto es *quitar* + *añadir existente*.

## 10. Ampliación: etiquetas de proyecto y barra lateral en modo proyecto

- **Etiquetas en proyectos:** `projects/<id>.json` admite `tags` (opcional, de `tags.json`, hasta 20). Se eligen al crear y al editar el proyecto.
- **Regla de indexado:** si un proyecto tiene etiquetas, **él** aparece en la página de cada etiqueta (sección *Projects tagged*), en los contadores de la barra lateral y de `#/tags`, y en *Browse by tag* de la portada; **sus páginas y enlaces hijos, a cualquier profundidad, no se indexan** en las etiquetas (siguen conservando las suyas, y se ven en el árbol del proyecto, en la búsqueda y en *All articles*). Si el proyecto no tiene etiquetas, sus páginas se indexan por las suyas, como antes. Si se quitan las etiquetas del proyecto, las hijas vuelven a indexarse. La página *External links* conserva su propio filtro por etiqueta, que no cambia.
- **Barra lateral en modo proyecto:** al seleccionar contenido de un proyecto (una página, su edición, historial o diff, un PDF, o el propio proyecto), la lateral cambia al instante: desaparece el menú principal, queda *Contents* y aparece, a su izquierda, una segunda barra con **toda la estructura del proyecto** (con el elemento actual marcado), y encima de las dos, el **título del proyecto** con un enlace *Projects* para volver. Al salir del proyecto vuelve el menú. En pantallas estrechas las tres partes se apilan en el cajón lateral.
- **Validador:** comprueba `tags` en proyectos (existentes en `tags.json`, sin duplicados, máximo 20). **Tests:** 5 tests Playwright y 1 unitario nuevos (etiquetar un proyecto, el índice sin las hijas, quitar etiquetas, páginas de un proyecto sin etiquetas, modo proyecto con su geometría, cambio inmediato y vuelta al menú).
- **Límites:** los enlaces de *External links* dentro de un proyecto etiquetado siguen apareciendo en esa página con su filtro propio. En modo proyecto el botón del menú oculta la estructura y deja solo los contenidos.

## 11. Ampliación: portada del proyecto (accesos rápidos + introducción)

- **Orden de la portada:** descripción y etiquetas, botones de alta, **Quick access**, **introducción en Markdown**, y por último **Structure** (el árbol, con *Organize*).
- **Quick access:** una tarjeta por cada **enlace** (título, host, descripción de dos líneas, tipo; se abre en una pestaña nueva con `noopener noreferrer nofollow`) y por cada **PDF** (nombre, tamaño, *Preview*, abre el visor), a cualquier profundidad y en el orden del árbol. Las páginas no son tarjetas: son la estructura. Sin enlaces ni PDFs no se muestra la sección. Rejilla adaptable, con modo claro y oscuro.
- **Introducción:** campo `intro` (Markdown, hasta 50 000 caracteres) en `projects/<id>.json`; se edita en *Edit project* (un `textarea`) y se guarda en un commit que solo toca ese archivo. Se renderiza con el mismo saneado que los artículos (DOMPurify: sin scripts ni `javascript:`), admite `[[enlaces wiki]]`, `[[File:…]]` y `![[File:…]]` con vista previa. Si está vacía se elimina el campo; sin introducción los editores ven una pista y los lectores nada.
- **Cambio colateral:** los `[[enlaces wiki]]` de cualquier Markdown ya apuntan directamente a la dirección canónica (`#/wiki/proyecto/padre/página`), sin pasar por la redirección.
- **Validador:** comprueba `intro` (texto, máximo 50 000). **Tests:** 4 de Playwright (tarjetas con destinos y atributos seguros, introducción segura entre tarjetas y estructura con un único commit sobre el archivo del proyecto, vaciar la introducción, lector) y 1 unitario.

## 12. Ajustes de la barra lateral en pantallas grandes y de los elementos seleccionados

- **Doble indicador:** el elemento actual de la estructura del proyecto recibía a la vez la barra lateral del menú principal (`.side li a.cur`) y la de las filas del árbol. Ahora el enlace de un árbol no hereda el estilo de píldora del menú y hay **un solo indicador**.
- **Estilo de selección unificado** en todas las listas laterales (menú, etiquetas, madurez, estructura del proyecto): fondo azul suave de marca, texto de marca en negrita, sin barra lateral; el icono y el contador toman también el color de marca. En *Contents*, el apartado activo lleva el mismo tinte y un borde de marca.
- **Pantallas grandes:** en modo proyecto, el ancho extra se reparte entre las barras laterales (`--side-w`, de 488 px hasta 860 px con *Contents*, y de 272 a 420 px sin él) y **el contenido principal conserva su ancho máximo de siempre** (1000 px junto a *Contents*, 1216 px sin él). La cabecera sigue el mismo ancho para que todo quede alineado. Las barras de estructura y contenidos tienen menos saltos de línea. En 2200 px de ancho, los márgenes pasan de 320 a unos 170 px por lado.
- **Test:** 1 de Playwright (a 2400 px las barras son al menos 150 px más anchas que a 1366 px, el contenido no pasa de 1000 px, y la fila seleccionada tiene un solo indicador).

## 13. Bordes de la barra lateral y estructura colapsable

- **Bordes más suaves:** la barra lateral ya no corta en seco la última entrada: el contenido se desvanece donde la lista continúa. Dentro del área con scroll hay margen para que ni las píldoras ni el anillo de foco toquen o queden recortados por el borde. Todas las filas usan el mismo radio (8 px); en *Contents* el apartado activo es una píldora completa (antes mezclaba un borde izquierdo con medio fondo) y la guía vertical es más tenue.
- **Cada barra con su propio scroll** en modo proyecto: el título del proyecto queda fijo y *Structure* y *Contents* se desplazan por separado (antes toda la lateral era un único scroll y el título y la estructura se iban con el contenido). Cada una con su barra de desplazamiento fina y su desvanecido. Se oculta la nota de almacenamiento de la lateral en este modo (sigue en el pie de página). En pantallas estrechas vuelve a ser un solo cajón.
- **Structure se puede colapsar:** el encabezado es un botón (`aria-expanded`, con título de ayuda). Colapsada, queda una **ranura estrecha** con el texto *STRUCTURE* en vertical y la flecha, y *Contents* gana ese ancho. La elección se recuerda en este navegador (`kb.tree`).
- **Tests:** 2 de Playwright (colapsar, recordarlo tras recargar y ganar ancho; scroll independiente con el título y la estructura fijos).

## 14. Ancho de la barra lateral ajustable

- **Cómo:** un tirador (`#sideResizer`) junto al borde derecho de la barra lateral. Al arrastrarlo, la barra se ensancha o se estrecha y **el contenido toma la diferencia**. Con teclado: `←`/`→` (16 px; con Mayús, 64 px), `Inicio` y doble clic restablecen. Tiene `role="separator"` con `aria-valuenow`, y se resalta en el color de marca al pasar el ratón, al enfocarlo y al arrastrar.
- **Límites:** menú principal de 200 px a 520 px (máximo 40 % de la pantalla); modo proyecto de 360 px (220 px sin *Contents*) a 1100 px (máximo 62 % de la pantalla).
- **Se recuerda por diseño:** un ancho para el menú principal (`kb.sidew.n`) y otro para el modo proyecto (`kb.sidew.p`), en este navegador. Con un ancho propio en modo proyecto, el contenido deja de tener su máximo fijo y ocupa el resto de la pantalla, de modo que más barra significa menos contenido y al revés (sin ancho propio sigue el reparto automático anterior).
- **Dónde no aparece:** en pantallas estrechas (cajón lateral), con la barra oculta, en el modo de informe a ancho completo y en la pantalla de acceso. Durante el arrastre se desactivan los iframes (los informes HTML no capturan el ratón) y las transiciones.
- **Tests:** 4 de Playwright (arrastrar y que el contenido ceda, recordarlo tras recargar, límites, teclado, restablecer; anchos independientes entre menú y proyecto; sin tirador en el móvil).

## 15. Rendimiento

Medido con el GitHub simulado (cuenta las peticiones) y con llamadas reales a la API desde esta máquina (0,6–0,8 s cada una, así que cada petición evitada o encadenada de menos son unos 0,6 s).

| Navegación | Antes | Ahora |
|---|---|---|
| Arranque hasta la portada | 16 peticiones (el listado completo, dos veces) | **7** (`/token`, `/user`, repo, etiquetas, listado ×2, recientes) |
| Abrir un artículo | 6 peticiones en cadena (≈5 viajes) | **2** (≈2 viajes) |
| Abrir el mismo artículo otra vez | 6 | **0** (historial y contenido en memoria) |
| Proyecto, etiqueta, etiquetas, enlaces, proyectos | 2–7 | **0** (listado en caché) |
| Historial / info de un artículo ya abierto | 3–4 | **0** |

- **Un solo listado, compartido y en caché:** `loadIndex()` trae todo en 2 viajes (árboles de `pages/`, `files/`, `projects/` y `links/` con los JSON pequeños en línea, y los `meta.json` de las páginas en trozos paralelos). Se reutiliza 60 s, se comparte entre llamadas simultáneas y toda escritura propia lo invalida al instante. Las vistas ya no fuerzan la recarga en cada visita.
- **Un artículo = una consulta (`GetArticle`) + una lectura de contenido.** El contenido de una revisión es inmutable, así que se guarda en memoria por id de commit (hasta ~24 MB). Se vacía la caché del artículo tras un commit propio.
- **Arranque más corto:** `/user` y el permiso del repositorio en paralelo, etiquetas y listado en paralelo, y la portada pide los recientes en su versión ligera (sin consultar la meta de cada revisión).
- **Búsqueda:** el índice de texto pide 1 lectura por artículo (antes 2-3 peticiones), por rama, sin necesitar el id de commit.
- **Carga de la página:** la fuente de iconos pasa de **395 KB a ~8 KB** (solo los ~70 iconos usados, `frontend/icons.txt`), las hojas de fuentes ya no bloquean el primer pintado, y hay `preconnect` a `api.github.com`, al Worker y a las fuentes. Un test recorre todas las vistas y falla si alguna muestra un icono que no está en el subconjunto.
- **Verificado contra GitHub real (solo lectura):** `Index` y `GetArticle` se aceptan sin errores de esquema.
- **Tests:** `perf.spec.js` fija el presupuesto de peticiones por navegación y `icons.spec.js` vigila el subconjunto de iconos.
- **Lo que sigue costando:** cada **carga completa** de la página (F5, abrir un enlace en una pestaña nueva) repite el inicio de sesión por GitHub (`/authorize` → Worker → `/user`), unos 3 viajes, porque el token solo vive en memoria; navegar dentro de la app no recarga. Reducirlo exigiría guardar el token en `sessionStorage`, lo que se descartó por seguridad (misma origen que la web de Lamassu). Otras mejoras posibles: mostrar el listado antiguo mientras se refresca (*stale-while-revalidate*) y un `index.json` mantenido por el repo para evitar el segundo viaje del listado.

## 16. Tarjetas con el estilo de la vista previa de un enlace

- **Una sola tarjeta (`.ucard`) para todo:** enlaces, accesos rápidos del proyecto, proyectos (lista, etiquetas y portada) y PDFs incrustados. Horizontal, con el título en negrita, la descripción (2 líneas), una fila de **origen con icono y nombre** y un **panel visual a la derecha**, a ras del borde, con una barra de acento en la base.
- **Enlaces:** icono de origen (cuadrado con la inicial del sitio y un color derivado del dominio), dominio, tipo, etiquetas y "added by…", con *Edit* y *Remove*. **Toda la tarjeta es el enlace** (enlace estirado), y las etiquetas y botones quedan por encima.
- **Panel derecho:** se **genera** a partir del dominio (inicial grande sobre un degradado del mismo color); los PDFs usan el rojo con el icono de PDF, y los proyectos, la carpeta. Claro y oscuro con los mismos tokens; en pantallas estrechas el panel se reduce.
- **No hay imágenes reales de las webs** (la portada que muestra Slack o un blog): la app no contacta con esos sitios y la CSP no permite imágenes externas. Mostrarlas exigiría decidir cómo obtenerlas (ver abajo).
