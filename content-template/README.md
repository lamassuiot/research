# research-content

Contenido de la wiki **Lamassu Research** (https://www.lamassu.io/research/). Este repositorio es **privado**: el acceso a la wiki es el acceso a este repositorio, que se concede mediante teams de la organización.

La wiki lee y escribe aquí directamente desde el navegador, con el token de GitHub de cada persona. Cada guardado es un commit del propio autor.

## Estructura

```
tags.json                    {"tags": ["Lamassu", "PKI", ...]}   lista cerrada de etiquetas, en el orden en que se muestran
pages/<slug>/meta.json       metadatos del artículo
pages/<slug>/content.md      el contenido (o content.html, según meta.format; exactamente uno)
files/<nombre>.pdf           PDFs (manuales, especificaciones), hasta 50 MB
links/<id>.json              un enlace externo (noticia, blog, paper…)
projects/<id>.json           un proyecto: contenedor con el árbol de páginas, enlaces y archivos
```

- **slug:** `^[a-z0-9][a-z0-9-]{0,79}$`.
- **meta.json:** `title`, `tags` (de 1 a 20, todas en `tags.json`), `status` (`draft`, `reviewed`, `validated` o `deprecated`), `format` (`md` o `html`), `abstract` (hasta 240 caracteres), `revN` (empieza en 1 y sube de uno en uno en cada guardado), `size` (bytes UTF-8 del contenido), `sha256` (hex del contenido), `updatedAt`, `updatedBy`, `createdAt`, `createdBy`. No hay `category`: solo etiquetas.
- **projects/**: un `.json` por proyecto: `title`, `description` (opcional), `items` (árbol: `{"type": "page"|"link"|"file", "id": ..., "children": [...]}`; solo las páginas tienen `children`; el orden del array es el orden que se muestra; profundidad máxima 8), `createdAt/By`, `updatedAt/By`. Un elemento solo puede estar en un proyecto, y el id del proyecto no puede coincidir con el slug de un artículo. Trailer de commit: `Know-how-Project: <id>`.
- **links/**: un `.json` por enlace, id `^[a-z0-9][a-z0-9-]{0,79}$`: `url` (http/https, sin usuario ni contraseña), `title` (hasta 200), `description` (hasta 300, opcional), `kind` (`news`, `blog`, `paper`, `video`, `docs` u `other`), `tags` (de 1 a 20, en `tags.json`), `addedAt`, `addedBy`, `updatedAt`, `updatedBy`. Se pueden borrar (el historial de git lo conserva). Trailer de commit: `Know-how-Link: <id>`.
- **files/**: solo PDFs, sin subcarpetas, nombre `^[a-z0-9][a-z0-9._-]{0,95}\.pdf$`. Subir un archivo con el mismo nombre crea una versión nueva; las anteriores quedan en el historial (y ocupan espacio en el repo para siempre: evita subir versiones innecesarias de PDFs grandes). Mensaje de commit con el trailer `Know-how-File: <nombre>`.
- Para añadir, renombrar o quitar etiquetas se edita `tags.json`. Renombrar o quitar una etiqueta obliga a actualizar los `meta.json` que la usan, en un solo commit.

## Editar con git

Se puede, pero hay que respetar el formato: la pestaña *Recent changes* lee los trailers del mensaje de commit.

```
Actualiza las notas de PQC

Know-how-Page: pqc-migration-notes
Know-how-Revision: 2
Know-how-Status: draft
Content-SHA256: <sha256 del contenido>
```

La Action `validate` comprueba la estructura en cada push y abre un issue si falla en `main`. En local: `node scripts/validate.mjs`.

## Reglas

- **No hacer force-push ni borrar `main`:** el historial es la trazabilidad. Se recomienda un ruleset en la rama que lo bloquee, sin exigir PR (la wiki hace commits directos).
- Los artículos no se borran: se marcan como `deprecated`.
