# Publicar el sitio del portafolio (lo haces tú, ~15 minutos)

El sitio vive en la carpeta `portfolio/` del mismo repositorio, pero es **otro proyecto de Vercel**: no comparte contraseñas ni
datos privados con el OS. Solo lee las páginas que tú publicaste (tablas públicas) y no tiene login.

> Mientras no hagas el último paso ("Salir a producción"), el sitio dice a Google que **no lo indexe** (`ROBOTS_NOINDEX=1`).

## 1. Sube los cambios
Doble clic a `SUBIR-CAMBIOS.cmd` (el mensaje de commit está en `commit-msg.txt`; si prefieres el de esta fase, copia el contenido de
`commit-msg-portfolio-3.txt` ahí antes). Espera "Listo".
El OS ahora tiene un `vercel.json` que evita redeploys del OS cuando solo cambió `portfolio/`, y el sitio uno que evita redeploys cuando no cambió.

## 2. Crea el proyecto en Vercel
1. vercel.com → **Add New → Project** → importa el repo `maxprinton/personal-os`.
2. **Project Name:** `personal-os-portfolio`.
3. **Root Directory:** `portfolio` (botón Edit). Framework: Next.js (se detecta solo).
4. Antes de pulsar Deploy, abre **Environment Variables** y añade (Production y Preview):

| Nombre | Valor |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | el mismo que usa el OS |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | la misma clave *anon/publishable* del OS (la pública, **nunca** la secreta) |
| `SITE_URL` | la dirección final, p. ej. `https://personal-os-portfolio.vercel.app` (sin `/` al final) |
| `PORTFOLIO_REVALIDATE_SECRET` | una cadena larga al azar (30+ caracteres). Guárdala: la usarás otra vez en el paso 3 |
| `ROBOTS_NOINDEX` | `1` |

5. **Deploy.** Si falla el build, pásame el error (puedo leer los logs de Vercel) y lo arreglo.

## 3. Conecta el OS con el sitio (para que publicar refresque al instante)
En el proyecto de Vercel **del OS** → Settings → Environment Variables añade:

| Nombre | Valor |
|---|---|
| `PORTFOLIO_SITE_URL` | la misma dirección del sitio (sin `/` al final) |
| `PORTFOLIO_REVALIDATE_SECRET` | **exactamente el mismo** valor del paso 2 |

Redeploy del OS (Deployments → ⋯ → Redeploy). Sin esto todo funciona igual, pero los cambios tardan hasta 1 hora en verse.

## 4. Primera prueba (privada)
1. En el OS publica la página **Home** (idioma EN y ES) y **About** (Portfolio → Pages → la tarjeta → Preview & publish).
2. Abre la dirección del sitio: debe llevarte a `/en` o `/es` según el idioma del navegador y mostrar el cuaderno sobre el pizarrón verde.
3. Repite `PRUEBAS-PORTFOLIO-3.md` (lista de comprobaciones).

## 5. Salir a producción (solo cuando pases la "prueba de lanzamiento" de PRUEBAS-PORTFOLIO-3.md)
1. En el proyecto del sitio cambia `ROBOTS_NOINDEX` a vacío (o bórrala) y haz Redeploy.
2. Envía `https://TU-SITIO/sitemap.xml` a Google Search Console (opcional).
3. Antes de lanzar, en Supabase: ejecuta `revoke execute on function public.entity_exists(...) from anon;` (te lo preparo si me lo pides: es un aviso de seguridad del OS que ya existía) y activa *Leaked password protection* en Auth → Providers → Email.

## Si algo no sale
- **El sitio sale vacío / sin páginas:** revisa que `NEXT_PUBLIC_SUPABASE_*` estén en Production y que publicaste al menos una página (estado "Published").
- **Publico y no cambia al instante:** falta `PORTFOLIO_*` en el OS o el secreto no coincide (el OS lo dice: "The site will pick it up within a few minutes").
- **401 en los logs de `/api/revalidate`:** secretos distintos, o el reloj del servidor se desfasó más de 5 min (poco probable).
