# Pruebas · Portafolio, Fase 3 (sitio público)

Automáticas (ya pasaron): `npm run test:site` (28), `npm run test:security` (45), más las de la Fase 2.
Las manuales las haces después de seguir `PASOS-PUBLICAR-PORTFOLIO.md` (pasos 1 a 4).

## Contenido mínimo para probar
Publica desde el OS: Home (EN y ES), About (EN y ES), Now (EN), y 2 proyectos (uno con estado "shipped", años, stack y enlaces; otro "in progress"), uno destacado (Featured) y el otro no.

## Prueba de lanzamiento (sirve de puerta antes de salir a producción)
1. **Idioma:** abre la dirección raíz con el navegador en inglés → `/en`; cambia a español en el sidebar (botón ES) → `/es` y se queda (cookie). Un navegador en español entra directo a `/es`.
2. **Cambio de idioma por página:** en un proyecto publicado en EN y ES, el botón ES/EN lleva a ese mismo proyecto en el otro idioma. En una página que solo existe en EN, el botón ES va a la portada (en gris, con aviso al pasar el mouse).
3. **Diseño:** papel claro sobre pizarrón verde oscuro, anillos y agujeros a la izquierda, líneas de cuaderno, nombre "Maximiliano Avila" en dos líneas, página activa resaltada en amarillo, punto verde que pulsa en la tarjeta "Now".
4. **Teléfono (ancho < 760 px):** sidebar arriba como barra, menú que se desliza, tarjeta Now oculta, márgenes de 12 px, lista de proyectos sin año ni sello.
5. **Contenido:** la nota publicada se ve como en la vista previa del OS (callouts, columnas, toggles, código de colores, ecuaciones, video de YouTube con iframe `youtube-nocookie`); los bloques con 🔒 no aparecen; las imágenes cargan desde `…supabase.co/storage/v1/object/public/portfolio-media/…`.
6. **Proyectos:** la lista muestra año | nombre + resumen | sello; los destacados van primero; el detalle muestra estado, años, rol, tecnologías, botones de enlaces (solo https).
7. **Actualizar al instante:** cambia una palabra de una nota, "Preview & update" → Publish. El OS dice "The site was told to refresh." y al recargar el sitio ya aparece (sin esperar).
8. **Despublicar:** Unpublish una página → recarga el sitio: 404 y desaparece del menú.
9. **Dirección cambiada:** cambia el slug de un proyecto y publica; la dirección vieja redirige a la nueva (308).
10. **SEO:** ver código fuente de una página: `<title>`, `<meta description>`, `<link rel=canonical>`, `hreflang` en/es/x-default, Open Graph y JSON-LD (Person) en la portada. `/sitemap.xml` lista las páginas de los dos idiomas. Con `ROBOTS_NOINDEX=1`: `/robots.txt` dice `Disallow: /` y las páginas llevan `noindex`.
11. **Seguridad:** `curl -I` a una página muestra `Content-Security-Policy`, `X-Frame-Options: DENY`, `Strict-Transport-Security`. Una petición POST a `/api/revalidate` sin firma responde 401.
12. **Privacidad:** el sitio no muestra nada que no publicaste; en el navegador (pestaña Network) no hay llamadas a tu OS ni a tablas privadas.
13. **Accesibilidad rápida:** con Tab aparece "Skip to content/Saltar al contenido" primero; el foco se ve (amarillo); con "reducir movimiento" activado en el sistema el punto no pulsa.
