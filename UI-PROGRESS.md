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
