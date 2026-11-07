# Rediseño de UI — progreso (25 oct 2026)

Plan: https://claude.ai/artifact/NdccGVPrbDZbe9jsZk5Eyf

## Hecho
- Paleta "Índigo sereno" como tokens en `src/app/globals.css` (claro y oscuro, contraste WCAG AA verificado).
- Modo oscuro: Auto / Light / Dark (barra lateral, menú More en el teléfono y Settings → Appearance).
- Marco nuevo (`src/components/shell/AppShell.tsx`): barra lateral agrupada en escritorio (colapsable), 5 tabs abajo en el teléfono.
- Calendario como panel derecho (`CalendarPanel.tsx`); en pantallas medianas flota sobre la página. Reemplaza el cajón inferior (`CalendarDock.tsx` ya no se usa).
- Today: tarjeta "Right now" con progreso del bloque, dos columnas cuando hay espacio, agenda en línea de tiempo, resumen de finanzas con barra de presupuesto.
- Finance: tarjetas de resumen, dos columnas, barras de presupuesto verde/ámbar/rojo, gasto por categoría con barras.
- Tareas: casilla redonda, contador "moved" ámbar (rojo desde 4), "overdue" en rojo.
- Login con tarjeta y marca; selector de archivos con estilo; foco visible con teclado en todo.
- Atajos (escritorio): `[` barra lateral, `\` calendario, `g` + letra: h Today, c Capture, k Calendar, t Tasks, b Blocks, e Events, a Habits, n Notes, f Finance, s Settings.
- PWA: colores nuevos y caché v2 (los teléfonos cargan el diseño nuevo).

## Pendiente (no hecho en esta pasada)
- Notas en dos paneles (lista + editor en la misma pantalla).
- Settings en pestañas.

## Lista de prueba (tú, al final)
1. Doble clic en PROBAR-BUILD.cmd → probar-build-log.txt debe terminar con "build exit: 0".
2. Doble clic en SUBIR-CAMBIOS.cmd (mensaje en commit-msg.txt).
3. Computadora: navegar con la barra lateral; colapsarla; abrir/cerrar el panel de calendario; cambiar a Dark y Auto.
4. Today: la tarjeta "Right now" muestra el bloque actual; marcar una tarea y un hábito.
5. Calendario en el panel: crear/mover un bloque funciona igual que antes.
6. Teléfono: tabs abajo, "More" abre el resto; el calendario sigue siendo solo lectura.
7. Si algo falla: Vercel → Deployments → el despliegue anterior → Promote.

---

# Rediseño "Blocks" (C) — 7 nov 2026

Reemplaza la paleta "Índigo sereno". Referencia: el canvas con C claro y oscuro. Respaldo: `backups/antes-rediseno-c-2026-11-07.tgz`.

## Hecho
- Tokens nuevos en `globals.css` (claro #FBFCFE, oscuro #12141C; azul, coral, magenta, verde, ámbar), sin sombras, esquinas redondas grandes.
- Tipografías: Bricolage Grotesque (títulos) + Figtree (texto) con `next/font/google`.
- Barra superior (`shell/TopBar.tsx`) en lugar de la barra lateral: Today, Calendar, Tasks, Notes, Finance, Habits, More (resto de secciones, tema, cerrar sesión), búsqueda, Capture.
- Calendario: ya no es un panel fijo; se abre desde la barra superior o con `\` como panel lateral.
- Today: título "Saturday / November 7", tarjeta "Right now" con color del bloque, agenda con bandas de color de cada bloque.
- Finance: tarjetas de cuentas, barra de gasto por categoría, títulos de sección nuevos.
- Settings en pestañas: Appearance, Telegram, AI, Writing, Data (`/settings?tab=...`).
- Notas en dos paneles: en una nota abierta aparece la lista de notas a la izquierda (`notes/[id]/layout.tsx`, solo pantallas grandes).
- Etiquetas en MAYÚSCULAS y espaciadas pasan a minúsculas normales (regla global); el texto de miniaturas de YouTube sigue en mayúsculas.
- PWA: caché `personal-os-v5`, colores nuevos.

## No hecho / aproximado
- Today no agrupa tareas por bloque como el mock, ni tiene la tira "This week" (el calendario se abre aparte).
- Páginas secundarias (Tasks, Habits, Blocks, Events, YouTube, Capture, Login) heredan colores, fuentes y bordes, pero no se rediseñaron una por una.
- Los colores por defecto de bloques nuevos siguen siendo el índigo anterior (#6366f1).

## Lista de prueba
1. PROBAR-BUILD.cmd → "build exit: 0" (necesita internet por las fuentes). Luego SUBIR-CAMBIOS.cmd.
2. Barra superior: cada sección, el menú More, búsqueda, Capture. Teléfono: tabs abajo.
3. Calendario: botón de la barra superior y tecla `\`; Esc lo cierra; crear/mover un bloque funciona igual.
4. Today en claro y oscuro: tarjeta "Right now", marcar una tarea y un hábito.
5. Finance: barra de gasto y las tarjetas de cuentas.
6. Settings: las 5 pestañas guardan igual que antes.
7. Abrir una nota: lista a la izquierda, el editor sigue guardando.
8. Si algo falla: Vercel → Deployments → despliegue anterior → Promote, o restaurar el .tgz.
