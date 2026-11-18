package app.personalos.alarms;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** BL-110: Android says the phone is switching off. Remember when, so the next boot can report it. */
public class ShutdownReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        Prefs.setOffAt(context, System.currentTimeMillis());
    }
}
