# Pruebas a mano · Portafolio Fase 8 (extras)

Antes: sube los cambios (`git push` o `SUBIR-CAMBIOS.cmd`) y espera a que Vercel termine el deploy del OS. La migración **0043** (casilla del aviso semanal) ya está aplicada en Supabase.

## 1. ✨ Traducir al otro idioma
1. Portfolio → Pages → abre una página que tenga nota en **un solo** idioma (por ejemplo, About en inglés).
2. En la tarjeta de ese idioma aparece **✨ Translate to Español**. (No aparece si el otro idioma ya tiene nota.)
3. Púlsalo. Espera (hasta ~1 min si la página es larga). Se abre una vista previa con el título y el texto traducidos. **Todavía no se guardó nada.**
4. Revisa que los bloques de código, enlaces, imágenes y las cajas (callouts, columnas) siguen igual, y que solo cambió el texto.
5. **Discard** → se cierra y no pasa nada. Repite y pulsa **Accept** → aparece una nota nueva en el otro idioma, ya enlazada, en estado **Draft**.
6. Ábrela, corrígela, y publícala como cualquier otra página.
7. Abre `/usage` en Telegram: debe salir "Portfolio translation" en el uso de IA de hoy.
8. Prueba de límites: una página de más de 15 000 caracteres debe decir que es muy larga y que la traduzcas por partes.

## 2. Telegram: /portfolio y /inbox
1. En el bot escribe `/portfolio`: una línea por página con su estado (✅ publicada, 🟠 cambió, 📝 borrador). Si hay mensajes sin leer, sale el conteo.
2. Cambia una página ya publicada (escribe algo en su nota) → `/portfolio` debe mostrarla como 🟠.
3. `/inbox`: los últimos mensajes del formulario (🔵 sin leer). Verifica que **no** los marca como leídos (en Portfolio → Inbox siguen sin leer).
4. `/help` ahora menciona los dos comandos.

## 3. Aviso semanal (lunes 10:00, tu zona horaria)
- Si el lunes a las 10:00 hay páginas 🟠, llega un resumen. Si no hay nada que revisar, no llega nada. Sale como máximo una vez por semana.
- Para apagarlo: Portfolio → Settings → quita la casilla **Weekly Telegram reminder…** → Save.
- Para probarlo sin esperar al lunes: no hace falta; está cubierto por las pruebas automáticas (día, hora, una vez por semana, apagado).

## 4. Galería
1. En la nota de un proyecto, pon **3 o más imágenes seguidas**, sin texto entre ellas (una debajo de la otra).
2. **Preview & publish**: en la vista previa se ven como una cuadrícula.
3. Publica y abre el proyecto en el sitio: cuadrícula que se adapta al ancho (en el teléfono, 1–2 columnas).
4. Con solo 2 imágenes, o con una frase entre ellas, no se agrupan (se ven una debajo de otra como antes).
5. Las páginas ya publicadas no cambian hasta que las vuelvas a publicar.

## 5. El formulario de contacto del sitio
Ya dejé puestas en Vercel: `PORTFOLIO_OS_URL` (sitio) y `PORTFOLIO_SITE_URL` + `PORTFOLIO_REVALIDATE_SECRET` (OS). Falta **solo** lo que requiere tu cuenta de Cloudflare:
1. Cloudflare → Turnstile → Add widget → hostname `personal-os-t2la.vercel.app` → te da Site Key y Secret Key.
2. Vercel → proyecto `personal-os-t2la` → Settings → Environment Variables: `TURNSTILE_SITE_KEY` y `TURNSTILE_SECRET_KEY`.
3. Redeploy del proyecto del sitio.
4. Sigue `PRUEBAS-PORTFOLIO-6.md` (incluye la prueba de spam).
