package app.personalos.alarms;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationManager;
import android.content.ComponentName;
import android.content.Intent;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
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

/** Home screen: connection, next alarms, sound, and the checklist that makes sure it rings. */
public class MainActivity extends Activity {
    private static final int REQ_PICK_SOUND = 21;

    private EditText urlField;
    private EditText keyField;
    private View statusDot;
    private TextView statusTitle;
    private TextView statusDetail;
    private LinearLayout alarmsBox;
    private LinearLayout soundBox;
    private LinearLayout checksBox;
    private TextView checksSummary;
    private LinearLayout updateCard;
    private TextView updateView;
    private Button updateButton;
    private TextView versionView;
    private Updater.Info latest;
    private boolean updateStarted;
    private MediaPlayer preview;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Runnable stopPreview = this::stopPreview;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Ui.BG);
        getWindow().setNavigationBarColor(Ui.BG);

        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Ui.BG);
        scroll.setVerticalScrollBarEnabled(false);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(16), dp(28), dp(16), dp(36));
        scroll.addView(root);

        // ---- Header
        root.addView(Ui.text(this, "Personal OS", 14, Ui.ACCENT, true));
        root.addView(Ui.text(this, "Alarms", 34, Ui.TEXT, true));

        LinearLayout statusCard = Ui.card(this, null);
        LinearLayout statusRow = new LinearLayout(this);
        statusRow.setOrientation(LinearLayout.HORIZONTAL);
        statusRow.setGravity(Gravity.CENTER_VERTICAL);
        statusDot = Ui.dot(this, Ui.MUTED);
        statusRow.addView(statusDot);
        statusTitle = Ui.text(this, "", 17, Ui.TEXT, true);
        statusRow.addView(statusTitle);
        statusCard.addView(statusRow);
        statusDetail = Ui.text(this, "", 13, Ui.MUTED, false);
        statusDetail.setPadding(0, dp(6), 0, 0);
        statusCard.addView(statusDetail);
        root.addView(statusCard, Ui.wrap(this, 14));

        // ---- Update (only visible when there is one)
        updateCard = Ui.card(this, "Update ready");
        updateView = Ui.text(this, "", 14, Ui.TEXT, false);
        updateCard.addView(updateView);
        updateButton = Ui.button(this, "Install the update", true, v -> startUpdate(true));
        updateCard.addView(updateButton, Ui.wrap(this, 10));
        updateCard.setVisibility(View.GONE);
        root.addView(updateCard, Ui.wrap(this, 12));

        // ---- Next alarms
        LinearLayout alarmsCard = Ui.card(this, "Next alarms");
        alarmsBox = new LinearLayout(this);
        alarmsBox.setOrientation(LinearLayout.VERTICAL);
        alarmsCard.addView(alarmsBox);
        root.addView(alarmsCard, Ui.wrap(this, 12));

        // ---- Sound
        LinearLayout soundCard = Ui.card(this, "Alarm sound");
        soundBox = new LinearLayout(this);
        soundBox.setOrientation(LinearLayout.VERTICAL);
        soundCard.addView(soundBox);
        root.addView(soundCard, Ui.wrap(this, 12));

        // ---- Connection
        LinearLayout conn = Ui.card(this, "Connection");
        conn.addView(Ui.text(this, "Address of your Personal OS", 13, Ui.MUTED, false));
        urlField = Ui.field(this, "https://your-app.vercel.app", false);
        urlField.setText(Prefs.baseUrl(this));
        conn.addView(urlField, Ui.wrap(this, 6));
        TextView keyLabel = Ui.text(this, "Key (Settings > Phone alarms)", 13, Ui.MUTED, false);
        keyLabel.setPadding(0, dp(12), 0, 0);
        conn.addView(keyLabel);
        keyField = Ui.field(this, "pos_...", true);
        keyField.setText(Prefs.key(this));
        conn.addView(keyField, Ui.wrap(this, 6));
        conn.addView(Ui.button(this, "Save and sync now", true, v -> saveAndSync()), Ui.wrap(this, 14));
        conn.addView(Ui.button(this, "Test alarm in 15 seconds", false, v -> testAlarm()), Ui.wrap(this, 8));
        root.addView(conn, Ui.wrap(this, 12));

        // ---- Checklist
        LinearLayout checks = Ui.card(this, "Make sure it rings");
        checksSummary = Ui.text(this, "", 14, Ui.MUTED, false);
        checksSummary.setPadding(0, 0, 0, dp(6));
        checks.addView(checksSummary);
        checksBox = new LinearLayout(this);
        checksBox.setOrientation(LinearLayout.VERTICAL);
        checks.addView(checksBox);
        root.addView(checks, Ui.wrap(this, 12));

        versionView = Ui.text(this, "", 12, Ui.MUTED, false);
        versionView.setGravity(Gravity.CENTER);
        versionView.setPadding(0, dp(18), 0, 0);
        root.addView(versionView);

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
    protected void onPause() {
        stopPreview();
        super.onPause();
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

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_PICK_SOUND || resultCode != RESULT_OK || data == null) return;
        Uri uri = data.getParcelableExtra(RingtoneManager.EXTRA_RINGTONE_PICKED_URI);
        if (uri == null) return; // "silent" is not allowed for an alarm: keep the current sound
        Prefs.setSound(this, "uri:" + uri);
        Prefs.setSoundName(this, Ringtones.titleOf(this, uri));
        playPreview();
        refresh();
    }

    // ---- Sound ------------------------------------------------------------------------------

    private void chooseBundled(Ringtones.Sound s) {
        Prefs.setSound(this, s.choice());
        playPreview();
        refresh();
    }

    private void choosePhoneDefault() {
        Prefs.setSound(this, "");
        playPreview();
        refresh();
    }

    private void pickFromPhone() {
        Intent i = new Intent(RingtoneManager.ACTION_RINGTONE_PICKER)
                .putExtra(RingtoneManager.EXTRA_RINGTONE_TYPE, RingtoneManager.TYPE_ALARM)
                .putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, false)
                .putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, true)
                .putExtra(RingtoneManager.EXTRA_RINGTONE_TITLE, "Alarm sound");
        String cur = Prefs.sound(this);
        if (cur.startsWith("uri:")) {
            i.putExtra(RingtoneManager.EXTRA_RINGTONE_EXISTING_URI, Uri.parse(cur.substring(4)));
        }
        try {
            startActivityForResult(i, REQ_PICK_SOUND);
        } catch (Exception e) {
            Toast.makeText(this, "This phone has no sound picker.", Toast.LENGTH_LONG).show();
        }
    }

    /** Plays the chosen sound for a few seconds, once. */
    private void playPreview() {
        stopPreview();
        try {
            preview = Ringtones.open(this, Prefs.sound(this));
            preview.setLooping(false);
            preview.setOnCompletionListener(mp -> stopPreview());
            preview.start();
            ui.postDelayed(stopPreview, 6000);
        } catch (Exception e) {
            preview = null;
            Toast.makeText(this, "Could not play that sound.", Toast.LENGTH_SHORT).show();
        }
    }

    private void stopPreview() {
        ui.removeCallbacks(stopPreview);
        if (preview != null) {
            try {
                preview.stop();
            } catch (Exception ignored) {
                // already stopped
            }
            preview.release();
            preview = null;
        }
    }

    // ---- Updates ----------------------------------------------------------------------------

    /** Downloads the newer version from Personal OS and hands it to Android to install (you confirm once). */
    private void startUpdate(boolean tapped) {
        final Updater.Info info = latest;
        if (info == null || info.versionCode <= Updater.installedCode(this) || updateStarted) return;
        if (!canInstall()) {
            if (tapped) openInstallSettings();
            return;
        }
        updateStarted = true;
        updateCard.setVisibility(View.VISIBLE);
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

    private void openOverlaySettings() {
        if (!startActivitySafely(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:" + getPackageName())))) {
            openAppSettings();
        }
    }

    private void openInstallSettings() {
        startActivitySafely(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getPackageName())));
    }

    private int dp(int v) {
        return Ui.dp(this, v);
    }

    private void saveAndSync() {
        Prefs.setConnection(this, urlField.getText().toString(), keyField.getText().toString());
        urlField.setText(Prefs.baseUrl(this));
        Scheduler.armNextSync(this);
        statusTitle.setText("Syncing...");
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

    // ---- Drawing ----------------------------------------------------------------------------

    private void refresh() {
        SimpleDateFormat when = new SimpleDateFormat("EEE d MMM HH:mm", Locale.getDefault());
        SimpleDateFormat hm = new SimpleDateFormat("HH:mm", Locale.getDefault());

        // Status
        StringBuilder d = new StringBuilder();
        if (!Prefs.configured(this)) {
            ((android.graphics.drawable.GradientDrawable) statusDot.getBackground()).setColor(Ui.WARN);
            statusTitle.setText("Not connected yet");
            d.append("Paste the address and the key below, then press Save and sync now.");
        } else if (Prefs.lastSyncMs(this) == 0L) {
            ((android.graphics.drawable.GradientDrawable) statusDot.getBackground()).setColor(Ui.MUTED);
            statusTitle.setText("Not synced yet");
        } else {
            boolean ok = Prefs.lastSyncOk(this);
            ((android.graphics.drawable.GradientDrawable) statusDot.getBackground()).setColor(ok ? Ui.OK : Ui.BAD);
            statusTitle.setText((ok ? "Synced " : "Sync failed ") + when.format(new Date(Prefs.lastSyncMs(this))));
            d.append(Prefs.lastSyncMessage(this));
            if (!ok && Prefs.lastOkSyncMs(this) > 0L) {
                d.append("\nLast good sync: ").append(when.format(new Date(Prefs.lastOkSyncMs(this))));
            }
        }
        if (Prefs.nextSyncMs(this) > 0L) {
            if (d.length() > 0) d.append("\n");
            d.append("Next automatic sync ").append(hm.format(new Date(Prefs.nextSyncMs(this))))
                    .append(" (every hour at :05 and :45)");
        }
        statusDetail.setText(d.toString());

        // Update
        boolean newer = latest != null && latest.versionCode > Updater.installedCode(this);
        if (newer || updateStarted) updateCard.setVisibility(View.VISIBLE);
        else updateCard.setVisibility(View.GONE);
        updateButton.setVisibility(newer && !updateStarted ? View.VISIBLE : View.GONE);
        if (newer) updateButton.setText("Install version " + latest.versionName);
        if (newer && !updateStarted) {
            updateView.setText("Version " + latest.versionName + " is ready. You have " + Updater.installedName(this) + ".");
        }
        versionView.setText("Personal OS Alarms " + Updater.installedName(this)
                + (latest != null && !newer ? " - up to date" : ""));

        // Next alarms
        alarmsBox.removeAllViews();
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
        if (upcoming.isEmpty()) {
            alarmsBox.addView(Ui.text(this, "None yet. Mark a block with \"Ring an alarm on my phone\" in Personal OS.",
                    14, Ui.MUTED, false));
        }
        SimpleDateFormat day = new SimpleDateFormat("EEE d MMM", Locale.getDefault());
        for (int i = 0; i < upcoming.size() && i < 8; i++) {
            AlarmItem a = upcoming.get(i);
            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setPadding(0, dp(7), 0, dp(7));
            TextView time = Ui.text(this, hm.format(new Date(a.alarmAtMs)), 22, Ui.TEXT, true);
            time.setMinWidth(dp(72));
            row.addView(time);
            LinearLayout col = new LinearLayout(this);
            col.setOrientation(LinearLayout.VERTICAL);
            col.addView(Ui.text(this, a.title.isEmpty() ? "Alarm" : a.title, 15, Ui.TEXT, true));
            String sub = day.format(new Date(a.alarmAtMs));
            if (a.minutesBefore > 0) sub += "  -  " + a.minutesBefore + " min before";
            col.addView(Ui.text(this, sub, 12, Ui.MUTED, false));
            row.addView(col);
            alarmsBox.addView(row);
        }
        if (upcoming.size() > 8) {
            alarmsBox.addView(Ui.text(this, "+ " + (upcoming.size() - 8) + " more", 12, Ui.MUTED, false));
        }

        drawSound();
        drawChecks();
    }

    private void drawSound() {
        soundBox.removeAllViews();
        String cur = Prefs.sound(this);
        for (final Ringtones.Sound s : Ringtones.BUNDLED) {
            soundBox.addView(soundRow(s.name, s.hint, cur.equals(s.choice()), v -> chooseBundled(s)));
        }
        boolean picked = cur.startsWith("uri:");
        soundBox.addView(soundRow("Phone default alarm", "Whatever your phone uses for alarms", cur.isEmpty(),
                v -> choosePhoneDefault()));
        soundBox.addView(soundRow(picked ? Ringtones.label(this, cur) : "Pick from your phone...",
                picked ? "Tap to change" : "Any alarm sound or ringtone on this phone", picked, v -> pickFromPhone()));

        LinearLayout ramp = new LinearLayout(this);
        ramp.setOrientation(LinearLayout.HORIZONTAL);
        ramp.setGravity(Gravity.CENTER_VERTICAL);
        ramp.setPadding(dp(4), dp(14), dp(4), dp(2));
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.addView(Ui.text(this, "Start quiet, get louder", 15, Ui.TEXT, true));
        col.addView(Ui.text(this, "Rises to full volume in about 30 seconds", 12, Ui.MUTED, false));
        ramp.addView(col, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        Switch sw = new Switch(this);
        sw.setChecked(Prefs.ramp(this));
        sw.setOnCheckedChangeListener((b, on) -> Prefs.setRamp(this, on));
        ramp.addView(sw);
        soundBox.addView(ramp);
    }

    private View soundRow(String name, String hint, boolean selected, View.OnClickListener l) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(10), dp(10), dp(10), dp(10));
        if (selected) row.setBackground(Ui.round(this, Ui.CARD_HI, 12));
        row.setOnClickListener(l);
        row.addView(Ui.dot(this, selected ? Ui.ACCENT : 0xFF3A4156));
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.addView(Ui.text(this, name, 15, Ui.TEXT, selected));
        col.addView(Ui.text(this, hint, 12, Ui.MUTED, false));
        row.addView(col);
        LinearLayout.LayoutParams p = Ui.wrap(this, 2);
        row.setLayoutParams(p);
        return row;
    }

    private void drawChecks() {
        checksBox.removeAllViews();
        boolean n = areNotificationsOn();
        boolean f = canFullScreen();
        boolean b = ignoresBattery();
        boolean u = canInstall();
        boolean o = Settings.canDrawOverlays(this);
        int missing = (n ? 0 : 1) + (f ? 0 : 1) + (b ? 0 : 1) + (o ? 0 : 1);
        checksSummary.setText(missing == 0
                ? "All the checkable steps are done. Allow the two Xiaomi steps too, then press Test alarm with the screen locked."
                : missing + (missing == 1 ? " step" : " steps") + " left. Xiaomi stops apps in the background unless you allow all of these.");
        checksSummary.setTextColor(missing == 0 ? Ui.OK : Ui.MUTED);

        checkRow("Notifications", n ? 1 : 0, "Allow", v -> askNotifications());
        checkRow("Full-screen alarms", f ? 1 : 0, "Allow", v -> openFullScreenSettings());
        checkRow("No battery limits", b ? 1 : 0, "Allow", v -> openBatterySettings());
        checkRow("Display over other apps", o ? 1 : 0, "Allow", v -> openOverlaySettings());
        checkRow("Installing updates", u ? 1 : 0, "Allow", v -> openInstallSettings());
        checkRow("Autostart (Xiaomi)", -1, "Open", v -> openAutostart());
        checkRow("Pop-ups and lock screen (Xiaomi)", -1, "Open", v -> openAppSettings());
    }

    /** state: 1 = done, 0 = missing, -1 = the app cannot check it. */
    private void checkRow(String title, int state, String action, View.OnClickListener l) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(0, dp(7), 0, dp(7));
        row.addView(Ui.dot(this, state == 1 ? Ui.OK : state == 0 ? Ui.BAD : Ui.WARN));
        TextView t = Ui.text(this, title, 15, Ui.TEXT, false);
        row.addView(t, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        if (state != 1) row.addView(Ui.smallButton(this, action, l));
        else row.addView(Ui.text(this, "Done", 13, Ui.OK, true));
        checksBox.addView(row);
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
