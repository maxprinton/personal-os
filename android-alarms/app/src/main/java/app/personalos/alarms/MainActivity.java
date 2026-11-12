package app.personalos.alarms;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationManager;
import android.content.ComponentName;
import android.content.Intent;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.text.InputType;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/** Setup screen: address + key, sync, a test alarm, the next alarms, and the permission checklist. */
public class MainActivity extends Activity {
    private EditText urlField;
    private EditText keyField;
    private TextView statusView;
    private TextView listView;
    private TextView checksView;
    private TextView updateView;
    private Button updateButton;
    private Updater.Info latest;
    private boolean updateStarted;
    private final Handler ui = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        ScrollView scroll = new ScrollView(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(16), dp(20), dp(16), dp(32));
        scroll.addView(root);

        root.addView(label("Personal OS Alarms", 24, true));
        root.addView(label("Rings real alarms for the blocks you marked with a phone alarm in Personal OS.", 14, false));

        root.addView(label("Address of your Personal OS", 14, true));
        urlField = new EditText(this);
        urlField.setHint("https://your-app.vercel.app");
        urlField.setSingleLine(true);
        urlField.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        urlField.setText(Prefs.baseUrl(this));
        root.addView(urlField);

        root.addView(label("Key (Settings > Phone alarms)", 14, true));
        keyField = new EditText(this);
        keyField.setHint("pos_...");
        keyField.setSingleLine(true);
        keyField.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        keyField.setText(Prefs.key(this));
        root.addView(keyField);

        root.addView(button("Save and sync now", v -> saveAndSync()));
        root.addView(button("Test alarm in 15 seconds", v -> testAlarm()));

        statusView = label("", 14, false);
        root.addView(statusView);

        updateView = label("", 14, false);
        root.addView(updateView);
        updateButton = button("Install the update", v -> startUpdate(true));
        updateButton.setVisibility(View.GONE);
        root.addView(updateButton);

        root.addView(label("Next alarms", 18, true));
        listView = label("", 14, false);
        root.addView(listView);

        root.addView(label("Make sure it rings", 18, true));
        root.addView(label("Xiaomi phones stop apps in the background unless you allow all of these. "
                + "Tap each button and allow it, then press Test alarm with the screen locked.", 14, false));
        checksView = label("", 14, false);
        root.addView(checksView);
        root.addView(button("1. Allow notifications", v -> askNotifications()));
        root.addView(button("2. Allow full-screen alarms", v -> openFullScreenSettings()));
        root.addView(button("3. No battery limits for this app", v -> openBatterySettings()));
        root.addView(button("4. Autostart (Xiaomi)", v -> openAutostart()));
        root.addView(button("5. Other permissions: pop-ups and lock screen", v -> openAppSettings()));
        root.addView(button("6. Allow installing updates", v -> openInstallSettings()));

