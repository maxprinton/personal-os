package app.personalos.alarms;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.drawable.Icon;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;

/**
 * Rings: loud sound on the alarm volume, vibration, and a full-screen alarm screen. A ring with the
 * "notify" style is quieter: a banner with a sound and no takeover. Rings of a chain come back by
 * themselves (they are separate alarms already set), each one louder when the rule says so.
 */
public class AlarmService extends Service {
    static final String ACTION_RING = "app.personalos.alarms.RING";
    /** Silence this ring. If more rings of the chain are coming they still ring; if not, it snoozes (start rings only). */
    static final String ACTION_SNOOZE = "app.personalos.alarms.SNOOZE";
    /** Just stop the sound. */
    static final String ACTION_STOP = "app.personalos.alarms.STOP";
    /** "I'm up" / "Got it": stop the sound and cancel the rest of the chain. */
    static final String ACTION_ACK = "app.personalos.alarms.ACK";

    private static final String CHANNEL_RING = "alarm_ring";
    private static final String CHANNEL_MISSED = "alarm_missed";
    private static final String CHANNEL_NOTE = "alarm_note";
    private static final int NOTIF_RING = 4242;
    private static final int NOTIF_MISSED = 4243;
    private static final int NOTIF_NOTE_BASE = 4300;
    private static final int SNOOZE_MINUTES = 10;
    private static final long AUTO_STOP_MS = 5 * 60 * 1000L;
    /** A quiet heads-up never plays longer than this, even if its sound is long. */
    private static final long NOTIFY_MAX_MS = 20 * 1000L;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable autoStop = () -> stopRinging(true);
    private final Runnable notifyDone = this::finishNotify;
    private float rampStart = 0.15f;
    private int rampSteps = 30;
    private static final long RAMP_TICK_MS = 1000L;
    private int rampStep;
    /** The gentle start: the sound gets louder every second until full volume. */
    private final Runnable rampUp = new Runnable() {
        @Override
        public void run() {
            if (player == null) return;
            rampStep++;
            float v = Math.min(1f, rampStart + (1f - rampStart) * rampStep / rampSteps);
            try {
                player.setVolume(v, v);
            } catch (IllegalStateException ignored) {
                return;
            }
            if (rampStep < rampSteps) main.postDelayed(this, RAMP_TICK_MS);
        }
    };
    private MediaPlayer player;
    private Vibrator vibrator;
    private PowerManager.WakeLock wake;
    private AlarmItem current;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();

        if (ACTION_STOP.equals(action)) {
            stopRinging(false);
            return START_NOT_STICKY;
        }
        if (ACTION_ACK.equals(action)) {
            AlarmItem item = AlarmItem.from(intent);
            if (item == null) item = current;
            Scheduler.answerChain(this, item);
            stopRinging(false);
            return START_NOT_STICKY;
        }
        if (ACTION_SNOOZE.equals(action)) {
            AlarmItem item = AlarmItem.from(intent);
            if (item == null) item = current;
            // With more rings coming the chain is already the "snooze"; the last ring of a start can be snoozed.
            if (item != null && !item.hasMore() && !item.isEnd()) Scheduler.snooze(this, item, SNOOZE_MINUTES);
            stopRinging(false);
            return START_NOT_STICKY;
        }

