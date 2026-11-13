package app.personalos.alarms;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

/**
 * What the phone tells Personal OS: each ring, each answer (Started, Skip today, Done...), each tick,
 * the morning check-in and "Going to sleep". Everything goes into a queue first (so nothing is lost
 * without internet) and is sent in the background; Personal OS ignores an event it already has.
 */
final class Answers {
    private Answers() {}

    // Answers of a ring of the start of a block
    static final String STARTED = "started";
    static final String SKIP = "skip";
    static final String ALREADY_DONE = "already_done";
    // Answers of a ring of the end of a block
    static final String DONE = "done";
    static final String PARTIAL = "partial";
    static final String NOT_DONE = "not_done";
    // Only the sound (the block is untouched)
    static final String SILENCE = "silence";
    static final String SNOOZE = "snooze";
    static final String DISMISS = "dismiss";
    static final String MISSED = "missed";

    private static JSONObject base(String kind, AlarmItem a) throws Exception {
        JSONObject o = new JSONObject();
        o.put("clientId", UUID.randomUUID().toString());
        o.put("kind", kind);
        o.put("at", System.currentTimeMillis());
        if (a != null) {
            o.put("occurrenceId", a.occurrenceId);
            o.put("blockTypeId", a.blockTypeId);
            o.put("chain", a.chain);
            o.put("seq", a.seq);
            o.put("total", a.total);
            o.put("anchor", a.anchor);
            o.put("style", a.style);
            o.put("alarmAt", a.alarmAtMs);
            if (a.wake) o.put("wake", true);
            if (a.bed) o.put("bed", true);
        }
        return o;
    }

    private static void save(Context c, JSONObject ev) {
        Prefs.addEvent(c, ev);
        final Context app = c.getApplicationContext();
        new Thread(() -> flush(app)).start();
    }

    /** A ring went off. Test alarms (no block) are not sent. */
    static void rang(Context c, AlarmItem a) {
        if (a == null || a.occurrenceId.isEmpty()) return;
        try {
            save(c, base("rang", a));
        } catch (Exception ignored) {
            // an answer that can't be written is simply not sent
        }
    }

    static void answer(Context c, AlarmItem a, String answer) {
        if (a == null || a.occurrenceId.isEmpty()) return;
        try {
            JSONObject o = base("answer", a);
            o.put("answer", answer);
            save(c, o);
        } catch (Exception ignored) {
            // see rang()
        }
    }

    /** A habit or a task ticked (or unticked) on the alarm screen. */
    static void tick(Context c, AlarmItem a, AlarmItem.Tick t, boolean done) {
        if (a == null || t == null) return;
        try {
            JSONObject o = base("tick", a);
            o.put(t.isHabit ? "habitId" : "taskId", t.id);
            o.put("done", done);
            save(c, o);
        } catch (Exception ignored) {
            // see rang()
        }
    }

    /** "Going to sleep": this moment is the bedtime. */
    static void sleep(Context c) {
        try {
            Prefs.setSleptAt(c, System.currentTimeMillis());
            save(c, base("sleep", null));
        } catch (Exception ignored) {
            // see rang()
        }
    }

    /** The morning check-in. The highlight is optional ("" = none). */
    static void checkin(Context c, String date, int mood, int energy, int sleepQuality, String highlight) {
        try {
            JSONObject o = base("checkin", null);
            o.put("date", date);
            o.put("mood", mood);
            o.put("energy", energy);
            o.put("sleepQuality", sleepQuality);
            if (highlight != null && !highlight.trim().isEmpty()) o.put("highlight", highlight.trim());
            save(c, o);
        } catch (Exception ignored) {
            // see rang()
        }
    }

    /** Sends the queue. Call off the main thread. Events stay queued until Personal OS answers 200. */
    static synchronized void flush(Context ctx) {
        Context c = ctx.getApplicationContext();
        JSONArray events = Prefs.pendingEvents(c);
        if (events.length() == 0 || !Prefs.configured(c)) return;
        HttpURLConnection con = null;
        try {
            JSONArray batch = new JSONArray();
            for (int i = 0; i < events.length() && i < 100; i++) batch.put(events.get(i));
            JSONObject body = new JSONObject();
            body.put("events", batch);
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);

            con = (HttpURLConnection) new URL(Prefs.baseUrl(c) + "/api/alarms/answer").openConnection();
            con.setConnectTimeout(15000);
            con.setReadTimeout(30000);
            con.setRequestMethod("POST");
            con.setDoOutput(true);
            con.setRequestProperty("Authorization", "Bearer " + Prefs.key(c));
            con.setRequestProperty("Content-Type", "application/json");
            try (OutputStream out = con.getOutputStream()) {
                out.write(bytes);
            }
            if (con.getResponseCode() != 200) return; // try again at the next flush
            JSONObject res = new JSONObject(Sync.read(con.getInputStream()));
            JSONArray results = res.optJSONArray("results");
            Set<String> accepted = new HashSet<>();
            if (results != null) {
                for (int i = 0; i < results.length(); i++) {
                    JSONObject r = results.optJSONObject(i);
                    if (r != null && r.optBoolean("ok", false)) accepted.add(r.optString("clientId"));
                }
            }
            if (!accepted.isEmpty()) Prefs.removeEvents(c, accepted);
        } catch (Exception ignored) {
            // no internet: the queue waits for the next try (each ring, each sync, each answer)
        } finally {
            if (con != null) con.disconnect();
        }
    }
}
