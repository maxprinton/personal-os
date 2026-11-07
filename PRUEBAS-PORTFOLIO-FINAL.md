# Prueba final del portafolio (puerta antes de salir a producción)

Haz esto una vez, con todo desplegado y con las variables de `PASOS-PUBLICAR-PORTFOLIO.md` y `PASOS-PORTFOLIO-6.md` puestas.

## 0. Antes de empezar
- En tu computadora: `npm run test:portfolio-all` debe terminar sin ❌ (son las 10 suites: 583 comprobaciones).
- Ejecuta `SUBIR-CAMBIOS.cmd` y espera a que Vercel termine los dos proyectos (OS y sitio) en verde.
- Tema de seguridad pendiente en Supabase (2 minutos, ver al final).

## 1. Contenido mínimo
Publica desde el OS, en EN y ES cuando puedas: Home, About, Now, Uses, 2 proyectos (uno destacado), 1 artículo, y agrega 1 video en Portfolio → Videos. Al crear cada nota desde "New note" debe traer un texto inicial.

## 2. Recorrido por el sitio (en tu teléfono Y en la computadora)
Sigue en orden las pruebas manuales de `PRUEBAS-PORTFOLIO-3.md` (puntos 1–13) y luego:
1. **Escritos** (`/en/writing`): artículo con fecha, minutos de lectura e índice; la fecha no cambia al republicar. RSS en `/en/rss.xml` (solo resúmenes).
2. **Herramientas / Uses**: la página aparece en el menú solo si está publicada.
3. **Búsqueda**: caja en la barra lateral; una palabra de un proyecto y de un artículo muestra ambos con fragmento; comillas y `%` no rompen nada.
4. **Videos**: nada de YouTube carga hasta pulsar play (pestaña Red); último video en Inicio; video adjunto en un proyecto.
5. **Contacto**: mensaje normal llega a **Portfolio → Inbox** y a Telegram; mensaje de spam queda en la pestaña Spam sin avisar; 4 mensajes seguidos activan el límite. Ver `PRUEBAS-PORTFOLIO-6.md`.
6. **Compartir**: pega la dirección de un proyecto en WhatsApp o Telegram: sale tarjeta con el título y la imagen generada (o la portada si la página tiene una). Si no sale, prueba `https://tu-sitio/en/og/project/<slug>`: debe mostrar la imagen.
7. **404**: abre `/es/no-existe` y `/en/no-existe`: página con el menú, en el idioma correcto, y el enlace "Volver al inicio".
8. **Analítica**: en el proyecto del sitio, Vercel → **Analytics → Enable**. Visita varias páginas, espera unos minutos y mira que aparezcan las visitas. Para apagarla: Portfolio → Settings → desactivar Analytics y publicar cualquier cambio (o esperar una hora).

## 3. Accesibilidad (10 minutos)
- Solo con teclado: Tab llega primero a "Saltar al contenido"; todo se puede usar; el foco siempre se ve.
- Zoom del navegador al 200 %: nada se corta ni hay scroll horizontal.
- Sistema con "reducir movimiento": el punto verde no pulsa.
- (Opcional) Una extensión como axe DevTools sobre Inicio, un proyecto y Contacto: sin errores graves. Los contrastes de color ya están verificados por prueba automática (AA).

## 4. Rendimiento (Lighthouse en el teléfono, objetivo ≥ 90)
1. Chrome → abre el sitio en una ventana de incógnito → F12 → pestaña **Lighthouse** → modo **Mobile** → marca las 4 categorías → Analyze. Hazlo en Inicio, un proyecto y un artículo.
2. Si algo baja de 90, pega aquí el informe y lo arreglo. Cosas que ya están hechas: páginas estáticas con caché de una hora, fuentes autoalojadas con `display: swap`, imágenes con carga diferida, YouTube solo al pulsar play. Pendiente conocido: la hoja de estilos de ecuaciones (KaTeX) se carga en todas las páginas.

## 5. Seguridad antes de abrir al público
1. `curl -I https://tu-sitio/en` muestra `Content-Security-Policy`, `X-Frame-Options: DENY` y `Strict-Transport-Security`.
2. En Supabase (SQL Editor) revoca el acceso anónimo a la función interna `entity_exists`. No la usa ninguna pantalla pública; solo la usan triggers internos con tu sesión:
   `revoke execute on function public.entity_exists(entity_type, uuid, uuid) from anon, public;`
   Si ves un error de "function does not exist" avísame para ajustar la firma (hay dos versiones en las migraciones 0001 y 0007).
3. Supabase → Authentication → Providers/Policies → activa **Leaked password protection**.
4. Abre `https://tu-sitio/api/revalidate` con GET (debe dar 405) y haz POST sin firma (debe dar 401).

## 6. Lanzar
Cuando todo lo anterior esté bien: quita `ROBOTS_NOINDEX` del proyecto del sitio, Redeploy, y revisa `/robots.txt`. Cambia la frase de presentación (tagline) en Portfolio → Settings si quieres otra distinta a la de prueba.
