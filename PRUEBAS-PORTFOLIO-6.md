# Pruebas — Portfolio, Fase 6 (Contacto)

## Automáticas (ya pasan)
- `npm run test:portfolio-contact` (65): validación, puntuación de spam, firma y ventana de 5 minutos, límites por hora y por día, duplicados, Telegram que falla no rompe nada, bandeja (leer, resuelto, spam, borrar, responder).
- `npm run test:portfolio-sitecontact` (21): lado del sitio (trampa, origen, Turnstile, reenvío firmado, errores) y de punta a punta con el OS.
- `test:site` (30), `test:security` (50, incluye que solo la página de contacto permite Turnstile).

## A mano (después de los pasos de PASOS-PORTFOLIO-6.md)
1. Abre `/en/contact`: aparece el formulario con la casilla de Turnstile.
2. Envía un mensaje normal. Debe decir "Message sent". En el OS: **Portfolio → Inbox** muestra el mensaje con punto de "no leído" y el número en la pestaña; en Telegram llega el aviso.
3. **Reply by email** abre tu correo con la respuesta empezada. **Handled**, **Mark read**, **Delete** funcionan.
4. Prueba errores: correo inválido, mensaje de 3 letras (mensajes en el idioma de la página).
5. Prueba spam a propósito: envía "casino viagra click here http://a.co http://b.co". Debe parecer que se envió, pero aparece en la pestaña **Spam** y **no** llega a Telegram.
6. Límite: envía 4 mensajes distintos seguidos. El 4.º dice que ya enviaste varios y no se guarda.
7. En el teléfono: la página de contacto y la bandeja se leen sin zoom ni scroll horizontal.
