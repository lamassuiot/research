# research-content

Contenido de la wiki **Lamassu Research** (https://www.lamassu.io/research/). Este repositorio es **privado**: el acceso a la wiki es el acceso a este repositorio, que se concede mediante teams de la organización.

La wiki lee y escribe aquí directamente desde el navegador, con el token de GitHub de cada persona. Cada guardado es un commit del propio autor.

## Estructura

```
tags.json                                   {"tags": ["Lamassu", "PKI", ...]}   lista cerrada de etiquetas, en el orden en que se muestran
projects/<id>/project.json                  el proyecto y su estructura (orden y anidación)
projects/<padre>/projects/<hijo>/          un subproyecto con la misma estructura
projects/<id>/pages/<slug>/meta.json        metadatos del artículo
projects/<id>/pages/<slug>/content.md       el contenido (o content.html/json/yaml/yml, según meta.format; exactamente uno)
projects/<id>/links/<id>.json               un enlace externo (noticia, blog, paper…)
projects/<id>/files/<nombre>.pdf            PDFs, JSON y YAML, hasta 50 MB
```

**Todo vive dentro de un proyecto.** No hay `pages/`, `links/` ni `files/` en la raíz (el validador los rechaza). Los slugs, los ids de enlace y los nombres de archivo son únicos en todo el repositorio (no solo dentro de su proyecto), y el id de un proyecto no puede coincidir con el slug de un artículo.

- **slug:** `^[a-z0-9][a-z0-9-]{0,79}$`.
- **meta.json:** `title`, `tags` (hasta 20, todas en `tags.json`; la app ya no las pide: las etiquetas las llevan los proyectos), `status` (`draft`, `reviewed`, `validated` o `deprecated`), `format` (`md`, `html`, `json`, `yaml` o `yml`), `abstract` (hasta 240 caracteres), `revN` (empieza en 1 y sube de uno en uno en cada guardado), `updatedAt`, `updatedBy`, `createdAt`, `createdBy`. No hay `category`: solo etiquetas.
- **project.json:** `title`, `description` (opcional), `tags` (opcional, de `tags.json`; si hay, el proyecto se indexa en esas etiquetas y sus páginas no), `intro` (opcional, Markdown de hasta 50 000 caracteres que se muestra en la portada del proyecto, bajo las tarjetas de acceso rápido), `items` (árbol: `{"type": "page"|"link"|"file", "id": ..., "children": [...]}`; solo las páginas tienen `children`; el orden del array es el orden que se muestra; profundidad máxima 8), `createdAt/By`, `updatedAt/By`. **La pertenencia a un proyecto la da la carpeta**; el árbol solo ordena y anida. Un elemento que está en la carpeta pero no en el árbol se muestra al final; uno que el árbol nombra pero no está en la carpeta es un error del validador. Trailer de commit: `Know-how-Project: <id>`.
- **links:** un `.json` por enlace, id `^[a-z0-9][a-z0-9-]{0,79}$`: `url` (http/https, sin usuario ni contraseña), `title` (hasta 200), `description` (hasta 300, opcional), `kind` (`news`, `blog`, `paper`, `video`, `docs` u `other`), `tags` (hasta 20, en `tags.json`; opcionales), `addedAt`, `addedBy`, `updatedAt`, `updatedBy`. Se pueden borrar (el historial de git lo conserva). Trailer de commit: `Know-how-Link: <id>`.
- **files:** PDFs, JSON y YAML, sin subcarpetas, nombre `^[a-z0-9][a-z0-9._-]{0,95}\.(pdf|json|yaml|yml)$`. Subir un archivo con el mismo nombre crea una versión nueva; las anteriores quedan en el historial (y ocupan espacio en el repo para siempre: evita subir versiones innecesarias de PDFs grandes). Mensaje de commit con el trailer `Know-how-File: <nombre>`.
- **Mover entre proyectos:** `git mv` de la carpeta/archivo al otro proyecto y editar los dos `project.json` (quitarlo de uno, añadirlo al otro) en el mismo commit. La app lo hace con un solo commit que reutiliza los blobs. El historial de una página en la app empieza en el movimiento (git conserva el anterior).
- Un proyecto solo se puede borrar cuando está vacío.
- Para añadir, renombrar o quitar etiquetas se edita `tags.json`. Renombrar o quitar una etiqueta obliga a actualizar los `meta.json` que la usan, en un solo commit.

## Editar con git

Se puede, pero hay que respetar el formato: la pestaña *Recent changes* lee los trailers del mensaje de commit.

```
Actualiza las notas de PQC

Know-how-Page: pqc-migration-notes
Know-how-Project: general
Know-how-Revision: 2
Know-how-Status: draft
```

La Action `validate` comprueba la estructura en cada push y abre un issue si falla en `main`. En local: `node scripts/validate.mjs`.

## Reglas

- **No hacer force-push ni borrar `main`:** el historial es la trazabilidad. Se recomienda un ruleset en la rama que lo bloquee, sin exigir PR (la wiki hace commits directos).
- Los artículos no se borran: se marcan como `deprecated`.

### Subproyectos

Los subproyectos se almacenan físicamente en `projects/<padre>/projects/<hijo>/`, con su propio `project.json`, `pages/`, `links/`, `files/` y, si procede, otro `projects/`. La carpeta determina el padre. El campo opcional `parentProject` debe coincidir con él cuando esté presente. Los IDs de proyecto son únicos en todo el repositorio.

Cada subproyecto conserva su introducción, etiquetas y contenidos; no hay herencia de etiquetas. Cambiar de padre desde la aplicación mueve la carpeta completa, incluidos sus subproyectos y archivos, en un único commit. Las URLs siguen usando los IDs y se mantienen estables. La aplicación impide eliminar proyectos que aún tengan subproyectos. Git conserva el historial anterior al movimiento; el historial mostrado por la wiki comienza en la ubicación nueva.
