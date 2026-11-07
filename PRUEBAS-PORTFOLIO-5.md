# Pruebas — Portfolio, Fase 5 (Videos)

## Automáticas (ya pasan)
- `npm run test:portfolio-videos` (68): solo entran videos largos, terminados y públicos; solo se copian título, descripción corta, fecha, miniatura y duración; la miniatura se copia a tu bucket; agregar, refrescar, quitar, ordenar; el código nunca lee guiones, tomas, pruebas ni estrategia.
- `test:site` (28), `test:security` (48), `test:publish` (66), `test:render` (78), `test:portfolio-core` (84), `test:portfolio-writing` (79).

## A mano, en el OS (después de subir los cambios)
1. Portfolio → **Videos**. En "Add a finished video" solo deben aparecer videos del add-on de YouTube que estén en etapa *published*, sean largos y tengan id de YouTube. Un Short, un video sin terminar o uno privado/no listado **no** deben poder agregarse.
2. Agrega uno: aparece en "Shown on the site" con su miniatura, título (EN y ES), fecha y duración. La duración solo sale si `YOUTUBE_API_KEY` está puesta.
3. Prueba **↑ ↓**, **Hide/Show**, **Feature**, **Refresh** y **Remove**. Remove no toca el video en YouTube.
4. Cambia el título en el add-on de YouTube, pulsa **Refresh**: el título nuevo se copia; si lo ocultaste o destacaste, eso se conserva.

## A mano, en el sitio
1. `/en/videos` y `/es/videos`: tarjeta con miniatura y botón de play. **No** se carga nada de YouTube hasta que pulsas play (míralo en la pestaña Red del navegador: solo entonces aparece `youtube-nocookie.com`).
2. Inicio: sección "Latest video" con el primer video destacado, o el más nuevo si ninguno lo está.
3. En un proyecto o artículo, pega una dirección de YouTube en el campo **Video**, publica: aparece el reproductor debajo del texto.
4. El menú muestra "Videos" solo cuando hay al menos uno visible.
