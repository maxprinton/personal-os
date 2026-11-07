# Pasos para activar el formulario de Contacto (Fase 6)

Hasta que hagas estos pasos, la página **Contacto** del sitio dice "El formulario de contacto no está disponible por ahora" y muestra tus enlaces. Nada se rompe.

## 1. Crear la verificación anti-bots (Cloudflare Turnstile, gratis)
1. Entra a https://dash.cloudflare.com (crea una cuenta gratis si no tienes) → **Turnstile** → **Add widget**.
2. Nombre: `portfolio`. En **Hostnames** agrega el dominio del sitio (por ejemplo `personal-os-portfolio.vercel.app`, y tu dominio propio cuando lo tengas). Modo: **Managed**.
3. Te da dos claves: **Site Key** (pública) y **Secret Key** (secreta).

## 2. Proyecto del SITIO en Vercel (`personal-os-portfolio`) → Settings → Environment Variables
Agrega (Production y Preview):

| Nombre | Valor |
|---|---|
| `TURNSTILE_SITE_KEY` | la Site Key |
| `TURNSTILE_SECRET_KEY` | la Secret Key |
| `PORTFOLIO_OS_URL` | la dirección de tu OS, sin `/` al final (ej. `https://tu-os.vercel.app`) |
| `PORTFOLIO_REVALIDATE_SECRET` | el mismo valor que ya pusiste (es el secreto compartido) |

## 3. Proyecto del OS en Vercel
Ya debe tener `PORTFOLIO_REVALIDATE_SECRET` (mismo valor) y `SUPABASE_SECRET_KEY`. No hay variables nuevas. El OS necesita estar desplegado con estos cambios.

## 4. Volver a desplegar el sitio
Vercel → proyecto del sitio → Deployments → ⋯ → **Redeploy** (las variables nuevas solo se leen en un despliegue nuevo).

## 5. Probar
Sigue `PRUEBAS-PORTFOLIO-6.md`. Si llega un mensaje de prueba y ves el aviso en Telegram, todo está listo.

## Cómo funciona (por si quieres saberlo)
- El visitante escribe → el sitio revisa los campos, el campo trampa y Turnstile → reenvía el mensaje **firmado** al OS.
- El OS vuelve a revisar, limita a 3 mensajes por hora por visitante y 100 al día en total, calcula una puntuación de spam y lo guarda en **Portfolio → Inbox** (el spam va a su pestaña).
- Si no es spam, te avisa por Telegram. Nunca se guarda la dirección IP, solo una huella irreversible.
- Si apagas "Contact" en Portfolio → Settings, la página desaparece del menú y da 404.