        setContentView(scroll);

        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        Scheduler.armNextSync(this);
        final boolean fromNotification = getIntent() != null && getIntent().getBooleanExtra("install_update", false);
        if (fromNotification) getIntent().removeExtra("install_update");
        // Opening the app is also a re-read, so the list is fresh when you look at it.
        // It also looks for a newer version of the app in your Personal OS.
        if (Prefs.configured(this)) {
            final android.content.Context app = getApplicationContext();
            new Thread(() -> {
                Sync.run(app);
                final Updater.Info info = Updater.fetchLatest(app);
                ui.post(() -> {
                    latest = info;
                    refresh();
                    if (info != null && info.versionCode > Updater.installedCode(app) && (fromNotification || canInstall())) {
                        startUpdate(false);
                    }
                });
            }).start();
        }
        refresh();
    }

    /** Downloads the newer version from Personal OS and hands it to Android to install (you confirm once). */
    private void startUpdate(boolean tapped) {
        final Updater.Info info = latest;
        if (info == null || info.versionCode <= Updater.installedCode(this) || updateStarted) return;
        if (!canInstall()) {
            if (tapped) openInstallSettings();
            return;
        }
        updateStarted = true;
        updateView.setText("Downloading version " + info.versionName + "...");
        final android.content.Context app = getApplicationContext();
        new Thread(() -> {
            try {
                File apk = Updater.download(app, info);
                ui.post(() -> updateView.setText("Installing version " + info.versionName + ": confirm when Android asks."));
                Updater.install(app, apk);
            } catch (Exception e) {
                final String why = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
                ui.post(() -> {
                    updateStarted = false;
                    updateView.setText("Update failed: " + why);
                });
            }
        }).start();
    }

    private boolean canInstall() {
        return getPackageManager().canRequestPackageInstalls();
    }

    private void openInstallSettings() {
        startActivitySafely(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getPackageName())));
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private TextView label(String text, int sp, boolean bold) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextSize(sp);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setPadding(0, dp(10), 0, dp(4));
        return t;
    }

    private Button button(String text, View.OnClickListener l) {
        Button b = new Button(this);
        b.setText(text);
        b.setAllCaps(false);
        b.setOnClickListener(l);
        return b;
    }

    private void saveAndSync() {
        Prefs.setConnection(this, urlField.getText().toString(), keyField.getText().toString());
        urlField.setText(Prefs.baseUrl(this));
        Scheduler.armNextSync(this);
        statusView.setText("Syncing...");
        final android.content.Context app = getApplicationContext();
        new Thread(() -> {
            Sync.run(app);
            ui.post(this::refresh);
        }).start();
    }

    private void testAlarm() {
        long when = System.currentTimeMillis() + 15_000L;
        Scheduler.schedule(this, new AlarmItem("test", "Test alarm", "", "", "",
                "If you can see and hear this, your alarms work.", when, when, 0));
        Toast.makeText(this, "Lock the screen. It rings in 15 seconds.", Toast.LENGTH_LONG).show();
    }

    private void refresh() {
        SimpleDateFormat when = new SimpleDateFormat("EEE d MMM HH:mm", Locale.getDefault());

        StringBuilder s = new StringBuilder();
        if (!Prefs.configured(this)) {
            s.append("Not connected yet: paste the address and the key, then Save.");
        } else if (Prefs.lastSyncMs(this) == 0L) {
            s.append("Not synced yet.");
        } else {
            s.append(Prefs.lastSyncOk(this) ? "Last sync OK: " : "Last sync FAILED: ");
            s.append(when.format(new Date(Prefs.lastSyncMs(this)))).append("\n").append(Prefs.lastSyncMessage(this));
            if (!Prefs.lastSyncOk(this) && Prefs.lastOkSyncMs(this) > 0L) {
                s.append("\nLast good sync: ").append(when.format(new Date(Prefs.lastOkSyncMs(this))));
            }
        }
        if (Prefs.nextSyncMs(this) > 0L) {
            s.append("\nNext automatic sync: ").append(when.format(new Date(Prefs.nextSyncMs(this))))
                    .append("  (every night at 11 pm, 12 am, 3 am and 4 am)");
        }
        statusView.setText(s.toString());

        boolean newer = latest != null && latest.versionCode > Updater.installedCode(this);
        updateButton.setVisibility(newer ? View.VISIBLE : View.GONE);
        if (newer) updateButton.setText("Install version " + latest.versionName);
        if (!updateStarted) {
            updateView.setText("App version " + Updater.installedName(this)
                    + (newer ? ". A new version is ready: " + latest.versionName + "."
                    : latest != null ? " (up to date)" : ""));
        }

        List<AlarmItem> upcoming = new ArrayList<>();
        long now = System.currentTimeMillis();
        for (AlarmItem a : Prefs.alarms(this)) {
            if (a.alarmAtMs > now) upcoming.add(a);
        }
        Collections.sort(upcoming, new Comparator<AlarmItem>() {
            @Override
            public int compare(AlarmItem x, AlarmItem y) {
                return Long.compare(x.alarmAtMs, y.alarmAtMs);
            }
        });
        StringBuilder l = new StringBuilder();
        if (upcoming.isEmpty()) {
            l.append("None. Mark a block with \"Ring an alarm on my phone\" in Personal OS.");
        }
        for (int i = 0; i < upcoming.size() && i < 12; i++) {
            AlarmItem a = upcoming.get(i);
            l.append(when.format(new Date(a.alarmAtMs))).append("   ").append(a.title);
            if (a.minutesBefore > 0) l.append("  (").append(a.minutesBefore).append(" min before)");
            l.append("\n");
        }
        listView.setText(l.toString().trim());

        checksView.setText(
                mark(areNotificationsOn()) + " Notifications\n"
                        + mark(canFullScreen()) + " Full-screen alarms\n"
                        + mark(ignoresBattery()) + " No battery limits\n"
                        + mark(canInstall()) + " Installing updates\n"
                        + "(Autostart and pop-ups cannot be checked by the app: allow them in steps 4 and 5.)");
    }

    private String mark(boolean ok) {
        return ok ? "[OK]" : "[ ]";
    }

    private boolean areNotificationsOn() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        return nm != null && nm.areNotificationsEnabled();
    }

    private boolean canFullScreen() {
        if (Build.VERSION.SDK_INT >= 34) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            return nm != null && nm.canUseFullScreenIntent();
        }
        return true;
    }

    private boolean ignoresBattery() {
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(getPackageName());
    }

    private void askNotifications() {
        if (Build.VERSION.SDK_INT >= 33) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        }
        if (!areNotificationsOn()) {
            Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
            startActivitySafely(i);
        }
    }

    private void openFullScreenSettings() {
        if (Build.VERSION.SDK_INT >= 34) {
            startActivitySafely(new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
                    Uri.parse("package:" + getPackageName())));
        } else {
            Toast.makeText(this, "Not needed on this Android version.", Toast.LENGTH_SHORT).show();
        }
    }

    private void openBatterySettings() {
        Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                Uri.parse("package:" + getPackageName()));
        if (!startActivitySafely(i)) {
            startActivitySafely(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
        }
    }

    private void openAutostart() {
        Intent i = new Intent();
        i.setComponent(new ComponentName("com.miui.securitycenter",
                "com.miui.permcenter.autostart.AutoStartManagementActivity"));
        if (!startActivitySafely(i)) {
            Toast.makeText(this, "Open Security > Permissions > Autostart and turn this app on.", Toast.LENGTH_LONG).show();
            openAppSettings();
        }
    }

    private void openAppSettings() {
        startActivitySafely(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + getPackageName())));
    }

    private boolean startActivitySafely(Intent i) {
        try {
            startActivity(i);
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
