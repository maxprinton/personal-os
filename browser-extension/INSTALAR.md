# Coursera Clipper (extensión de Chrome) — instalación y uso

Guarda la lección de Coursera que tienes abierta como **dos notas separadas** (la lectura y la transcripción del video).
Cada nota lleva automáticamente tu **plantilla** (etiquetas + Type / Status / Area / Source…) y una **palabra clave**
que se vuelve etiqueta: esa etiqueta es lo único que une la lectura con su video.

## Antes (una sola vez, en la app)
1. Correr `MIGRACION-0070-clip-key.sql` en Supabase (SQL Editor).
2. SUBIR-CAMBIOS.cmd (commit-msg-coursera-clipper.txt) y esperar el deploy.
3. App → Settings → pestaña de alarmas → tarjeta **Coursera clipper** → **Create my key**. Copiar la dirección y la clave (la clave se muestra una sola vez).

## Instalar la extensión
1. Chrome → `chrome://extensions` → activar **Modo de desarrollador**.
2. **Cargar descomprimida** → elegir la carpeta `personal-os/browser-extension/coursera-clipper`.
3. Se abre **Options** (si no: clic derecho en el icono → Opciones):
   - Pegar dirección y clave → **Save connection** (Chrome pide permiso para esa dirección: aceptar).
   - Plantilla de la **lectura** y de la **transcripción**: título, etiquetas, y las propiedades de TU base de notas (las opciones salen de tus listas). "Save the lesson link in Source" guarda el enlace de Coursera.
   - **Save templates**.

## Usar
- Abre una lección → botón **Save to Personal OS** (abajo a la derecha) o **Alt+Shift+S**.
- En una página de **lectura** guarda la lectura; en una de **video** abre la pestaña Transcript sola y guarda la transcripción.
- Escribe la **palabra clave** (la sugiere a partir del título anterior) → Enter. Ambas notas quedan con esa etiqueta.
- Si ya existe una nota con ese título, ofrece **Replace**.
- Las imágenes se descargan a tu Storage al guardar (no caducan).

## Pruebas
- App: `npm run test:clip` (7) · Extensión: `node browser-extension/coursera-clipper/test-md.cjs` (9) · tsc 0 errores.
- NO probado contra Coursera real: los selectores de la lectura y de la transcripción están escritos con alternativas, pero
  hay que verificarlos en una lección real. Si el panel dice "Nothing to save here", avísame qué página era.
