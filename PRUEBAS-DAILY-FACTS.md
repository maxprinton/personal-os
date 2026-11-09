# Daily facts: how to test (Telegram + app)

Before anything: run `MIGRACION-0049-daily-facts-inputs.sql` in Supabase > SQL Editor (0048 is already applied). Then publish with SUBIR-CAMBIOS.cmd and wait for Vercel.

## Telegram
1. Send `/checkin`: you should see today's score, blocks/habits/tasks, spent, and a mood row (1-5, 6-10), an energy row and two buttons (Going to bed now / Woke up now).
2. Tap a mood number: the same message updates and shows "Mood N". Tap an energy number: same.
3. Send `mood 8` (the old way): then `/checkin` shows Mood 8. Same value, two ways.
4. `/bed 23:30` (evening) or `/bed` (now). `/woke 7:15` or `/woke`. `/woke 23:00` in the morning must say the time is in the future.
5. `/highlight shipped the insights page`. `/review` shows this week vs last.
6. At 21:00 (if evening reminders are on) the check-in arrives by itself.

## App
1. Open Insights (left menu, Life group).
2. Check-in form: pick a day, mood and energy 1-10, times like 23:30 / 07:15, a highlight. Save.
3. Go to Telegram and `/checkin`: the same values appear. Change mood in Telegram, reload Insights: it changed there too.
4. Also check Habits > Metrics: Mood and Energy show the same number.
5. Consistency map, This week, Time by block, Money and Notes, Patterns progress bar render without errors.

## Expected until you log more
Runway shows "needs spending logged on 5 of the last 14 days". Patterns show "N of 28 logged days".
