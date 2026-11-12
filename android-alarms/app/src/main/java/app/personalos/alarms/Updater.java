package app.personalos.alarms;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.os.Build;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/**
 * Updates the app from your own Personal OS: it reads {address}/downloads/version.json (written by the
 * build), downloads the APK and installs it over this app with Android's package installer.
 */
final class Updater {
    private Updater() {}

    static final class Info {
        final long versionCode;
        final String versionName;
        final String apkUrl;
        final String sha256;

        Info(long versionCode, String versionName, String apkUrl, String sha256) {
            this.versionCode = versionCode;
            this.versionName = versionName;
            this.apkUrl = apkUrl;
            this.sha256 = sha256;
        }
    }

    private static final String CHANNEL = "app_update";
    private static final int NOTIF_ID = 4300;

    static long installedCode(Context c) {
        try {
            return c.getPackageManager().getPackageInfo(c.getPackageName(), 0).getLongVersionCode();
        } catch (Exception e) {
            return 0L;
        }
    }

    static String installedName(Context c) {
        try {
            String n = c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionName;
            return n == null ? "?" : n;
        } catch (Exception e) {
            return "?";
        }
    }

    /** The newest build published in Personal OS, or null (not configured, no file yet, no network). */
    static Info fetchLatest(Context c) {
        String base = Prefs.baseUrl(c);
        if (base.isEmpty()) return null;
        HttpURLConnection con = null;
        try {
            con = (HttpURLConnection) new URL(base + "/downloads/version.json").openConnection();
            con.setConnectTimeout(15000);
            con.setReadTimeout(20000);
            if (con.getResponseCode() != 200) return null;
            JSONObject o = new JSONObject(Sync.read(con.getInputStream()));
            long code = o.optLong("versionCode", 0L);
            if (code <= 0L) return null;
            String apk = o.optString("apk", "personal-os-alarms.apk");
            return new Info(code, o.optString("versionName", String.valueOf(code)),
                    base + "/downloads/" + apk, o.optString("sha256", ""));
        } catch (Exception e) {
            return null;
        } finally {
            if (con != null) con.disconnect();
        }
    }

    /** Downloads the APK into the app's private folder and checks its checksum. */
    static File download(Context c, Info info) throws Exception {
        File out = new File(c.getFilesDir(), "update.apk");
        HttpURLConnection con = (HttpURLConnection) new URL(info.apkUrl).openConnection();
        try {
            con.setConnectTimeout(20000);
            con.setReadTimeout(60000);
            int code = con.getResponseCode();
            if (code != 200) throw new Exception("the download answered " + code);
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            try (InputStream in = con.getInputStream(); FileOutputStream fo = new FileOutputStream(out)) {
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) != -1) {
                    fo.write(buf, 0, n);
                    md.update(buf, 0, n);
                }
            }
            if (!info.sha256.isEmpty() && !hex(md.digest()).equalsIgnoreCase(info.sha256)) {
                out.delete();
                throw new Exception("the download is damaged (checksum), try again");
            }
        } finally {
            con.disconnect();
        }
        return out;
    }

    private static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format("%02x", x));
        return sb.toString();
    }

    /** Hands the APK to Android's installer. Android asks you to confirm (once per update). */
    static void install(Context c, File apk) throws Exception {
        PackageInstaller installer = c.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params =
                new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(c.getPackageName());
        if (Build.VERSION.SDK_INT >= 31) {
            // Lets Android skip the confirmation when it is allowed to (later updates on Android 12+)
            params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
        }
        int id = installer.createSession(params);
        try (PackageInstaller.Session session = installer.openSession(id)) {
            try (InputStream in = new FileInputStream(apk);
                 OutputStream out = session.openWrite("update", 0, apk.length())) {
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
                session.fsync(out);
            }
            Intent cb = new Intent(c, InstallReceiver.class).setAction(InstallReceiver.ACTION);
            PendingIntent pending = PendingIntent.getBroadcast(
                    c, id, cb, PendingIntent.FLAG_MUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            session.commit(pending.getIntentSender());
        }
    }

    /** Nightly check: a notification "Update ready" when a newer build is published. */
    static void checkInBackground(Context c) {
        Info info = fetchLatest(c);
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (info == null || nm == null) return;
        if (info.versionCode > installedCode(c)) {
            Prefs.setUpdate(c, info.versionCode, info.versionName);
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "App updates", NotificationManager.IMPORTANCE_DEFAULT));
            Intent open = new Intent(c, MainActivity.class)
                    .putExtra("install_update", true)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pi = PendingIntent.getActivity(
                    c, 20, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            nm.notify(NOTIF_ID, new Notification.Builder(c, CHANNEL)
                    .setSmallIcon(R.drawable.ic_alarm_small)
                    .setContentTitle("Update ready")
                    .setContentText("Personal OS Alarms " + info.versionName + ": tap to install")
                    .setContentIntent(pi)
                    .setAutoCancel(true)
                    .build());
        } else {
            Prefs.setUpdate(c, 0L, "");
            nm.cancel(NOTIF_ID);
        }
    }
}
