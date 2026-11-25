package app.personalos.alarms;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** BL-114: the time of the "Still up?" check, and the tap on its banner. */
public class StillUpReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? "" : String.valueOf(intent.getAction());
        if (StillUp.ACTION_SHOW.equals(action)) StillUp.show(context);
        else if (StillUp.ACTION_YES.equals(action)) StillUp.yes(context);
    }
}
