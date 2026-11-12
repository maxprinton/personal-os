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
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;

/** Rings: loud sound on the alarm volume, vibration, and a full-screen alarm screen with Snooze / Dismiss. */
public class AlarmService extends Service {
    static final String ACTION_RING = "app.personalos.alarms.RING";
    static final String ACTION_SNOOZE = "app.personalos.alarms.SNOOZE";
    static final String ACTION_STOP = "app.personalos.alarms.STOP";

    private static final String CHANNEL_RING = "alarm_ring";
    private static final String CHANNEL_MISSED = "alarm_missed";
    private static final int NOTIF_RING = 4242;
    private static final int NOTIF_MISSED = 4243;
    private static final int SNOOZE_MINUTES = 10;
    private static final long AUTO_STOP_MS = 5 * 60 * 1000L;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable autoStop = () -> stopRinging(true);
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
        if (ACTION_SNOOZE.equals(action)) {
            AlarmItem item = AlarmItem.from(intent);
            if (item == null) item = current;
            if (item != null) Scheduler.snooze(this, item, SNOOZE_MINUTES);
            stopRinging(false);
            return START_NOT_STICKY;
        }

        AlarmItem item = AlarmItem.from(intent);
        if (item == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        current = item;
        ensureChannels();
        Notification n = buildNotification(item);
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIF_RING, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIF_RING, n);
        }
        startSound();
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
        main.removeCallbacks(autoStop);
        main.postDelayed(autoStop, AUTO_STOP_MS);

        // Ringing is a good moment to refresh the schedule from Personal OS (best effort).
        final Context app = getApplicationContext();
        new Thread(() -> Sync.run(app)).start();
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        releaseSound();
        main.removeCallbacks(autoStop);
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
    }

    private Notification buildNotification(AlarmItem item) {
        Intent screen = new Intent(this, AlarmActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        item.putInto(screen);
        PendingIntent screenPi = PendingIntent.getActivity(
                this, 10, screen, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        Intent snooze = new Intent(this, AlarmService.class).setAction(ACTION_SNOOZE);
        item.putInto(snooze);
        PendingIntent snoozePi = PendingIntent.getService(
                this, 11, snooze, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        Intent stop = new Intent(this, AlarmService.class).setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(
                this, 12, stop, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        String text = item.timeRange();
        if (!item.note.isEmpty()) text = text.isEmpty() ? item.note : text + "  -  " + item.note;

        Notification.Builder b = new Notification.Builder(this, CHANNEL_RING)
                .setSmallIcon(R.drawable.ic_alarm_small)
                .setContentTitle(item.title.isEmpty() ? "Alarm" : item.title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setCategory(Notification.CATEGORY_ALARM)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setContentIntent(screenPi)
                .setFullScreenIntent(screenPi, true)
                .addAction(new Notification.Action.Builder(
                        Icon.createWithResource(this, R.drawable.ic_alarm_small), "Snooze " + SNOOZE_MINUTES + " min", snoozePi).build())
                .addAction(new Notification.Action.Builder(
                        Icon.createWithResource(this, R.drawable.ic_alarm_small), "Dismiss", stopPi).build());
        return b.build();
    }

    private void startSound() {
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

        try {
            Uri uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
            player.setDataSource(this, uri);
            player.setLooping(true);
            player.prepare();
            player.start();
        } catch (Exception e) {
            releaseSound(); // no sound available: the vibration below still works
        }

        vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        if (vibrator != null && vibrator.hasVibrator()) {
            vibrator.vibrate(VibrationEffect.createWaveform(new long[]{0, 800, 700}, 0));
        }
    }

    private void releaseSound() {
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

    private void stopRinging(boolean missed) {
        main.removeCallbacks(autoStop);
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
