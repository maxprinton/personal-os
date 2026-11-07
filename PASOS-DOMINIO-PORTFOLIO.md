# Dominio propio para el portafolio (opcional)

Puedes quedarte con `personal-os-portfolio.vercel.app` para siempre. Si quieres un dominio propio (por ejemplo `maximilianoavila.com`), son estos pasos. Un dominio cuesta unos 10–15 USD al año.

## 1. Comprar o elegir el dominio
- Compra en Vercel (Dashboard → Domains → Buy) o en cualquier registrador (Namecheap, Cloudflare, etc.). Comprarlo en Vercel es lo más corto: ya queda enlazado.

## 2. Conectarlo al proyecto del SITIO
1. Vercel → proyecto `personal-os-portfolio` → **Settings → Domains → Add**.
2. Escribe el dominio (`maximilianoavila.com`). Vercel te dice qué registros DNS poner (normalmente un registro **A** `76.76.21.21` para el dominio raíz y un **CNAME** `cname.vercel-dns.com` para `www`). Si compraste en Vercel, ya está.
3. Marca uno como principal y deja el otro con redirección a ese (por ejemplo `www` → raíz).
4. Espera unos minutos hasta ver la marca verde.

## 3. Actualizar las variables que mencionan la dirección
| Dónde | Variable | Nuevo valor |
|---|---|---|
| Proyecto del SITIO | `SITE_URL` | `https://maximilianoavila.com` (sin `/` al final) |
| Proyecto del OS | `PORTFOLIO_SITE_URL` | `https://maximilianoavila.com` |

Después: **Redeploy** de los dos proyectos (las variables nuevas solo se leen en un despliegue nuevo).

## 4. Turnstile
Cloudflare → Turnstile → tu widget → **Hostnames** → agrega el dominio nuevo. Sin esto el formulario de contacto falla en el dominio nuevo.

## 5. Revisar
- `https://tu-dominio/` te lleva a `/en` o `/es`.
- Ver código fuente de una página: `canonical`, `hreflang` y las imágenes de Open Graph apuntan al dominio nuevo.
- `https://tu-dominio/sitemap.xml` muestra las direcciones nuevas.
- Prueba el formulario de contacto y publica un cambio desde el OS (debe actualizarse al instante).

## 6. Salir a producción (quitar el "no indexar")
Mientras `ROBOTS_NOINDEX=1` está puesta, Google no ve el sitio. Cuando termines `PRUEBAS-PORTFOLIO-FINAL.md`: borra esa variable en el proyecto del sitio, Redeploy, y abre `/robots.txt` (debe decir `Allow: /` y mostrar el sitemap). Luego, si quieres, registra el sitio en Google Search Console y envía `/sitemap.xml`.
