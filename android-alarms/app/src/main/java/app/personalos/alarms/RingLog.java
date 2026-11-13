package app.personalos.alarms;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;

/**
 * A short diary of what happened to the alarms on this phone: the alarm time was reached, the sound
 * started, the alarm screen opened, or something was refused or never happened. It also keeps the
 * steps the user ticked by hand ("I did it") for the Xiaomi settings the app cannot read.
 */
final class RingLog {
    private RingLog() {}

    static final String INFO = "info";
    static final String OK = "ok";
    static final String WARN = "warn";
    static final String BAD = "bad";

    private static final int MAX = 80;
    private static final long KEEP_MS = 3L * 86_400_000L;

    static final class Entry {
        final long t;
        final String kind;
        final String text;

        Entry(long t, String kind, String text) {
            this.t = t;
            this.kind = kind;
            this.text = text;
        }
    }

    private static SharedPreferences sp(Context c) {
        return c.getApplicationContext().getSharedPreferences("pos_ringlog", Context.MODE_PRIVATE);
    }

    // ---- The diary ---------------------------------------------------------------------------------

    static synchronized void add(Context c, String kind, String text) {
        try {
            JSONArray arr = new JSONArray(sp(c).getString("log", "[]"));
            long now = System.currentTimeMillis();
            JSONObject last = arr.length() > 0 ? arr.optJSONObject(arr.length() - 1) : null;
            // The same line again within 10 minutes (a failing sync) is not repeated
            if (last != null && text.equals(last.optString("x")) && kind.equals(last.optString("k"))
                    && now - last.optLong("t") < 600_000L) {
                return;
            }
            JSONObject o = new JSONObject();
            o.put("t", now);
            o.put("k", kind);
            o.put("x", text);
            arr.put(o);
            JSONArray keep = new JSONArray();
            for (int i = Math.max(0, arr.length() - MAX); i < arr.length(); i++) keep.put(arr.opt(i));
            sp(c).edit().putString("log", keep.toString()).apply();
        } catch (Exception ignored) {
            // the diary is only a help; never let it break an alarm
        }
    }

    /** Newest first. */
    static synchronized List<Entry> entries(Context c) {
        List<Entry> out = new ArrayList<>();
        try {
            JSONArray arr = new JSONArray(sp(c).getString("log", "[]"));
            for (int i = arr.length() - 1; i >= 0; i--) {
                JSONObject o = arr.optJSONObject(i);
                if (o != null) out.add(new Entry(o.optLong("t"), o.optString("k", INFO), o.optString("x")));
            }
        } catch (Exception ignored) {
            // damaged diary = empty diary
        }
        return out;
    }

    static synchronized void clear(Context c) {
        sp(c).edit().remove("log").apply();
    }

    // ---- Which alarms really fired ------------------------------------------------------------------

    private static JSONObject marks(Context c) {
        try {
            JSONObject o = new JSONObject(sp(c).getString("marks", "{}"));
            long now = System.currentTimeMillis();
            List<String> old = new ArrayList<>();
            Iterator<String> it = o.keys();
            while (it.hasNext()) {
                String k = it.next();
                if (o.optLong(k, 0L) < now - KEEP_MS) old.add(k);
            }
            for (String k : old) o.remove(k);
            return o;
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private static synchronized void mark(Context c, String key) {
        try {
            JSONObject o = marks(c);
            o.put(key, System.currentTimeMillis());
            sp(c).edit().putString("marks", o.toString()).apply();
        } catch (Exception ignored) {
            // see add()
        }
    }

    private static boolean marked(Context c, String key) {
        return marks(c).has(key);
    }

    static String label(AlarmItem a) {
        if (a == null) return "Alarm";
        if ("test".equals(a.id)) return "Test alarm";
        SimpleDateFormat hm = new SimpleDateFormat("HH:mm", Locale.getDefault());
        String title = a.title == null || a.title.isEmpty() ? "Alarm" : a.title;
        return title + " (" + hm.format(new Date(a.alarmAtMs)) + ")";
    }

    private static String lateText(long ms) {
        long s = ms / 1000L;
        if (s < 120) return s + " s";
        return (s / 60L) + " min";
    }

    /** The system handed the alarm to the app: it did arrive, whatever happens next. */
    static void fire(Context c, AlarmItem a) {
        if (a == null) return;
        mark(c, "f:" + a.id);
        long late = System.currentTimeMillis() - a.alarmAtMs;
        if (late > 90_000L) {
            add(c, WARN, label(a) + " arrived " + lateText(late) + " late. The phone held it back.");
        } else {
            add(c, INFO, "Alarm time reached: " + label(a) + ".");
        }
    }

    /**
     * Alarms that were set, whose time passed (more than 3 minutes ago, within 36 hours) and that never
     * reached the app. Call before a sync replaces the stored list.
     */
    static synchronized void flagMissed(Context c) {
        long now = System.currentTimeMillis();
        for (AlarmItem a : Prefs.alarms(c)) {
            if (a.alarmAtMs > now - 180_000L || a.alarmAtMs < now - 36L * 3_600_000L) continue;
            if (marked(c, "f:" + a.id) || marked(c, "m:" + a.id)) continue;
            if (Prefs.isAcked(c, a.chain)) continue;
            mark(c, "m:" + a.id);
            add(c, BAD, "NEVER RANG: " + label(a) + ". The phone did not hand the alarm to the app "
                    + "(Autostart, battery limits, or the phone was off).");
        }
    }

    // ---- Steps the user ticked by hand --------------------------------------------------------------

    static boolean manual(Context c, String key) {
        return sp(c).getBoolean("manual_" + key, false);
    }

    static void setManual(Context c, String key, boolean on) {
        sp(c).edit().putBoolean("manual_" + key, on).apply();
    }
}
