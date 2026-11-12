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
import android.widget.TextView;

/** The alarm screen: shows over the lock screen with the block name, its time and note. */
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

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setBackgroundColor(Color.parseColor("#12141C"));
        root.setPadding(dp(24), dp(72), dp(24), dp(40));

        TextView when = new TextView(this);
        when.setText(item == null ? "" : item.timeRange());
        when.setTextColor(Color.parseColor("#9AA3B8"));
        when.setTextSize(22);
        when.setGravity(Gravity.CENTER);
        root.addView(when);

        TextView title = new TextView(this);
        title.setText(item == null || item.title.isEmpty() ? "Alarm" : item.title);
        title.setTextColor(Color.WHITE);
        title.setTextSize(40);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setGravity(Gravity.CENTER);
        title.setPadding(0, dp(16), 0, dp(16));
        root.addView(title);

        TextView note = new TextView(this);
        note.setText(item == null ? "" : item.note);
        note.setTextColor(Color.parseColor("#D5DAE8"));
        note.setTextSize(18);
        note.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams noteLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f);
        root.addView(note, noteLp);

        Button snooze = new Button(this);
        snooze.setText("Snooze 10 min");
        snooze.setTextSize(20);
        snooze.setOnClickListener((View v) -> {
            Intent i = new Intent(this, AlarmService.class).setAction(AlarmService.ACTION_SNOOZE);
            if (item != null) item.putInto(i);
            startService(i);
        });
        root.addView(snooze, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(64)));

        Button dismiss = new Button(this);
        dismiss.setText("Dismiss");
        dismiss.setTextSize(20);
        dismiss.setOnClickListener((View v) -> {
            startService(new Intent(this, AlarmService.class).setAction(AlarmService.ACTION_STOP));
        });
        LinearLayout.LayoutParams dismissLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(64));
        dismissLp.topMargin = dp(12);
        root.addView(dismiss, dismissLp);

        setContentView(root);
    }
}
