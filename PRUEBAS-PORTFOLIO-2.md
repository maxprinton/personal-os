# Pruebas · Portafolio, Fase 2 (motor de publicación)

Nada de esto es público todavía: el sitio público llega en la Fase 3. Aquí compruebas que, desde el OS, una nota se
convierte en una página limpia, con avisos claros, y que se puede publicar, actualizar, despublicar y revertir.

**Antes de empezar**
- La migración 0042 ya está aplicada (Fase 1).
- En Vercel (o en `.env.local`) debe existir `SUPABASE_SECRET_KEY` (ya la usa Telegram). Sin ella, "Preview & publish" te dirá qué falta.
- Sube los cambios con SUBIR-CAMBIOS.cmd y espera a que termine el build.

## Pruebas automáticas (ya pasaron aquí)
`npm run test:render` (78), `npm run test:publish` (65), `npm run test:portfolio-core` (84), más `test:addons`, `test:notes-db`, `test:editor` sin cambios.

## Pruebas en el OS

1. **Menú Kind → Portfolio page…** Abre cualquier nota normal → menú de Kind/Block (el botón de la propiedad Kind) → "Portfolio page…".
   Debe listar tus páginas del portafolio con botones EN / ES (un punto • = ya tiene nota). Elige una vacía → confirma. La nota muestra la chip 🌐.
   Repite con "Unlink from…" para desvincular. *(Una nota de bloque del calendario no muestra esta opción.)*
2. **Prepara una nota de prueba** (vinculada a una página tipo Project, idioma EN) con: un título, un H2, una imagen subida (arrastrada al editor),
   un callout, una lista con una tarea sin marcar, un toggle cuyo título empiece con 🔒, un enlace a otra nota tuya (privada), un video de YouTube
   (`<video>` o pegando el enlace) y una ecuación `$x^2$`.
3. En la tarjeta de ese idioma (Portfolio → Pages → la página) pulsa **Preview & publish**. Debe abrirse el diálogo con:
   - la página como la verán los visitantes (el toggle 🔒 NO aparece; la imagen sí; la ecuación se ve);
   - a la derecha los avisos: "1 unchecked to-do…", "1 link to a private note became plain text", "1 🔒 block was removed on purpose" (gris), "1 file was copied…" (gris);
   - una casilla "I reviewed the warnings…" que habilita **Publish**.
4. Pulsa **Publish**. Debe decir "Published as version 1 → /projects/…". En Supabase (tabla `portfolio_pages`) hay 1 fila con `is_live = true`,
   `body_html` sin `/api/files/`, y en Storage → `portfolio-media` hay una carpeta con el id de la página y la imagen dentro.
5. **Metadatos fuera**: descarga la imagen de `portfolio-media` y revisa sus propiedades: no debe traer GPS ni datos de cámara (si la foto estaba rotada, se ve igual de derecha).
6. **Cambios detectados**: edita la nota (cambia una palabra) y vuelve a Pages: el estado pasa a **Changed since published**. Cambia solo el resumen
   de la página (Slot editor) → también "Changed". Abre Preview & publish → botón **Publish update** → versión 2.
7. **Historial**: pulsa **History**: ves v2 "Live now" y v1. En v1 pulsa **Restore** → se crea la versión 3 con el contenido viejo.
8. **Despublicar**: **Unpublish** → confirma → el estado es "Unpublished", la fila queda con `is_live = false` y la carpeta de imágenes en `portfolio-media` se vacía.
   Vuelve a publicar con Preview & publish (las imágenes se copian de nuevo). *Restaurar* una versión vieja tras despublicar puede decir que las imágenes ya no existen: es lo esperado; publica desde la nota.
9. **Errores que bloquean** (el botón Publish queda desactivado y se explica qué arreglar): nota sin título o sin contenido; una imagen todavía subiéndose;
   un archivo de más de 10 MB; un video subido (usa YouTube); dos páginas con la misma dirección (slug); nota en la papelera.
10. **Palabras nunca públicas**: en Portfolio → Settings añade una palabra (por ejemplo el nombre de un cliente). Escríbela en la nota → Preview: aparece
    resaltada en rojo y el aviso "match for words you marked as never public" pide confirmación.
11. **Enlace entre páginas**: publica la página About; en otra nota enlaza la nota de About (`[[`). Al publicar, ese enlace se vuelve un enlace público (`/about`), no texto plano.
12. **Cambio de dirección**: cambia el slug de una página ya publicada y publica: la fila guarda el slug viejo en `meta.previous_slugs` (el sitio lo usará para el redireccionamiento 301).

## Qué no hace todavía
- No hay sitio público: nadie ve nada. El aviso al sitio ("revalidate") se salta si no existen `PORTFOLIO_SITE_URL` y `PORTFOLIO_REVALIDATE_SECRET` (se configuran en la Fase 3).
- Los PDF se copian tal cual (sin quitar autor/metadatos); las imágenes AVIF se rechazan (conviértelas a JPG/PNG/WebP).
