# Portafolio público · notas de versión 1.0

Tu sitio público, bilingüe (EN/ES), alimentado por notas del OS. Esto es lo que quedó construido.

## Qué puedes hacer
- **Escribir páginas como notas** y vincularlas a un "slot" (Home, About, Now, Uses, proyectos, artículos) por idioma. Las notas nuevas traen un texto inicial según el tipo.
- **Vista previa y publicar**: ves avisos antes de publicar (errores bloquean, advertencias piden confirmar, info solo informa), copias de imágenes sin datos de cámara/GPS al bucket público, historial con restaurar, despublicar, y "Changed since published" cuando editas una nota ya publicada.
- **Sitio**: Inicio, Sobre mí, Proyectos (lista y detalle), Escritos (lista, artículo, RSS), Herramientas (Uses), Ahora, Videos, Contacto, Búsqueda. Diseño cuaderno de espiral sobre pizarrón verde, responsivo, 404 por idioma, tarjetas para compartir generadas por página, SEO completo (canonical, hreflang, sitemap, JSON-LD).
- **Videos**: eliges videos terminados, largos y públicos del add-on de YouTube; solo se copian título, descripción corta, fecha, miniatura y duración. Reproductor que carga solo al pulsar play.
- **Contacto**: formulario con Turnstile; mensajes firmados al OS, límite por visitante y por día, filtro de spam, bandeja en Portfolio → Inbox, aviso por Telegram.
- **Analítica** sin cookies (Vercel Web Analytics) con interruptor en Settings.

## Seguridad y privacidad (resumen)
El sitio público solo tiene la llave anónima y solo lee columnas permitidas de tres tablas. Nada de tus notas, tareas, finanzas ni del add-on de YouTube es legible desde fuera. Todo HTML se limpia al publicar y otra vez al mostrar. Las llamadas OS↔sitio van firmadas (HMAC, 5 minutos). Política de seguridad estricta; solo la página de contacto permite Cloudflare Turnstile. Nunca se guarda una IP, solo una huella irreversible.

## Límites conocidos
- El tema está fijo en "Classic" (sin modo claro/oscuro).
- La vista previa vive en el OS (no hay vista previa dentro del sitio público).
- Búsqueda por palabras exactas (sin acentos equivalentes ni errores de tipeo).
- Analítica de Vercel: visitas y páginas, sin embudos ni mapa de calor. El plan gratis tiene un tope mensual de eventos.
- La hoja de estilos de ecuaciones se carga en todas las páginas.
- Una repetición exacta de un mensaje firmado dentro de 5 minutos puede reenviarse; el filtro de duplicados lo marca como spam.
- No se probó un `next build` real en esta máquina (la compilación ocurre en Vercel). Revisa el primer despliegue; si falla, el log dice dónde.

## Opcional más adelante (Fase 8)
Botón ✨ para traducir al otro idioma con vista previa, comandos de Telegram `/portfolio` y `/inbox`, recordatorio semanal de páginas cambiadas sin republicar, galería de proyecto, archivo de "Ahora".

## Comandos
`npm run test:portfolio-all` corre todas las pruebas del portafolio. Guías: `PASOS-PUBLICAR-PORTFOLIO.md`, `PASOS-PORTFOLIO-6.md`, `PASOS-DOMINIO-PORTFOLIO.md`, `PRUEBAS-PORTFOLIO-FINAL.md`.
