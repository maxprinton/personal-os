package app.personalos.alarms;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextClock;
import android.widget.TextView;
import android.widget.Toast;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * The alarm screen, over the lock screen. Top to bottom: the clock (the one big thing), the block and where
 * this ring is, a checklist you can tick, then the answers: one main button, two quieter choices, and a
 * plain "Silence" line. A wake ring with a check-in turns into the morning check-in, and keeps ringing until saved.
 */
public class AlarmActivity extends Activity {
    static volatile AlarmActivity instance;

    /** Check-in answers kept across a re-draw (0 = not picked yet). */
    private int pickSleep;
    private int pickMood;
    private int pickEnergy;
    private EditText highlightField;
    private String checkinDate = "";
    private boolean showingCheckin;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        instance = this;
        setShowWhenLocked(true);
        setTurnScreenOn(true);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        render();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // While the check-in is open, a new intent must not wipe what was picked
        if (showingCheckin && AlarmService.checkinItem != null) return;
        setIntent(intent);
        render();
    }

    @Override
    protected void onDestroy() {
        if (instance == this) instance = null;
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        // The check-in can only be left by saving it (the alarm keeps ringing until then)
        if (showingCheckin && AlarmService.checkinItem != null) {
            Toast.makeText(this, "Save the check-in to stop the alarm.", Toast.LENGTH_SHORT).show();
            return;
        }
        super.onBackPressed();
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private void render() {
        getWindow().setStatusBarColor(Ui.BG);
        getWindow().setNavigationBarColor(Ui.BG);
        Intent in = getIntent();
        AlarmItem open = AlarmService.checkinItem;
        if (open != null) {
            renderCheckin(open.date, true);
        } else if (in != null && in.getBooleanExtra("checkinOnly", false)) {
            renderCheckin(in.getStringExtra("checkinDate"), false);
        } else {
            renderAlarm(AlarmItem.from(in));
        }
    }

    // ---- The alarm ------------------------------------------------------------------------------------

    private void renderAlarm(final AlarmItem item) {
        showingCheckin = false;
        LinearLayout root = column();
        root.setPadding(dp(20), dp(40), dp(20), dp(20));

        String kicker = item == null ? "Alarm"
                : item.isEnd() ? "Time to wrap up"
                : item.wake ? "Good morning"
                : item.bed ? "Wind down"
                : "Time to start";
        TextView k = Ui.text(this, kicker, 15, Ui.ACCENT, true);
        k.setGravity(Gravity.CENTER);
        root.addView(k, full());

        TextClock clock = new TextClock(this);
        clock.setTextColor(Ui.TEXT);
        clock.setTextSize(76);
        clock.setTypeface(Typeface.create("sans-serif-light", Typeface.NORMAL));
        clock.setGravity(Gravity.CENTER);
        clock.setIncludeFontPadding(false);
        root.addView(clock, full());

        TextView title = Ui.text(this, item == null || item.title.isEmpty() ? "Alarm" : item.title, 26, Ui.TEXT, true);
        title.setGravity(Gravity.CENTER);
        title.setPadding(0, dp(6), 0, 0);
        root.addView(title, full());

        String sub = subtitle(item);
        if (!sub.isEmpty()) {
            TextView s = Ui.text(this, sub, 15, Ui.MUTED, false);
            s.setGravity(Gravity.CENTER);
            s.setPadding(0, dp(4), 0, 0);
            root.addView(s, full());
        }

        // The checklist: habits and tasks, tickable; scrolls when long
        LinearLayout card = Ui.card(this, null);
        fillChecklist(card, item);
        ScrollView scroll = new ScrollView(this);
        scroll.setVerticalScrollBarEnabled(false);
        scroll.addView(card);
        LinearLayout.LayoutParams listLp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f);
        listLp.topMargin = dp(20);
        listLp.bottomMargin = dp(16);
        root.addView(scroll, listLp);

        addAnswers(root, item);
        setContentView(root);
    }

    /** "06:00 to 07:00, starts in 5 min, ring 2 of 4". */
    private String subtitle(AlarmItem item) {
        if (item == null) return "";
        StringBuilder sb = new StringBuilder();
        if (!item.start.isEmpty()) sb.append(item.start).append(item.end.isEmpty() ? "" : " to " + item.end);
        String when = item.whenLabel(System.currentTimeMillis());
        if (!when.isEmpty()) sb.append(sb.length() > 0 ? ", " : "").append(sb.length() > 0 ? lower(when) : when);
        String ring = item.ringLabel();
        if (!ring.isEmpty()) sb.append(sb.length() > 0 ? ", " : "").append(sb.length() > 0 ? lower(ring) : ring);
        return sb.toString();
    }

    private static String lower(String s) {
        return s.isEmpty() ? s : Character.toLowerCase(s.charAt(0)) + s.substring(1);
    }

    private void fillChecklist(LinearLayout card, final AlarmItem item) {
        List<AlarmItem.Tick> ticks = item == null ? null : item.ticks();
        if (ticks != null && !ticks.isEmpty()) {
            boolean habitsHeading = false;
            boolean tasksHeading = false;
            for (final AlarmItem.Tick t : ticks) {
                if (t.isHabit && !habitsHeading) {
                    card.addView(heading("Habits", card.getChildCount() == 0));
                    habitsHeading = true;
                }
                if (!t.isHabit && !tasksHeading) {
                    card.addView(heading("Tasks", card.getChildCount() == 0));
                    tasksHeading = true;
                }
                card.addView(tickRow(item, t));
            }
            return;
        }
        // An older Personal OS sends only names: show them, without ticking
        String details = item == null ? "" : item.details();
        String msg = !details.isEmpty() ? details
                : item != null && item.id.equals("test") && !item.note.isEmpty() ? item.note
                : "Nothing to tick in this block.";
        card.addView(Ui.text(this, msg, 16, Ui.MUTED, false));
    }

    private TextView heading(String text, boolean first) {
        TextView h = Ui.text(this, text, 13, Ui.MUTED, true);
        h.setPadding(0, first ? 0 : dp(14), 0, dp(4));
        return h;
    }

    /** One habit or task: a round box and its name. Tapping ticks it at once and tells Personal OS. */
    private View tickRow(final AlarmItem item, final AlarmItem.Tick t) {
        final String key = item.occurrenceId + ":" + t.id;
        final LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setMinimumHeight(dp(48));
        row.setPadding(0, dp(4), 0, dp(4));
        final TextView box = new TextView(this);
        box.setGravity(Gravity.CENTER);
        box.setTextColor(Ui.BG);
        box.setTextSize(15);
        box.setTypeface(Typeface.DEFAULT_BOLD);
        LinearLayout.LayoutParams boxLp = new LinearLayout.LayoutParams(dp(28), dp(28));
        boxLp.rightMargin = dp(14);
        row.addView(box, boxLp);
        final TextView name = Ui.text(this, t.name, 18, Ui.TEXT, false);
        row.addView(name, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        styleTick(box, name, Prefs.ticked(this, key));
        row.setOnClickListener(v -> {
            boolean now = !Prefs.ticked(this, key);
            Prefs.setTicked(this, key, now);
            styleTick(box, name, now);
            Answers.tick(this, item, t, now);
        });
        row.setContentDescription((t.isHabit ? "Habit " : "Task ") + t.name);
        return row;
    }

    private void styleTick(TextView box, TextView name, boolean on) {
        GradientDrawable g = new GradientDrawable();
        g.setShape(GradientDrawable.OVAL);
        if (on) {
            g.setColor(Ui.OK);
        } else {
            g.setColor(0x00000000);
            g.setStroke(dp(2), Ui.MUTED);
        }
        box.setBackground(g);
        box.setText(on ? "✓" : "");
        name.setTextColor(on ? Ui.MUTED : Ui.TEXT);
        name.setPaintFlags(on ? name.getPaintFlags() | android.graphics.Paint.STRIKE_THRU_TEXT_FLAG
                : name.getPaintFlags() & ~android.graphics.Paint.STRIKE_THRU_TEXT_FLAG);
    }

    /** One main answer, two quieter ones, and a plain silence/snooze line. */
    private void addAnswers(LinearLayout root, final AlarmItem item) {
        if (item == null) {
            root.addView(bigButton("Dismiss", v -> sendAnswer(null, Answers.DISMISS, false)), fullHeight(64));
            return;
        }
        boolean needsCheckin = item.checkin && !Prefs.checkinDone(this, item.date);
        String main = AlarmService.ackLabel(item);
        if (needsCheckin) {
            // "I'm up" opens the check-in; the rooster goes on until it is saved
            root.addView(bigButton(main, v -> {
                Intent i = new Intent(this, AlarmService.class).setAction(AlarmService.ACTION_CHECKIN_START);
                item.putInto(i);
                startService(i);
                AlarmService.checkinItem = item;
                renderCheckin(item.date, true);
            }), fullHeight(64));
            TextView hint = Ui.text(this, "Then fill in your morning check-in to stop the alarm.", 14, Ui.MUTED, false);
            hint.setGravity(Gravity.CENTER);
            hint.setPadding(0, dp(8), 0, 0);
            root.addView(hint, full());
        } else {
            root.addView(bigButton(main, v -> sendAnswer(item, AlarmService.defaultAnswer(item), false)), fullHeight(64));
            if (!item.occurrenceId.isEmpty()) {
                if (item.isEnd()) {
                    root.addView(pair("Partial", v -> sendAnswer(item, Answers.PARTIAL, false),
                            "Didn't do it", v -> sendAnswer(item, Answers.NOT_DONE, false)), rowParams());
                } else if (item.bed) {
                    root.addView(pair("Going to sleep now", v -> sendAnswer(item, Answers.STARTED, true),
                            "Skip tonight", v -> sendAnswer(item, Answers.SKIP, false)), rowParams());
                } else {
                    root.addView(pair("Skip today", v -> sendAnswer(item, Answers.SKIP, false),
                            "Already done", v -> sendAnswer(item, Answers.ALREADY_DONE, false)), rowParams());
                }
            }
        }
        String quiet = AlarmService.secondLabel(item);
        if (quiet != null) {
            TextView q = Ui.text(this, quiet, 16, Ui.MUTED, true);
            q.setGravity(Gravity.CENTER);
            q.setMinHeight(dp(48));
            q.setPadding(0, dp(12), 0, 0);
            q.setOnClickListener(v -> {
                Intent i = new Intent(this, AlarmService.class).setAction(AlarmService.ACTION_SNOOZE);
                item.putInto(i);
                startService(i);
            });
            root.addView(q, full());
        }
    }

    private void sendAnswer(AlarmItem item, String answer, boolean sleptNow) {
        Intent i = new Intent(this, AlarmService.class).setAction(AlarmService.ACTION_ACK).putExtra("answer", answer);
        if (sleptNow) i.putExtra("sleptNow", true);
        if (item != null) item.putInto(i);
        startService(i);
    }

    // ---- The morning check-in --------------------------------------------------------------------------

    private void renderCheckin(String date, final boolean ringing) {
        showingCheckin = true;
        checkinDate = date == null || date.isEmpty() ? new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date()) : date;
        String keptHighlight = highlightField == null ? "" : highlightField.getText().toString();

        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Ui.BG);
        scroll.setFillViewport(true);
        LinearLayout root = column();
        root.setPadding(dp(20), dp(36), dp(20), dp(24));
        scroll.addView(root);

        root.addView(Ui.text(this, "Good morning", 30, Ui.TEXT, true));
        root.addView(Ui.text(this, ringing ? "Save your check-in to stop the alarm." : "Your morning check-in is waiting.", 15,
                ringing ? Ui.WARN : Ui.MUTED, false));
        String sleep = sleepLine();
        if (!sleep.isEmpty()) {
            TextView s = Ui.text(this, sleep, 15, Ui.MUTED, false);
            s.setPadding(0, dp(4), 0, 0);
            root.addView(s);
        }

        LinearLayout card = Ui.card(this, null);
        addScale(card, "How did you sleep?", "1 = badly, 5 = great", 5, pickSleep, n -> pickSleep = n);
        addScale(card, "Mood", "1 = low, 10 = great", 10, pickMood, n -> pickMood = n);
        addScale(card, "Energy", "1 = drained, 10 = full", 10, pickEnergy, n -> pickEnergy = n);
        TextView hl = Ui.text(this, "Yesterday's highlight", 16, Ui.TEXT, true);
        hl.setPadding(0, dp(18), 0, dp(2));
        card.addView(hl);
        card.addView(Ui.text(this, "Optional. The best or most important thing that happened.", 13, Ui.MUTED, false));
        highlightField = Ui.field(this, "Finished the alarm app", false);
        highlightField.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        highlightField.setText(keptHighlight);
        card.addView(highlightField, Ui.wrap(this, 8));
        root.addView(card, Ui.wrap(this, 20));

        final Button save = Ui.button(this, "Save check-in", true, v -> saveCheckin(ringing));
        save.setTextSize(19);
        root.addView(save, withTop(fullHeight(64), 20));
        setContentView(scroll);
    }

    interface Pick {
        void set(int n);
    }

    /** A question with a row (or two rows of 5) of number buttons. */
    private void addScale(LinearLayout card, String question, String hint, int max, int picked, final Pick onPick) {
        TextView q = Ui.text(this, question, 16, Ui.TEXT, true);
        q.setPadding(0, card.getChildCount() == 0 ? 0 : dp(18), 0, dp(2));
        card.addView(q);
        card.addView(Ui.text(this, hint, 13, Ui.MUTED, false));
        final LinearLayout group = column();
        LinearLayout row = null;
        final TextView[] chips = new TextView[max + 1];
        for (int n = 1; n <= max; n++) {
            if ((n - 1) % 5 == 0) {
                row = new LinearLayout(this);
                row.setOrientation(LinearLayout.HORIZONTAL);
                LinearLayout.LayoutParams rp = full();
                rp.topMargin = dp(8);
                group.addView(row, rp);
            }
            final int value = n;
            TextView chip = Ui.text(this, String.valueOf(n), 18, Ui.TEXT, true);
            chip.setGravity(Gravity.CENTER);
            chip.setContentDescription(question + " " + n);
            LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(0, dp(48), 1f);
            if ((n - 1) % 5 != 0) cp.leftMargin = dp(8);
            row.addView(chip, cp);
            chips[n] = chip;
            chip.setOnClickListener(v -> {
                onPick.set(value);
                for (int i = 1; i <= max; i++) styleChip(chips[i], i == value);
            });
            styleChip(chip, n == picked);
        }
        card.addView(group, full());
    }

    private void styleChip(TextView chip, boolean on) {
        chip.setBackground(on ? Ui.round(this, Ui.ACCENT, 12) : Ui.round(this, Ui.CARD_HI, 12));
        chip.setTextColor(on ? 0xFFFFFFFF : Ui.TEXT);
    }

    /** "Bedtime 22:40, up at 05:52: 7 h 12 min of sleep", from this phone's own taps. */
    private String sleepLine() {
        long slept = Prefs.sleptAt(this);
        long woke = Prefs.wokeAt(this);
        long now = System.currentTimeMillis();
        SimpleDateFormat hm = new SimpleDateFormat("HH:mm", Locale.getDefault());
        boolean hasBed = slept > 0 && now - slept < 18 * 3600_000L;
        boolean hasWake = woke > 0 && now - woke < 6 * 3600_000L;
        if (hasBed && hasWake && woke > slept) {
            long min = (woke - slept) / 60000;
            return "Bedtime " + hm.format(new Date(slept)) + ", up at " + hm.format(new Date(woke)) + ": "
                    + (min / 60) + " h " + (min % 60) + " min of sleep";
        }
        if (hasWake) return "Up at " + hm.format(new Date(woke)) + ". Bedtime fills in when you tap \"Going to sleep\" at night.";
        return "";
    }

    private void saveCheckin(boolean ringing) {
        if (pickSleep == 0 || pickMood == 0 || pickEnergy == 0) {
            Toast.makeText(this, "Pick sleep, mood and energy first.", Toast.LENGTH_SHORT).show();
            return;
        }
        String highlight = highlightField == null ? "" : highlightField.getText().toString();
        Answers.checkin(this, checkinDate, pickMood, pickEnergy, pickSleep, highlight);
        Prefs.setCheckinDone(this, checkinDate);
        showingCheckin = false;
        startService(new Intent(this, AlarmService.class).setAction(AlarmService.ACTION_CHECKIN_DONE));
        Toast.makeText(this, "Check-in saved. Have a good day.", Toast.LENGTH_SHORT).show();
        if (!ringing) finish();
    }

    // ---- Small layout helpers ----------------------------------------------------------------------------

    private LinearLayout column() {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setBackgroundColor(Ui.BG);
        return l;
    }

    private LinearLayout.LayoutParams full() {
        return new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
    }

    private LinearLayout.LayoutParams fullHeight(int heightDp) {
        return new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(heightDp));
    }

    private LinearLayout.LayoutParams withTop(LinearLayout.LayoutParams p, int topDp) {
        p.topMargin = dp(topDp);
        return p;
    }

    private LinearLayout.LayoutParams rowParams() {
        LinearLayout.LayoutParams p = full();
        p.topMargin = dp(10);
        return p;
    }

    private Button bigButton(String label, View.OnClickListener l) {
        Button b = Ui.button(this, label, true, l);
        b.setTextSize(20);
        return b;
    }

    /** Two equal, quieter buttons side by side. */
    private LinearLayout pair(String left, View.OnClickListener onLeft, String right, View.OnClickListener onRight) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        Button a = Ui.button(this, left, false, onLeft);
        Button b = Ui.button(this, right, false, onRight);
        LinearLayout.LayoutParams ap = new LinearLayout.LayoutParams(0, dp(54), 1f);
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(0, dp(54), 1f);
        bp.leftMargin = dp(10);
        row.addView(a, ap);
        row.addView(b, bp);
        return row;
    }
}
