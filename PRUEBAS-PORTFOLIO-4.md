# Pruebas — Portfolio, Fase 4 (Escritos, Uso, RSS, búsqueda, plantillas)

## Automáticas (ya pasan)
- `npm run test:portfolio-writing` — plantillas, RSS, búsqueda, fechas, orden de artículos, menú, JSON-LD (79).
- `npm run test:publish` (66), `test:render` (78), `test:portfolio-core` (84), `test:site` (28), `test:security` (48).

## A mano, en el OS (después de subir los cambios)
1. Portfolio → Pages → crea una página nueva tipo **Article** y pulsa "New note" en English: la nota debe traer un texto inicial con secciones (El problema / What I did…). Haz lo mismo con Project, About, Now y Uses.
2. Escribe un par de párrafos, revisa "Preview & publish" y publica. Debe salir sin advertencias si no hay nada raro.
3. Edita el artículo, publícalo otra vez: la fecha de "Publicado" **no cambia** (solo cambia la de actualización).

## A mano, en el sitio (necesita el proyecto de Vercel ya creado)
1. `/en/writing` lista los artículos del más nuevo al más viejo, con fecha, resumen y minutos de lectura. `/es/writing` igual en español.
2. Abre un artículo: título, fecha, minutos, índice si lo activaste, y el cuerpo. Cambia el slug y publica: la dirección vieja redirige a la nueva.
3. `/en/uses` muestra la página Uses. El menú muestra "Writing" y "Uses" solo si existe al menos una página publicada de ese tipo.
4. `/en/rss.xml`: abre en el navegador o en un lector RSS. Debe mostrar solo título, enlace, fecha y resumen (no el artículo entero).
5. Caja de búsqueda en la barra lateral: busca una palabra que esté en un proyecto y en un artículo. Salen ambos, con un fragmento y el tipo. Una palabra que no exista muestra el mensaje de "nada encontrado". Una sola letra pide al menos dos. Prueba también comillas, `%` y `(`: no debe fallar.
6. Los resultados de búsqueda no aparecen en Google (la página lleva noindex).
