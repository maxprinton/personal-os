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

## Phase 4 — Habits inside blocks + Telegram

- New migration `0009_habits_in_blocks.sql` (NOT applied): `habits` (belongs to a block type; no block = "Unscheduled" list), `habit_checks` (one mark per habit per block occurrence: done / skipped / missed — the same block twice in a day gives two separate marks), `user_settings.calendar_closed_through`. Copies every old "Track as habit" block into a habit of its block type, and its `activity_logs` history into occurrences + marks. `generate_insights()` rewritten to read the new tables.
- **Streak rules** (`lib/calendar/streaks.ts`): done +1; skip on purpose keeps the streak, max **3 in a row, the 4th breaks it** (same for all habits); missed breaks it; free days pause (no break, no gain, don't count as skips); today's unmarked ones are pending.
- **End-of-day routine** (`lib/calendar/maintenance.ts`): closes each finished day once — every habit not marked in a block that happened becomes "missed" (no questions), and each block gets its status: done / partial / scheduled (= planned but not done). Runs every 5 minutes from the existing cron (now for every user, Telegram or not) and as a safety net when the app opens; catches up to 14 days.
- **Past days show what was recorded**; changing a block's habits applies from today on and never rewrites history.
- Calendar: blocks show "2/3" habit progress and a quick **✓** (ticks all its habits / marks the block done; click again to undo — idea from the LifeOS prototype). Block details: mark each habit ✓/Skip, add a habit to the block, take one out, place an unscheduled habit. Progress bar of the visible week/day in the toolbar (done = 1, partly done = ½).
- `/habits` rewritten: habits grouped by block, streak / best / last-30 rate / skips left, last 14 marks, today's marks per appearance, new habit form, rename / move to another block / stop tracking. Daily metrics unchanged.
- Today page: "Habits today" lists each habit inside each of today's blocks with ✓ / Skip.
- **Telegram**: the evening check-in now asks **per habit inside its block** ("Gym 7:00 AM · Stretch") with ✓ / Skip buttons; skipping tells you how many skips in a row are left. Buttons only work for today (earlier days are fixed on the computer). Buttons from old messages answer politely.

## Phase 5 — Tasks with a home block, morning ritual, move counter

- New migration `0010_tasks_home_block.sql` (NOT applied): tasks get `home_block_type_id`, `occurrence_id` (the block appearance it's in) and `event_id` (an event with tasks acts like a block for them); new `task_day_log` (a day a task ended undone: skipped / moved — it keeps showing there); `user_settings.ritual_seen_on` and `reminder_unassigned_nag`. Tasks linked to an old time block get its block type as home block. The old hourly database rollover no longer moves "move to tomorrow" tasks (nothing moves silently); backlog / graveyard policies still work.
- **Moved counter** = the existing `rolled_over_count` column: +1 each time a day ends with the task undone, +1 per manual move to another day; automatic placement in the home block never counts. Shown next to the task everywhere ("moved 3×").
- **End of day** (same routine as habits): undone tasks are logged as skipped on their day (still visible there, struck through), get +1, and wait for the next morning. Tasks in events go through the same check. Block statuses count their tasks too.
- **Morning**: tasks go by themselves into their home block if it exists that day. **Morning ritual** card on Today lists yesterday's undone tasks: placed ✓ / "Move to next <block> (date)" / "Pick another block today"; tasks without a home block wait in **Unassigned**. "Done for today" hides the card.
- **One linked task**: a task in a block that appears several times in a day shows in all of them; done in one = done in all; if not finished it's still pending in the next one.
- Calendar: tasks listed inside blocks (draggable to another block), "Unassigned" tray above the grid — drag a task onto a block or onto an event's title to place it. Block and event dialogs have a Tasks section (tick, take out, add here, place an unassigned one).
- Tasks page / Today: task form has **Home block** and "Or in an event"; rows show home, where it is placed, "unassigned", and the counter. "Do today" on a planned future task counts as a move.
- **Telegram**: morning summary shows how many tasks still have no block and has ✓ buttons to complete tasks; **keeps insisting at 11:00 and 16:00** while some task has no block (toggle in Settings → Telegram reminders); "before block" alerts list the tasks placed in it with ✓ buttons; the evening check-in adds ✓ buttons for open tasks. Telegram can only mark habits and complete tasks (plus the existing quick capture).

## Phase 6 — Free days

- New migration `0011_free_days.sql` (NOT applied): `free_days` (from, to, task policy, note) and `tasks.hold_placement`.
- **🌴 Free day** button in the calendar toolbar: pick one day or a range (+ optional note, e.g. "Trip to Cuenca") and what happens to the tasks of those days: **move to the day after**, **leave unassigned** (they wait in the Unassigned tray the day after and are not auto-placed), or **take them to their home block** (next date after the break where it exists). Moving tasks because of a free day never counts as a move.
- Blocks in the range turn "free day" (dimmed). The end-of-day routine skips them: **no missed habits, streaks paused, skips not counted**; tasks put on a free day just wait for the next day without +1. Events (flights, hotel) stay visible. A 🌴 label under the day header opens the range, which can be removed (today's and future blocks come back; the past stays).
- Telegram: the morning summary says it's a free day, and the "unassigned tasks" reminder stays quiet.

## Phase 7 — Payments as events

- New migration `0012_payments.sql` (NOT applied): `payment_templates` (name, income/expense, expected amount, account, category, repeats: once or every N days/weeks/months/years from a first date, optional end); events get `is_payment`, `payment_template_id`, `payment_status` (paid/skipped), `payment_transaction_id`; transactions get `event_id` and `payment_template_id`.
- **Same record from Finance or from the calendar**: "Scheduled payments" on the Finance page and "It's a payment" in the calendar's new-event dialog use the same form and the same action (a template + its events, in a green "Payments" event type).
- **Recurring payments create their own events** about 2 months ahead (every morning, and right after creating one). Months clamp to the last day (a payment on the 31st falls on the 30th/28th). Repeat model inspired by the LifeOS prototype ("every N units").
- **On the day**: a pre-filled draft (expected amount, account, category) shows on Today, in Finance and in the event's dialog: write the real amount and **Confirm** → a real transaction is created and the event shows ✓💳. "Not this time" skips it. Deleting that transaction puts the payment back to "due". Unconfirmed payments stay due for up to a month.
- Telegram morning summary lists payments to confirm (confirming happens in the app).
- "Stop" a scheduled payment: no new events; upcoming unpaid ones are removed; paid ones stay.
