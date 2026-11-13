package app.personalos.alarms;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** After a reboot, an update, or a time / time zone change: set the alarms again and re-read Personal OS. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? "" : String.valueOf(intent.getAction());
        if (action.endsWith("BOOT_COMPLETED")) RingLog.add(context, RingLog.INFO, "Phone restarted: alarms set again.");
        else if (action.endsWith("MY_PACKAGE_REPLACED")) RingLog.add(context, RingLog.INFO, "App updated: alarms set again.");
        else if (action.endsWith("TIMEZONE_CHANGED")) RingLog.add(context, RingLog.INFO, "Time zone changed: alarms set again.");
        Scheduler.rescheduleStored(context);
        Scheduler.armNextSync(context);
        SyncJobService.runNow(context);
    }
}
