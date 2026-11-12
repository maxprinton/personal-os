package app.personalos.alarms;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Wakes up every hour at x:05 and x:45: arms the next one and starts a re-read of Personal OS. */
public class SyncReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !Scheduler.ACTION_SYNC.equals(intent.getAction())) return;
        Scheduler.armNextSync(context);
        SyncJobService.runNow(context);
    }
}
