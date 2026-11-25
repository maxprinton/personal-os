package app.personalos.alarms;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.drawable.Icon;

/**
 * BL-114: "Still up?". About 10 minutes after "I'm up" on the wake ring, one quiet banner asks if you
 * are still up. One tap answers it. It is not an alarm: if it is not answered it stays in the
 * notification list. Only one is pending at a time, it survives a restart (see {@link #rearm}) and is
 * dropped if its time already passed.
 */
final class StillUp {
    private StillUp() {}

    static final String ACTION_SHOW = "app.personalos.alarms.STILLUP_SHOW";
    static final String ACTION_YES = "app.personalos.alarms.STILLUP_YES";
    static final long DELAY_MS = 10 * 60 * 1000L;
    static final int NOTIF_ID = 4252;
    private static final String CHANNEL = "alarm_stillup";

    private static AlarmManager am(Context c) {
        return (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
    }

    private static PendingIntent showPi(Context c, int flag) {
        Intent i = new Intent(c, StillUpReceiver.class).setAction(ACTION_SHOW);
        return PendingIntent.getBroadcast(c, 40, i, flag | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void set(Context c, long when) {
        PendingIntent pi = showPi(c, PendingIntent.FLAG_UPDATE_CURRENT);
        try {
            am(c).setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, pi);
        } catch (SecurityException e) {
            am(c).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, pi);
        }
    }

    /** "I'm up" on a wake ring. Two taps in a row keep the first banner (only one is ever pending). */
    static synchronized void arm(Context c, AlarmItem wakeRing) {
        if (wakeRing == null || !wakeRing.wake || wakeRing.occurrenceId.isEmpty()) return;
        long now = System.currentTimeMillis();
        if (Prefs.stillUpAt(c) > now) return;
        long when = now + DELAY_MS;
        Prefs.setStillUp(c, when, wakeRing.occurrenceId, wakeRing.blockTypeId);
        set(c, when);
        RingLog.add(c, RingLog.INFO, "\"Still up?\" check set for 10 minutes from now.");
    }

    /** After a restart the system forgets the alarm: set it again if it is still in the future, drop it if not. */
    static synchronized void rearm(Context c) {
        long due = Prefs.stillUpAt(c);
        if (due <= 0L) return;
        if (due > System.currentTimeMillis()) set(c, due);
        else Prefs.setStillUp(c, 0L, "", "");
    }

    /** A Started answer on the same block makes the check unnecessary. */
    static synchronized void cancelFor(Context c, String occurrenceId) {
        if (occurrenceId == null || occurrenceId.isEmpty()) return;
        if (Prefs.stillUpAt(c) <= 0L || !occurrenceId.equals(Prefs.stillUpOcc(c))) return;
        PendingIntent pi = showPi(c, PendingIntent.FLAG_NO_CREATE);
        if (pi != null) {
            am(c).cancel(pi);
            pi.cancel();
        }
        Prefs.setStillUp(c, 0L, "", "");
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm != null) nm.cancel(NOTIF_ID);
    }

    /** The time came: the quiet banner. A tap anywhere on it (or on the button) is the answer. */
    static synchronized void show(Context c) {
        if (Prefs.stillUpAt(c) <= 0L) return; // cancelled meanwhile
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return;
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Still up? check", NotificationManager.IMPORTANCE_DEFAULT));
        Intent yes = new Intent(c, StillUpReceiver.class).setAction(ACTION_YES);
        PendingIntent yesPi = PendingIntent.getBroadcast(c, 41, yes, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        nm.notify(NOTIF_ID, new Notification.Builder(c, CHANNEL)
                .setSmallIcon(R.drawable.ic_alarm_small)
                .setContentTitle("Still up?")
                .setContentText("Tap to confirm you are up.")
                .setContentIntent(yesPi)
                .addAction(new Notification.Action.Builder(Icon.createWithResource(c, R.drawable.ic_alarm_small), "Yes, up", yesPi).build())
                .setAutoCancel(true)
                .build());
    }

    /** "Yes, up": one event for Personal OS, the banner goes away, nothing else is pending. */
    static synchronized void yes(Context c) {
        String occ = Prefs.stillUpOcc(c);
        String block = Prefs.stillUpBlock(c);
        Prefs.setStillUp(c, 0L, "", "");
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm != null) nm.cancel(NOTIF_ID);
        Answers.stillUp(c, occ, block);
    }
}
