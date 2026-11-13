package app.personalos.alarms;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/** Sets and cancels the real alarms, and the hourly re-reads of Personal OS. */
final class Scheduler {
    private Scheduler() {}

    static final String ACTION_FIRE = "app.personalos.alarms.FIRE";
    static final String ACTION_SYNC = "app.personalos.alarms.SYNC";

    /**
     * Minutes of every hour at which the phone re-reads Personal OS (x:05 and x:45, all day and night),
     * so a block moved or a wake-up time changed is picked up within the hour.
     * Also on opening the app and every time an alarm rings.
     */
    static final int[] SYNC_MINUTES = {5, 45};

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
        PendingIntent fire = firePi(c, a, PendingIntent.FLAG_UPDATE_CURRENT);
        try {
            am(c).setAlarmClock(new AlarmManager.AlarmClockInfo(a.alarmAtMs, showPi), fire);
        } catch (SecurityException e) {
            // Exact alarms refused by the system: fall back to one that may ring a little late
            am(c).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, a.alarmAtMs, fire);
        }
    }

    static void cancel(Context c, AlarmItem a) {
        cancelId(c, a.id);
    }

    /** The system finds an alarm by its data address (the id), so a bare item with that id is enough. */
    static void cancelId(Context c, String id) {
        PendingIntent pi = firePi(c, new AlarmItem(id, "", "", "", "", "", 0L, 0L, 0), PendingIntent.FLAG_NO_CREATE);
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
            // rings of a chain the user already answered stay silent
            if (a.alarmAtMs > now && !Prefs.isAcked(c, a.chain)) keep.add(a);
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
        schedule(c, base.snoozedTo(id, when));
    }

    /**
     * "I'm up" / "Got it": the rest of this chain never rings. The answer is remembered so a later sync
     * does not bring the rings back, and a pending snooze of this chain is cancelled too.
     */
    static synchronized void answerChain(Context c, AlarmItem item) {
        if (item == null || item.chain.isEmpty()) return;
        Prefs.ackChain(c, item.chain);
        List<AlarmItem> keep = new ArrayList<>();
        for (AlarmItem a : Prefs.alarms(c)) {
            if (item.chain.equals(a.chain)) {
                cancel(c, a);
                cancelId(c, "snooze-" + a.id);
            } else {
                keep.add(a);
            }
        }
        cancelId(c, item.id.startsWith("snooze-") ? item.id : "snooze-" + item.id);
        Prefs.setAlarms(c, keep);
    }

    // ---- The re-reads of Personal OS --------------------------------------------------------

    static long nextSyncMs(long now) {
        long best = Long.MAX_VALUE;
        for (int minute : SYNC_MINUTES) {
            Calendar cal = Calendar.getInstance();
            cal.setTimeInMillis(now);
            cal.set(Calendar.MINUTE, minute);
            cal.set(Calendar.SECOND, 0);
            cal.set(Calendar.MILLISECOND, 0);
            if (cal.getTimeInMillis() <= now + 1000) cal.add(Calendar.HOUR_OF_DAY, 1);
            best = Math.min(best, cal.getTimeInMillis());
        }
        return best;
    }

    /**
     * Arms the next re-read. Exact (on time even in deep sleep) when the phone allows it, otherwise the
     * relaxed kind. Before replacing the stored time it checks whether the previous one really ran:
     * if it came much later than planned, or not at all, the diary says so.
     */
    static void armNextSync(Context c) {
        long now = System.currentTimeMillis();
        long due = Prefs.nextSyncMs(c);
        if (due > 0L && due < now - 20 * 60_000L) {
            SimpleDateFormat hm = new SimpleDateFormat("HH:mm", Locale.getDefault());
            RingLog.add(c, RingLog.BAD, "The automatic sync due at " + hm.format(new Date(due)) + " only ran at "
                    + hm.format(new Date(now)) + ". The phone is holding this app back in the background.");
        }
        Intent i = new Intent(c, SyncReceiver.class).setAction(ACTION_SYNC);
        PendingIntent pi = PendingIntent.getBroadcast(
                c, 2, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        long when = nextSyncMs(now);
        try {
            am(c).setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, pi);
        } catch (SecurityException e) {
            am(c).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, pi);
        }
        Prefs.setNextSync(c, when);
    }
}
