package app.personalos.alarms;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * A small, silent "signs of life" notification, refreshed on every hourly sync. It is always the same
 * notification (replaced, never piled up). If its time stops moving, the phone has put the app to sleep.
 */
final class Heartbeat {
    private Heartbeat() {}

    private static final String CHANNEL = "heartbeat";
    private static final int NOTIF = 4270;

    static void beat(Context ctx) {
        try {
            Context c = ctx.getApplicationContext();
            NotificationManager nm = c.getSystemService(NotificationManager.class);
            if (nm == null || !nm.areNotificationsEnabled()) return;
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Signs of life", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            ch.setDescription("A small silent note every hour so you can see the alarms app is still awake.");
            nm.createNotificationChannel(ch);

            long now = System.currentTimeMillis();
            SimpleDateFormat hm = new SimpleDateFormat("HH:mm", Locale.getDefault());
            SimpleDateFormat dayHm = new SimpleDateFormat("EEE HH:mm", Locale.getDefault());

            long next = Long.MAX_VALUE;
            String nextTitle = "";
            for (AlarmItem a : Prefs.alarms(c)) {
                if (a.alarmAtMs > now && a.alarmAtMs < next) {
                    next = a.alarmAtMs;
                    nextTitle = a.title == null ? "" : a.title;
                }
            }
            String sync = Prefs.lastSyncMs(c) == 0L ? "no sync yet"
                    : (Prefs.lastSyncOk(c) ? "synced " : "sync FAILED ") + hm.format(new Date(Prefs.lastSyncMs(c)));
            String nextText = next == Long.MAX_VALUE ? "no alarms set"
                    : "next alarm " + dayHm.format(new Date(next)) + (nextTitle.isEmpty() ? "" : " " + nextTitle);

            Notification n = new Notification.Builder(c, CHANNEL)
                    .setSmallIcon(R.drawable.ic_alarm_small)
                    .setContentTitle("Alarms awake " + hm.format(new Date(now)))
                    .setContentText(sync + " - " + nextText)
                    .setStyle(new Notification.BigTextStyle().bigText(sync + "\n" + nextText))
                    .setShowWhen(true)
                    .setWhen(now)
                    .setOnlyAlertOnce(true)
                    .setVisibility(Notification.VISIBILITY_SECRET)
                    .setAutoCancel(false)
                    .build();
            nm.notify(NOTIF, n);
        } catch (Exception ignored) {
            // a missing heartbeat must never break a sync
        }
    }
}
