package app.personalos.alarms;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** The system calls this at the alarm time. It starts the service that rings. */
public class AlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !Scheduler.ACTION_FIRE.equals(intent.getAction())) return;
        AlarmItem item = AlarmItem.from(intent);
        if (item == null) {
            RingLog.add(context, RingLog.BAD, "An alarm arrived without its data.");
            return;
        }
        RingLog.fire(context, item);
        Intent ring = new Intent(context, AlarmService.class).setAction(AlarmService.ACTION_RING);
        item.putInto(ring);
        try {
            context.startForegroundService(ring);
        } catch (Exception e) {
            RingLog.add(context, RingLog.BAD, "The phone refused to start the alarm sound (" + e.getClass().getSimpleName()
                    + "). Check Autostart and the battery saver for this app.");
        }
    }
}
