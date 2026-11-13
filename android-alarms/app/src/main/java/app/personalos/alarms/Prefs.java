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
        return sp(c).getString("sound", "raw:rooster");
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

    // ---- Chains the user already answered ("I'm up" / "Got it") ----------------------------------
    // A sync brings the whole schedule again; without this note it would ring the rest of an answered chain.

    private static JSONObject ackedMap(Context c) {
        try {
            JSONObject o = new JSONObject(sp(c).getString("acked", "{}"));
            long now = System.currentTimeMillis();
            java.util.Iterator<String> it = o.keys();
            List<String> old = new ArrayList<>();
            while (it.hasNext()) {
                String k = it.next();
                if (o.optLong(k, 0L) < now) old.add(k);
            }
            for (String k : old) o.remove(k);
            return o;
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    static void ackChain(Context c, String chain) {
        if (chain == null || chain.isEmpty()) return;
        try {
            JSONObject o = ackedMap(c);
            o.put(chain, System.currentTimeMillis() + 3L * 86_400_000L);
            sp(c).edit().putString("acked", o.toString()).apply();
        } catch (Exception ignored) {
            // the rest of the chain may ring once more; nothing else is affected
        }
    }

    static boolean isAcked(Context c, String chain) {
        return chain != null && !chain.isEmpty() && ackedMap(c).has(chain);
    }

    // ---- Answers waiting to reach Personal OS (sent again until accepted) -----------------------

    static synchronized JSONArray pendingEvents(Context c) {
        try {
            return new JSONArray(sp(c).getString("events", "[]"));
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    static synchronized void addEvent(Context c, JSONObject ev) {
        JSONArray arr = pendingEvents(c);
        arr.put(ev);
        // Keep the newest 300 if the phone is offline for a long time
        JSONArray keep = new JSONArray();
        for (int i = Math.max(0, arr.length() - 300); i < arr.length(); i++) keep.put(arr.opt(i));
        sp(c).edit().putString("events", keep.toString()).apply();
    }

    /** Removes the events Personal OS accepted (by their client id). */
    static synchronized void removeEvents(Context c, java.util.Set<String> accepted) {
        JSONArray arr = pendingEvents(c);
        JSONArray keep = new JSONArray();
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o != null && !accepted.contains(o.optString("clientId"))) keep.put(o);
        }
        sp(c).edit().putString("events", keep.toString()).apply();
    }

    // ---- Ticks made on the alarm (so the list stays ticked while it rings) -----------------------

    static boolean ticked(Context c, String key) {
        return sp(c).getStringSet("ticked", java.util.Collections.<String>emptySet()).contains(key);
    }

    static void setTicked(Context c, String key, boolean on) {
        java.util.Set<String> cur = new java.util.HashSet<>(sp(c).getStringSet("ticked", java.util.Collections.<String>emptySet()));
        if (on) cur.add(key);
        else cur.remove(key);
        // Old ticks are of no use after a while: keep the list short
        if (cur.size() > 200) cur.clear();
        sp(c).edit().putStringSet("ticked", cur).apply();
    }

    // ---- Morning check-in and sleep ----------------------------------------------------------------

    static boolean checkinDone(Context c, String date) {
        return date != null && date.equals(sp(c).getString("checkinDone", ""));
    }

    static void setCheckinDone(Context c, String date) {
        sp(c).edit().putString("checkinDone", date).putString("checkinPending", "").apply();
    }

    /** The day whose check-in was started (the alarm said "I'm up") but not saved yet ("" = none). */
    static String checkinPending(Context c) {
        return sp(c).getString("checkinPending", "");
    }

    static void setCheckinPending(Context c, String date) {
        sp(c).edit().putString("checkinPending", date == null ? "" : date).apply();
    }

    /** When "Going to sleep" was last tapped on this phone (0 = never), and when "I'm up" was. */
    static long sleptAt(Context c) {
        return sp(c).getLong("sleptAt", 0L);
    }

    static void setSleptAt(Context c, long ms) {
        sp(c).edit().putLong("sleptAt", ms).apply();
    }

    static long wokeAt(Context c) {
        return sp(c).getLong("wokeAt", 0L);
    }

    static void setWokeAt(Context c, long ms) {
        sp(c).edit().putLong("wokeAt", ms).apply();
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
