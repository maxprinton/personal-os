# Calendar v2 — progress log

Branch: `calendar-v2` (local only — nothing pushed, nothing deployed, no migration applied).
Spec: https://claude.ai/artifact/9BCbBiQAShmaDiewJL9AKk
Rule for phases 1–9: code only, no tests or builds. Everything is tested in phase 10.

---

## Phase 1 — Base model (block_type, block_slot, block_occurrence)

- New migrations (written, NOT applied):
  - `0006_calendar_enums.sql` — adds the `block_type` entity type (for linking notes to a block). Must be run on its own, before 0007.
  - `0007_calendar_model.sql` — tables `block_types` (name is unique per user, color), `block_slots` (weekly slot: ISO weekday, start/end, valid_from/valid_to), `block_occurrences` (real appearance on a date: actual start/end, status scheduled/done/partial/free_day/cancelled, `origin_date` + unique `(slot_id, origin_date)`), RLS + updated_at triggers. Copies every live `time_blocks` row into the new model: same name (case-insensitive) = same block type, one slot per weekday of the old rule. Notes linked to an old block are also linked to its block type. `time_blocks` is left untouched as a backup.
- `src/lib/calendar/` (new): `types.ts`, `overlap.ts` (span math, overnight blocks, "no two blocks overlap" checks for slots and occurrences), `model.ts` (reads block types/slots, creates missing occurrences on demand for the dates being shown, reads occurrences).
- Read side switched to the new model: Today page agenda, Telegram reminders ("before" alerts and morning summary), link pickers ("Block · name"), export ZIP (new tables included).
- The old "event fulfills block" link is no longer shown (events become their own layer in phase 3).

## Phase 2 — Calendar panel, day/week views, weekly blocks

- **Persistent panel** (`components/calendar/CalendarDock.tsx`, added to the root layout): docked at the bottom of every module, collapsible/expandable (and "Taller"), remembers its state per browser. Hidden on login pages and on `/calendar`.
- **Full-screen calendar** at `/calendar` (new "Calendar" link in the menu).
- **Views**: day, week (default on a computer; day is the default on a phone) and month (overview; clicking a day opens it). Opens on the current day/week, scrolled to the current hour, red "now" line.
- **Create blocks**: click an empty time (or "+ Block"). Default = repeats every week on that weekday; options "Several days every week" and "Only this day" (with the hint that a one-day thing is usually an event). Typing an existing name reuses that block (color, later habits) and only adds a new slot; autocomplete + "Did you mean…" to avoid typo duplicates. New names get a color (editable).
- **Move / resize**: drag a block to another time or day, or drag its bottom edge. The app then asks the scope: **Only this day** (default) or **From today on** (closes the old slot and opens a new one; past days untouched). Clicking a block opens its details: change time, remove (same scope question), rename or recolor the block (applies everywhere).
- **No overlaps**: creating or moving a block is refused with a clear message if it would overlap another block (weekly slots and one-day changes, including blocks that cross midnight).
- **Blocks page** (`/blocks`) rewritten: list of blocks with their slots from today on, rename, color, remove (stops it from today on, past kept).
- Server: `app/calendar-actions.ts` (createBlock, editOccurrence, removeOccurrence, renameBlockType, setBlockTypeColor, removeBlockType), `app/api/calendar/route.ts` (JSON for a date range), `lib/calendar/edit.ts`, `lib/calendar/load.ts`.
- Retired: the old block form and the v1 `createBlock/deleteBlock` (they wrote to `time_blocks`).

## Phase 3 — Events as a ghost layer

- New migration `0008_events_layer.sql` (NOT applied): `event_types` (name unique per user, editable color); events get `event_date`/`end_date` (always set; existing events are backfilled in each user's timezone) and `event_type_id`; `start_time`/`end_time` become optional (both or none). A trigger fills the dates for anything that inserts events without them.
- Calendar: events are a separate layer drawn **on top of the blocks, translucent with a dashed border**, in their type's color. They can overlap blocks and each other (overlapping events sit side by side). Only their title strip is clickable, so the blocks underneath can still be dragged.
- **Events without time** = metadata of the day: shown as "bubbles" under the day header (click the empty space there to add one). Multi-day events ("Until" date) show on every day, e.g. a hotel stay.
- New event dialog (title, type with autocomplete — a new name creates the type with a color —, date, optional end date, optional time). "+ Event" in the toolbar; the new-block dialog's "Only this day" option offers "Create an event instead".
- `/events` page rewritten: upcoming events (60 days) + event types (rename, recolor, remove). Old "fulfills a block" link removed.
- Today page: events use their type color and dashed border; untimed events listed in the banner; the banner takes the **current block's color** (idea from the LifeOS prototype).
- Telegram morning summary lists the day's untimed events (📌). `.ics` import: all-day events now come in as events without time (with their real end date).
- A block with an event on top keeps its habits and tasks (nothing special happens to it).
- Ideas taken from the LifeOS v3.1 prototype: **live red "taken" preview while dragging** (no overlaps), **Alt + drag = duplicate** (opens the new-block dialog with the same name at the drop time), **auto-scroll** while dragging near the edges, **"Day starts at"** setting (e.g. 6:00, labels show "+1d" after midnight) and **hide days** in week view (⚙ in the calendar toolbar, remembered per browser).
