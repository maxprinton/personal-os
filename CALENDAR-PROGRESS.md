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

## Phase 8 — Editing the past (1-hour window)

- New migration `0013_past_edit.sql` (NOT applied): `user_settings.past_edit_until`.
- The past is **locked by default**. Any calendar change that touches a past day (moving/resizing/removing a block, creating a one-day block, marking a habit or ticking a block, ticking a task of a past day, creating/editing/deleting a past event, marking past free days) is refused by the server with a "past locked" answer.
- The calendar then asks **"Edit the past?"**; confirming opens a **1-hour window** with no more questions and a discreet violet banner **"✎ Editing the past until 3:45 PM"** (with "Stop"). After the hour, the next change asks again.
- Changes to a past day **affect only that day** and never carry forward ("From today on" is not offered for past days; a new block on a past day can only be "Only this day"). Editing past habit marks recalculates that block's status.
- Marking past days as free afterwards removes their automatic "missed" marks, so those streaks pause instead of breaking.
- Telegram can't edit the past (its buttons only work for today).

## Phase 9 — Phone = read-only

- `src/lib/device.ts`: detects phones/tablets from the browser (User-Agent / `Sec-CH-UA-Mobile`).
- **Enforced on the server**: every calendar action (blocks, events, habits marks, task placement, free days, payments, edit-the-past) refuses requests from a phone with a clear message. Nothing can be dragged or moved there even by accident.
- **UI on the phone**: the calendar opens in **day view** (week available), no dragging (normal scrolling), no "+ Block / + Event / Free day" buttons, dialogs show details only, and a small "View only on the phone" line. Today, Habits, Blocks, Events and Finance → Scheduled payments show their information without edit buttons (morning ritual and payment drafts say "do it on the computer").
- On the go, **Telegram** remains the way to mark habits and complete tasks (buttons only).
- Not changed on the phone (decide in phase 10 if you want them read-only too): Quick capture (offline PWA capture), Tasks page buttons, Notes, Finance transactions/accounts/budgets forms, Settings.

---

## Steps only you can do (before / during phase 10)

**1. Back up first.** In the live app: Settings → Export (ZIP). Keep it.

**2. Apply the migrations in Supabase** (SQL Editor), **one file per run, in this order**, and check each says "Success":

