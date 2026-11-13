package app.personalos.alarms;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Runs one re-read of Personal OS right when the hourly alarm fires. It is a short foreground service
 * (a few seconds, with a quiet notification) so the phone cannot postpone it the way it postpones
 * background jobs.
 */
public class SyncService extends Service {
    private static final String CHANNEL = "sync_quiet";
    private static final int NOTIF = 4260;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, final int startId) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Syncing alarms", NotificationManager.IMPORTANCE_MIN);
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
        Notification n = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_alarm_small)
                .setContentTitle("Updating your alarms")
                .setOngoing(true)
                .build();
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIF, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else {
                startForeground(NOTIF, n);
            }
        } catch (Exception e) {
            RingLog.add(this, RingLog.WARN, "The hourly sync could not start in the foreground ("
                    + e.getClass().getSimpleName() + "). Trying a background job.");
            SyncJobService.runNow(this);
            stopSelf(startId);
            return START_NOT_STICKY;
        }
        final Context app = getApplicationContext();
        new Thread(() -> {
            PowerManager pm = (PowerManager) app.getSystemService(Context.POWER_SERVICE);
            PowerManager.WakeLock wl = null;
            if (pm != null) {
                wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "personalos:sync");
                wl.acquire(90_000L);
            }
            try {
                Sync.Result r = Sync.run(app);
                if (r.ok) Updater.checkInBackground(app);
            } catch (Exception e) {
                RingLog.add(app, RingLog.WARN, "The hourly sync stopped with an error (" + e.getClass().getSimpleName() + ").");
            } finally {
                Heartbeat.beat(app);
                if (wl != null && wl.isHeld()) wl.release();
                stopForeground(STOP_FOREGROUND_REMOVE);
                stopSelf(startId);
            }
        }).start();
        return START_NOT_STICKY;
    }
}
