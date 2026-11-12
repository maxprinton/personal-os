package app.personalos.alarms;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;

/** Sets and cancels the real alarms, and the nightly re-reads of Personal OS. */
final class Scheduler {
    private Scheduler() {}

    static final String ACTION_FIRE = "app.personalos.alarms.FIRE";
    static final String ACTION_SYNC = "app.personalos.alarms.SYNC";

    /**
     * Local times (hour, minute) at which the phone re-reads Personal OS: the night before (11 pm) and
     * the small hours (12 am, 3 am, 4 am), so a wake-up time changed the evening before is picked up.
     * Also on opening the app and every time an alarm rings.
     */
    static final int[][] SYNC_TIMES = {{23, 0}, {0, 0}, {3, 0}, {4, 0}};

    private static AlarmManager am(Context c) {
        return (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
    }

    /** Each alarm has its own PendingIntent, told apart by its data address (the id). */
    private static PendingIntent firePi(Context c, AlarmItem a, int flag) {
        Intent i = new Intent(c, AlarmReceiver.class)
                .setAction(ACTION_FIRE)
                .setData(Uri.parse("posalarm://" + Uri.encode(a.id)));
        a.putInto(i);
        return PendingIntent.getBroadcast(c, 0, i, flag | PendingIntent.FLAG_IMMUTABLE);
    }

    /** A real alarm (the Clock-style one: it shows in the status bar and is not delayed by battery savers). */
    static void schedule(Context c, AlarmItem a) {
        if (a.alarmAtMs <= System.currentTimeMillis()) return;
        Intent show = new Intent(c, MainActivity.class);
        PendingIntent showPi = PendingIntent.getActivity(
                c, 1, show, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        am(c).setAlarmClock(new AlarmManager.AlarmClockInfo(a.alarmAtMs, showPi),
                firePi(c, a, PendingIntent.FLAG_UPDATE_CURRENT));
    }

    static void cancel(Context c, AlarmItem a) {
        PendingIntent pi = firePi(c, a, PendingIntent.FLAG_NO_CREATE);
        if (pi != null) {
            am(c).cancel(pi);
            pi.cancel();
        }
    }

    /** The list from Personal OS replaces everything set before (moved blocks, removed alarms...). */
    static synchronized void replaceAll(Context c, List<AlarmItem> fresh) {
        for (AlarmItem old : Prefs.alarms(c)) cancel(c, old);
        long now = System.currentTimeMillis();
        List<AlarmItem> keep = new ArrayList<>();
        for (AlarmItem a : fresh) {
            if (a.alarmAtMs > now) keep.add(a);
        }
        Prefs.setAlarms(c, keep);
        for (AlarmItem a : keep) schedule(c, a);
    }

    /** After a reboot or an app update the system forgets alarms: set the stored ones again. */
    static synchronized void rescheduleStored(Context c) {
        long now = System.currentTimeMillis();
        for (AlarmItem a : Prefs.alarms(c)) {
            if (a.alarmAtMs > now) schedule(c, a);
        }
    }

    /** Rings again after a few minutes. Not part of the synced list, so a sync never cancels it. */
    static void snooze(Context c, AlarmItem base, int minutes) {
        long when = System.currentTimeMillis() + minutes * 60_000L;
        String id = base.id.startsWith("snooze-") ? base.id : "snooze-" + base.id;
        schedule(c, new AlarmItem(id, base.title, base.date, base.start, base.end, base.note,
                base.startsAtMs, when, base.minutesBefore));
    }

    // ---- The re-reads of Personal OS --------------------------------------------------------

    static long nextSyncMs(long now) {
        long best = Long.MAX_VALUE;
        for (int[] t : SYNC_TIMES) {
            Calendar cal = Calendar.getInstance();
            cal.setTimeInMillis(now);
            cal.set(Calendar.HOUR_OF_DAY, t[0]);
            cal.set(Calendar.MINUTE, t[1]);
            cal.set(Calendar.SECOND, 0);
            cal.set(Calendar.MILLISECOND, 0);
            if (cal.getTimeInMillis() <= now + 1000) cal.add(Calendar.DAY_OF_YEAR, 1);
            best = Math.min(best, cal.getTimeInMillis());
        }
        return best;
    }

    /** Arms the next re-read. It may arrive a few minutes late when the phone is in deep sleep. */
    static void armNextSync(Context c) {
        Intent i = new Intent(c, SyncReceiver.class).setAction(ACTION_SYNC);
        PendingIntent pi = PendingIntent.getBroadcast(
                c, 2, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        long when = nextSyncMs(System.currentTimeMillis());
        am(c).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, pi);
        Prefs.setNextSync(c, when);
    }
}
