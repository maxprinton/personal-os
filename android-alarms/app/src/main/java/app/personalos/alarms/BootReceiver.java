package app.personalos.alarms;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** After a reboot, an update, or a time / time zone change: set the alarms again and re-read Personal OS. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? "" : String.valueOf(intent.getAction());
        if (action.endsWith("BOOT_COMPLETED")) {
            RingLog.add(context, RingLog.INFO, "Phone restarted: alarms set again.");
            reportOff(context);
        }
        else if (action.endsWith("MY_PACKAGE_REPLACED")) RingLog.add(context, RingLog.INFO, "App updated: alarms set again.");
        else if (action.endsWith("TIMEZONE_CHANGED")) RingLog.add(context, RingLog.INFO, "Time zone changed: alarms set again.");
        Scheduler.rescheduleStored(context);
        StillUp.rearm(context);
        Scheduler.armNextSync(context);
        SyncJobService.runNow(context);
    }

    /**
     * BL-110: tell Personal OS when the phone was off, so missed alarms show "Phone was off", not
     * "Didn't ring". From = when Android said "shutting down" (or, if the battery died, the last time the
     * app knew the phone was on); to = when the phone started again.
     */
    private static void reportOff(Context c) {
        long now = System.currentTimeMillis();
        long bootAt = now - SystemClock.elapsedRealtime();
        long off = Prefs.offAt(c);
        long alive = Prefs.aliveAt(c);
        long from = 0L;
        if (off > 0 && off < bootAt) from = off;
        if (alive > from && alive < bootAt) from = alive;
        Prefs.setOffAt(c, 0L);
        Prefs.markAlive(c);
        // Nothing known, or a quick restart (under 2 minutes): nothing worth reporting
        if (from <= 0 || bootAt - from < 120_000L) return;
        Answers.off(c, from, bootAt);
        SimpleDateFormat f = new SimpleDateFormat("EEE HH:mm", Locale.getDefault());
        RingLog.add(c, RingLog.INFO, "Phone was off from " + f.format(new Date(from)) + " to " + f.format(new Date(bootAt)) + ".");
    }
}
