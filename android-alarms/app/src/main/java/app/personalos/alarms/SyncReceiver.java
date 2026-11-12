package app.personalos.alarms;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Wakes up at 11 pm / 12 am / 3 am / 4 am: arms the next one and starts a re-read of Personal OS. */
public class SyncReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !Scheduler.ACTION_SYNC.equals(intent.getAction())) return;
        Scheduler.armNextSync(context);
        SyncJobService.runNow(context);
    }
}
