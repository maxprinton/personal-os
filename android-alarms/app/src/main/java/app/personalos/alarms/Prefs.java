package app.personalos.alarms;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** Everything the app remembers: the connection, the last sync and the alarms it set. */
final class Prefs {
    private Prefs() {}

    private static SharedPreferences sp(Context c) {
        return c.getSharedPreferences("pos_alarms", Context.MODE_PRIVATE);
    }

    /** "https://my-app.vercel.app/" or "my-app.vercel.app" -> "https://my-app.vercel.app". */
    static String cleanUrl(String raw) {
        String u = raw == null ? "" : raw.trim();
        while (u.endsWith("/")) u = u.substring(0, u.length() - 1);
        if (u.isEmpty()) return "";
        if (!u.startsWith("http://") && !u.startsWith("https://")) u = "https://" + u;
        return u;
    }

    static String baseUrl(Context c) {
        return sp(c).getString("url", "");
    }

    static String key(Context c) {
        return sp(c).getString("key", "");
    }

    static void setConnection(Context c, String url, String key) {
        sp(c).edit().putString("url", cleanUrl(url)).putString("key", key == null ? "" : key.trim()).apply();
    }

    static boolean configured(Context c) {
        return !baseUrl(c).isEmpty() && !key(c).isEmpty();
    }

    static void setSync(Context c, long whenMs, boolean ok, String message) {
        SharedPreferences.Editor e = sp(c).edit().putLong("syncAt", whenMs).putString("syncMsg", message).putBoolean("syncOk", ok);
        if (ok) e.putLong("syncOkAt", whenMs);
        e.apply();
    }

    static long lastSyncMs(Context c) {
        return sp(c).getLong("syncAt", 0L);
    }

    static long lastOkSyncMs(Context c) {
        return sp(c).getLong("syncOkAt", 0L);
    }

    static boolean lastSyncOk(Context c) {
        return sp(c).getBoolean("syncOk", false);
    }

    static String lastSyncMessage(Context c) {
        return sp(c).getString("syncMsg", "");
    }

    static void setNextSync(Context c, long whenMs) {
        sp(c).edit().putLong("nextSync", whenMs).apply();
    }

    static long nextSyncMs(Context c) {
        return sp(c).getLong("nextSync", 0L);
    }

    /** An app update found by the background check (0 = none). */
    static void setUpdate(Context c, long code, String name) {
        sp(c).edit().putLong("updCode", code).putString("updName", name == null ? "" : name).apply();
    }

    static long updateCode(Context c) {
        return sp(c).getLong("updCode", 0L);
    }

    /** The alarm sound: "" = the phone's default alarm, "raw:name" = one bundled in the app, "uri:..." = picked on the phone. */
    static String sound(Context c) {
        return sp(c).getString("sound", "raw:sunrise");
    }

    static void setSound(Context c, String choice) {
        sp(c).edit().putString("sound", choice == null ? "" : choice).apply();
    }

    static String soundName(Context c) {
        return sp(c).getString("soundName", "");
    }

    static void setSoundName(Context c, String name) {
        sp(c).edit().putString("soundName", name == null ? "" : name).apply();
    }

    /** Start quiet and get louder over about 30 seconds. */
    static boolean ramp(Context c) {
        return sp(c).getBoolean("ramp", true);
    }

    static void setRamp(Context c, boolean on) {
        sp(c).edit().putBoolean("ramp", on).apply();
    }

    static List<AlarmItem> alarms(Context c) {
        List<AlarmItem> out = new ArrayList<>();
        try {
            JSONArray arr = new JSONArray(sp(c).getString("alarms", "[]"));
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                out.add(AlarmItem.fromJson(o));
            }
        } catch (Exception ignored) {
            // a damaged list is treated as empty; the next sync rebuilds it
        }
        return out;
    }

    static void setAlarms(Context c, List<AlarmItem> list) {
        JSONArray arr = new JSONArray();
        try {
            for (AlarmItem a : list) arr.put(a.toJson());
        } catch (Exception ignored) {
            // toJson only fails on invalid numbers, which cannot happen here
        }
        sp(c).edit().putString("alarms", arr.toString()).apply();
    }
}
