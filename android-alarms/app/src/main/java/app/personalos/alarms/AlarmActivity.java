package app.personalos.alarms;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextClock;
import android.widget.TextView;

/** The alarm screen: shows over the lock screen with the clock, the block, its habits and tasks. */
public class AlarmActivity extends Activity {
    static volatile AlarmActivity instance;

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
        setIntent(intent);
        render();
    }

    @Override
    protected void onDestroy() {
        if (instance == this) instance = null;
        super.onDestroy();
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private void render() {
        final AlarmItem item = AlarmItem.from(getIntent());
        getWindow().setStatusBarColor(Ui.BG);
        getWindow().setNavigationBarColor(Ui.BG);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setBackgroundColor(Ui.BG);
        root.setPadding(dp(20), dp(48), dp(20), dp(28));

        TextView tag = Ui.text(this, "ALARM", 12, Ui.ACCENT, true);
        tag.setLetterSpacing(0.2f);
        root.addView(tag);

        // The current time, big
        TextClock clock = new TextClock(this);
        clock.setTextColor(Ui.TEXT);
        clock.setTextSize(72);
        clock.setTypeface(Typeface.create("sans-serif-light", Typeface.NORMAL));
        clock.setGravity(Gravity.CENTER);
        root.addView(clock);

        TextView title = Ui.text(this, item == null || item.title.isEmpty() ? "Alarm" : item.title, 30, Ui.TEXT, true);
        title.setGravity(Gravity.CENTER);
        title.setPadding(0, dp(4), 0, dp(6));
        root.addView(title);

        String range = item == null ? "" : item.timeRange();
        if (!range.isEmpty()) {
            TextView chip = Ui.text(this, range, 15, Ui.TEXT, true);
            chip.setBackground(Ui.round(this, Ui.CARD_HI, 20));
            chip.setPadding(dp(14), dp(6), dp(14), dp(6));
            root.addView(chip);
        }

        // Habits and tasks of the block; they scroll if the list is long
        LinearLayout card = Ui.card(this, null);
        if (item != null && !item.habits.isEmpty()) addSection(card, "Habits", item.habits);
        if (item != null && !item.tasks.isEmpty()) addSection(card, "Tasks", item.tasks);
        if (card.getChildCount() == 0) {
            String msg = item != null && item.id.equals("test") && !item.note.isEmpty()
                    ? item.note : "No habits or tasks in this block.";
            card.addView(Ui.text(this, msg, 16, Ui.MUTED, false));
        }
        ScrollView scroll = new ScrollView(this);
        scroll.setVerticalScrollBarEnabled(false);
        scroll.addView(card);
        LinearLayout.LayoutParams listLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f);
        listLp.topMargin = dp(18);
        listLp.bottomMargin = dp(18);
        root.addView(scroll, listLp);

        Button snooze = Ui.button(this, "Snooze 10 min", false, (View v) -> {
            Intent i = new Intent(this, AlarmService.class).setAction(AlarmService.ACTION_SNOOZE);
            if (item != null) item.putInto(i);
            startService(i);
        });
        snooze.setTextSize(18);
        root.addView(snooze, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(60)));

        Button dismiss = Ui.button(this, "Dismiss", true, (View v) ->
                startService(new Intent(this, AlarmService.class).setAction(AlarmService.ACTION_STOP)));
        dismiss.setTextSize(20);
        LinearLayout.LayoutParams dismissLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(68));
        dismissLp.topMargin = dp(10);
        root.addView(dismiss, dismissLp);

        setContentView(root);
    }

    /** "Habits" / "Tasks": a small heading and one line per item. */
    private void addSection(LinearLayout card, String heading, String lines) {
        TextView h = Ui.text(this, heading.toUpperCase(), 12, Ui.MUTED, true);
        h.setLetterSpacing(0.08f);
        h.setPadding(0, card.getChildCount() == 0 ? 0 : dp(14), 0, dp(6));
        card.addView(h);
        for (String line : lines.split("\n")) {
            if (line.trim().isEmpty()) continue;
            TextView row = Ui.text(this, "\u2022  " + line.trim(), 18, Ui.TEXT, false);
            row.setLineSpacing(0f, 1.15f);
            row.setPadding(0, dp(3), 0, dp(3));
            card.addView(row);
        }
    }
}
