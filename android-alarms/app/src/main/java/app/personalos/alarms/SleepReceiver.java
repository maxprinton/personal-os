package app.personalos.alarms;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.widget.Toast;

/** "Going to sleep" from the evening notification: saves this moment as the bedtime. */
public class SleepReceiver extends BroadcastReceiver {
    static final String ACTION_SLEEP = "app.personalos.alarms.SLEEP";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ACTION_SLEEP.equals(intent.getAction())) return;
        Answers.sleep(context);
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm != null) nm.cancel(AlarmService.NOTIF_SLEEP);
        Toast.makeText(context, "Bedtime saved. Good night.", Toast.LENGTH_SHORT).show();
    }
}