| # | File | Notes |
|---|------|-------|
| 1 | `0006_calendar_enums.sql` | **Alone**, before 0007 (a new enum value can only be used after it's committed). |
| 2 | `0007_calendar_model.sql` | Creates block types/slots/occurrences and copies your current blocks. |
| 3 | `0008_events_layer.sql` | Event types, dates, optional time. |
| 4 | `0009_habits_in_blocks.sql` | Habits + marks, copies your habit history; rewrites weekly insights. |
| 5 | `0010_tasks_home_block.sql` | Home blocks, task day log; stops the old silent "move to tomorrow". |
| 6 | `0011_free_days.sql` | Free days. |
| 7 | `0012_payments.sql` | Payments as events. |
| 8 | `0013_past_edit.sql` | Edit-the-past window. |

If the app later says a column "is not in the schema cache", run `notify pgrst, 'reload schema';` once in the SQL Editor.
All files are written to be safe to run twice. `time_blocks` and `activity_logs` are kept untouched as a backup.

**3. Cron job — nothing new to create.** The existing pg_cron job (every 5 min → `/api/cron/reminders`) now also runs the end-of-day routine for every user. Check it's still active: `select jobid, schedule, active from cron.job;`. The hourly `task-rollover` job can stay (it now only handles "backlog" / "failed" tasks).

**4. Vercel — no new environment variables.** `SUPABASE_SECRET_KEY` must stay set (the cron routine needs it). Telegram webhook: no change.

**5. Settings in the app (after deploy):** Settings → Telegram reminders has a new option "Keep reminding me (11:00 and 16:00) while tasks have no block" (on by default) — review it and press Save once.

**6. Git / publishing.**
- Your project folder is now **on branch `calendar-v2`** (9 local commits, nothing pushed). `main` is untouched.
- **Do not run `SUBIR-CAMBIOS.cmd` until phase 10 is finished**: it builds, commits and pushes whatever branch is checked out.
- Running `npm run dev` on this branch before applying the migrations will show errors (the new tables don't exist yet).
- To go back to the current version at any time: `git checkout main`. When phase 10 passes: merge `calendar-v2` into `main`, then run `SUBIR-CAMBIOS.cmd`.
- `.git/stale-locks/` holds lock files git left behind (this session can't delete files in your folder, so I moved them aside). Safe to delete that folder.

**7. Decisions to confirm in phase 10.**
- Phone read-only currently covers the calendar and everything that edits it (blocks, events, habits, task placement, ritual, free days, payment drafts). Quick capture, the Tasks page buttons, Notes and the Finance forms still work on the phone — tell me if those should be read-only too.
- Telegram quick capture ("task: …", "spent 12 on lunch") still works, besides the habit/task buttons.

## Deployment — 2026-10-24
- Migrations 0006–0013 applied to Supabase (verified counts against the backup).
- main (5029956) pushed to GitHub via Git GUI; Vercel production deployment dpl_AcH1ewv7CAAQwZ1fBHPjVtB6seWP built and is READY.
- Smoke check on the live app: all pages and /api/calendar return 200, no function crashes, server durations < 1 s; cron/reminders runs cleanly.
- Not yet done: the phase 10 manual test list below (needs real use: creating blocks, habits, tasks, payments).

## Phase 10 — what to test (not done yet)

1. `npx tsc --noEmit` and `npm run build` (nothing was compiled during phases 1–9, so expect a few type fixes).
2. After the migrations: your old blocks appear as block types with weekly slots; old habit streaks look right on /habits.
3. Calendar: create weekly / several days / one day; reuse a name; overlap refused (and red while dragging); drag + "Only this day" vs "From today on"; resize; Alt+drag duplicate; rename/recolor; day starts at 6:00; hide weekend; month view.
4. Events: untimed bubbles, multi-day, timed ghosts over blocks, overlapping events side by side, types & colors, .ics import.
5. Habits: ✓/Skip per occurrence, block twice a day = two marks, 4th skip in a row breaks, missed at end of day, quick ✓ on a block, Telegram evening buttons.
6. Tasks: home block auto-placement, ritual options, moved counter (+1 end of day, +1 manual move, 0 auto), one linked task in several appearances, tasks in events, unassigned tray drag & drop, Telegram ✓ and 11:00/16:00 reminders.
7. Free days: three task policies, streak pause, dimmed blocks, events visible, removing a range.
8. Payments: from Finance and from the calendar, recurring events, draft → confirm → transaction, skip, delete transaction → due again, Telegram morning list.
9. Past: locked, confirm → 1-hour banner, day-only changes, expiry asks again.
10. Phone: day view, no dragging, no edit buttons, server refuses edits.
11. Then apply to the real database (with the ZIP backup), merge and publish.

## Ideas from the LifeOS v3.1 prototype — not built (proposals)

- **Named week layouts** ("Normal", "Travel", "Exams") you can switch, duplicate, rename — would sit next to free days.
- **Inventory / stash** of blocks kept off the calendar, to place again with one click.
- **Per-block AI instructions, prompt manager, smart exporter** (left out: no AI key by choice).
- Built from it already: live collision preview, Alt+drag duplicate, auto-scroll, day start hour, hide days, untimed events as bubbles, quick ✓ + week progress bar, banner in the current block's color, "every N units" repeats (payments), multi-select (below).

## Multi-select (added 2026-10-24, after the release)
- Ctrl/⌘/Shift+click a block to add or remove it from the selection (blue ring). Plain click still opens the block.
- Dragging a selected block moves the whole selection by the same days/minutes, with a live preview (red = would overlap).
- Selection bar: ✓ Mark done / Undo done, ← 1 day, 1 day →, Remove (asks first), Clear. Keys: Esc clears, Delete removes.
- Always "only those days" — weekly patterns are still changed one block at a time from the block dialog.
- Server actions: moveOccurrences, removeOccurrences, setOccurrencesDone (past lock and overlap rules apply; max 100 blocks).
- To test: select 3 blocks on different days → drag → they move together; try a move onto another block → refused; Delete → confirm → gone only that day.

## LifeOS group A (added 2026-10-24) — all in Calendar ⚙ unless noted
- "Click on a block: opens it / marks it done". In "marks it done" a ✏️ in the corner opens the block; future blocks say their day hasn't come.
- Grabbing a block that isn't selected drops the old selection (Ctrl/⌘/Shift keep it), as in LifeOS.
- Auto-scroll while dragging is proportional (faster near the edge) and keeps going while the pointer rests there.
- "After moving a block: ask every time / only that day (with Undo) / that day on, every week".
- "Progress: done so far / whole range".
- "Page color of the current block": soft tint of the whole app (components/calendar/NowTint.tsx in the layout).
- "Duplicate…" button in the block window (opens New block pre-filled).
- To test: switch each setting and check the behaviour; click a past/today block in "marks it done" mode → ticks; click again → undo.

## LifeOS group B (added 2026-10-24)
- Box selection: drag on empty space draws a box; the blocks it touches get selected (Shift/Ctrl add to the selection). A plain click on empty space with a selection only clears it.
- Alt+drag copies instantly ("only that day"), one block or a whole selection (server action duplicateOccurrences). The original stays; copies can't overlap anything.
- Stretching a selected block stretches all selected blocks by the same minutes (resizeOccurrences).
- Instant changes: moves, copies, stretches, ✓/undo, removes show at once (components/calendar/optimistic.ts) and are put back if the server refuses. Each change reloads once (no double reload); the full calendar page no longer refreshes the whole page after a change.
- Esc closes the block window even while typing in it.
- To test: box-select 3 blocks; Alt+drag them to another day; stretch one of them; try to stretch into another block → refused and put back.
