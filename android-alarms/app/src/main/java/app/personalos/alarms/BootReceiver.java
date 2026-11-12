package app.personalos.alarms;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** After a reboot, an update, or a time / time zone change: set the alarms again and re-read Personal OS. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        Scheduler.rescheduleStored(context);
        Scheduler.armNextSync(context);
        SyncJobService.runNow(context);
    }
}
