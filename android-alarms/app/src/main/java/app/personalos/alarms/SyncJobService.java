package app.personalos.alarms;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.os.Build;

/** Runs one re-read of Personal OS in the background (expedited, so it starts right away). */
public class SyncJobService extends JobService {
    static final int JOB_ID = 7001;

    /** Asks the system to re-read Personal OS now. A failed run is retried by the system with a delay. */
    static void runNow(Context c) {
        if (!Prefs.configured(c)) return;
        JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (js == null) return;
        JobInfo.Builder b = new JobInfo.Builder(JOB_ID, new ComponentName(c, SyncJobService.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY);
        if (Build.VERSION.SDK_INT >= 30) {
            b.setExpedited(true);
        } else {
            b.setOverrideDeadline(0);
        }
        js.schedule(b.build());
    }

    @Override
    public boolean onStartJob(final JobParameters params) {
        final Context app = getApplicationContext();
        new Thread(() -> {
            Sync.Result r = Sync.run(app);
            if (r.ok) Updater.checkInBackground(app);
            jobFinished(params, !r.ok && r.retry);
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true;
    }
}
