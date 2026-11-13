package app.personalos.alarms;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Wakes up every hour at x:05 and x:45: arms the next one first (so the chain survives anything that
 * goes wrong below) and then starts a re-read of Personal OS in a short foreground service.
 */
public class SyncReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !Scheduler.ACTION_SYNC.equals(intent.getAction())) return;
        Scheduler.armNextSync(context);
        if (!Prefs.configured(context)) return;
        try {
            context.startForegroundService(new Intent(context, SyncService.class));
        } catch (Exception e) {
            RingLog.add(context, RingLog.WARN, "The hourly sync was refused (" + e.getClass().getSimpleName()
                    + "). Trying a background job.");
            SyncJobService.runNow(context);
            Heartbeat.beat(context);
        }
    }
}
