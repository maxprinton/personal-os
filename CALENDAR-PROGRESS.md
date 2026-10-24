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