        AlarmItem item = AlarmItem.from(intent);
        if (item == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        // A new ring while the last one still sounds (a chain every few minutes): start clean
        main.removeCallbacks(autoStop);
        main.removeCallbacks(notifyDone);
        releaseSound();
        current = item;
        ensureChannels();
        Notification n = buildNotification(item);
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIF_RING, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIF_RING, n);
        }
        startSound(item);

        if (item.isNotify()) {
            // Quiet heads-up: no alarm screen. It ends when its sound has played once.
            main.postDelayed(notifyDone, NOTIFY_MAX_MS);
        } else {
            // Backup: with "Display over other apps" allowed, open the alarm screen directly, in case the
            // phone (Xiaomi does this) keeps the full-screen notification as a small banner.
            if (Settings.canDrawOverlays(this)) {
                try {
                    Intent screen = new Intent(this, AlarmActivity.class)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                    item.putInto(screen);
                    startActivity(screen);
                } catch (Exception ignored) {
                    // the notification still shows the alarm
                }
            }
            main.postDelayed(autoStop, AUTO_STOP_MS);
        }

        // Ringing is a good moment to refresh the schedule from Personal OS (best effort).
        final Context app = getApplicationContext();
        new Thread(() -> Sync.run(app)).start();
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        releaseSound();
        main.removeCallbacks(autoStop);
        main.removeCallbacks(notifyDone);
        super.onDestroy();
    }

    private void ensureChannels() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        NotificationChannel ring = new NotificationChannel(CHANNEL_RING, "Alarms", NotificationManager.IMPORTANCE_HIGH);
        ring.setDescription("Rings at the time of your blocks");
        ring.setSound(null, null);
        ring.enableVibration(false);
        ring.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ring);
        NotificationChannel missed = new NotificationChannel(CHANNEL_MISSED, "Missed alarms", NotificationManager.IMPORTANCE_DEFAULT);
        nm.createNotificationChannel(missed);
        NotificationChannel note = new NotificationChannel(CHANNEL_NOTE, "Heads-ups", NotificationManager.IMPORTANCE_LOW);
        note.setDescription("What stays in the notification list after a quiet heads-up");
        nm.createNotificationChannel(note);
    }

    private PendingIntent actionPi(String action, AlarmItem item, int requestCode) {
        Intent i = new Intent(this, AlarmService.class).setAction(action);
        item.putInto(i);
        return PendingIntent.getService(this, requestCode, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** The text under the title: when, which ring of the chain, then the habits and tasks. */
    private String bodyText(AlarmItem item) {
        StringBuilder sb = new StringBuilder();
        String range = item.timeRange();
        String when = item.whenLabel(System.currentTimeMillis());
        if (!range.isEmpty()) sb.append(range);
        if (!when.isEmpty()) sb.append(sb.length() > 0 ? "  -  " : "").append(when);
        String ring = item.ringLabel();
        if (!ring.isEmpty()) sb.append(sb.length() > 0 ? "  -  " : "").append(ring);
        String details = item.details();
        if (details.isEmpty()) details = item.note; // test alarm
        if (!details.isEmpty()) sb.append(sb.length() > 0 ? "\n" : "").append(details);
        return sb.toString();
    }

    private Notification buildNotification(AlarmItem item) {
        String text = bodyText(item);
        Notification.Builder b = new Notification.Builder(this, CHANNEL_RING)
                .setSmallIcon(R.drawable.ic_alarm_small)
                .setContentTitle(item.title.isEmpty() ? "Alarm" : item.title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setCategory(Notification.CATEGORY_ALARM)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false);

        Icon icon = Icon.createWithResource(this, R.drawable.ic_alarm_small);
        if (item.isNotify()) {
            // No takeover: tapping opens the app
            Intent open = new Intent(this, MainActivity.class);
            b.setContentIntent(PendingIntent.getActivity(
                    this, 14, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
            b.addAction(new Notification.Action.Builder(icon, ackLabel(item), actionPi(ACTION_ACK, item, 13)).build());
            return b.build();
        }

        Intent screen = new Intent(this, AlarmActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        item.putInto(screen);
        PendingIntent screenPi = PendingIntent.getActivity(
                this, 10, screen, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        b.setContentIntent(screenPi).setFullScreenIntent(screenPi, true);
        String second = secondLabel(item);
        if (second != null) {
            b.addAction(new Notification.Action.Builder(icon, second, actionPi(ACTION_SNOOZE, item, 11)).build());
        }
        b.addAction(new Notification.Action.Builder(icon, ackLabel(item), actionPi(ACTION_ACK, item, 13)).build());
        return b.build();
    }

    /** The main answer: "I'm up" for a chain of the start, "Got it" at the end of a block, else "Dismiss". */
    static String ackLabel(AlarmItem item) {
        if (item.isEnd()) return "Got it";
        return item.total > 1 ? "I'm up" : "Dismiss";
    }

    /** The second button: silence (more rings come), snooze (last ring of a start), or none (end of a block). */
    static String secondLabel(AlarmItem item) {
        if (item.hasMore()) {
            return item.every > 0 ? "Silence - again in " + item.every + " min" : "Silence";
        }
        if (item.isEnd()) return null;
        return "Snooze " + SNOOZE_MINUTES + " min";
    }

    private void startSound(AlarmItem item) {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "personalos:alarm");
            wake.acquire(AUTO_STOP_MS + 5000);
        }

        // A silenced alarm volume would make the alarm useless: lift it to half.
        AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        if (am != null && am.getStreamVolume(AudioManager.STREAM_ALARM) == 0) {
            am.setStreamVolume(AudioManager.STREAM_ALARM, Math.max(1, am.getStreamMaxVolume(AudioManager.STREAM_ALARM) / 2), 0);
        }

        boolean notify = item.isNotify();
        try {
            player = Ringtones.open(this, Ringtones.resolve(this, item.sound), !notify);
            if (notify) {
                player.setOnCompletionListener(mp -> main.post(this::finishNotify));
            } else if (item.level >= 2) {
                // The third ring and later: full volume at once
                player.setVolume(1f, 1f);
            } else if (Prefs.ramp(this)) {
                // The first ring starts soft and takes 30 s to reach full volume; the second starts higher and takes 10 s
                rampStart = item.level == 1 ? 0.55f : 0.15f;
                rampSteps = item.level == 1 ? 10 : 30;
                rampStep = 0;
                player.setVolume(rampStart, rampStart);
                main.postDelayed(rampUp, RAMP_TICK_MS);
            }
            player.start();
        } catch (Exception e) {
            releaseSound(); // no sound available: the vibration below still works
        }

        vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        if (vibrator != null && vibrator.hasVibrator()) {
            if (notify) {
                vibrator.vibrate(VibrationEffect.createOneShot(400, VibrationEffect.DEFAULT_AMPLITUDE));
            } else if (item.level >= 2) {
                vibrator.vibrate(VibrationEffect.createWaveform(new long[]{0, 500, 300}, 0));
            } else {
                vibrator.vibrate(VibrationEffect.createWaveform(new long[]{0, 800, 700}, 0));
            }
        }
    }

    private void releaseSound() {
        main.removeCallbacks(rampUp);
        if (player != null) {
            try {
                player.stop();
            } catch (Exception ignored) {
                // already stopped
            }
            player.release();
            player = null;
        }
        if (vibrator != null) {
            vibrator.cancel();
            vibrator = null;
        }
        if (wake != null && wake.isHeld()) {
            wake.release();
        }
        wake = null;
    }

    /** A quiet heads-up has played: leave a plain notification in the list and stop. */
    private void finishNotify() {
        main.removeCallbacks(notifyDone);
        AlarmItem item = current;
        releaseSound();
        stopForeground(STOP_FOREGROUND_REMOVE);
        if (item != null) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            ensureChannels();
            String text = bodyText(item);
            int id = NOTIF_NOTE_BASE + (item.chain.hashCode() & 0xff);
            nm.notify(id, new Notification.Builder(this, CHANNEL_NOTE)
                    .setSmallIcon(R.drawable.ic_alarm_small)
                    .setContentTitle(item.title.isEmpty() ? "Alarm" : item.title)
                    .setContentText(text)
                    .setStyle(new Notification.BigTextStyle().bigText(text))
                    .setAutoCancel(true)
                    .build());
        }
        stopSelf();
    }

    private void stopRinging(boolean missed) {
        main.removeCallbacks(autoStop);
        main.removeCallbacks(notifyDone);
        releaseSound();
        stopForeground(STOP_FOREGROUND_REMOVE);
        if (missed && current != null) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            ensureChannels();
            nm.notify(NOTIF_MISSED, new Notification.Builder(this, CHANNEL_MISSED)
                    .setSmallIcon(R.drawable.ic_alarm_small)
                    .setContentTitle("Missed alarm: " + current.title)
                    .setContentText(current.timeRange())
                    .setAutoCancel(true)
                    .build());
        }
        AlarmActivity open = AlarmActivity.instance;
        if (open != null) {
            open.finishAndRemoveTask();
        }
        stopSelf();
    }
}
