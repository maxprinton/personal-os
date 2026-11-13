package app.personalos.alarms;

import android.content.Intent;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * One ring of an alarm: it comes from Personal OS, or it is a snooze / test alarm made on the phone.
 * A rule can ring several times in a row (a "chain": the first ring and its repeats); every ring of the
 * chain shares the same {@link #chain} text, so "I'm up" can cancel the rest of it.
 */
final class AlarmItem {
    final String id;
    final String title;
    final String date;
    final String start;
    final String end;
    final String note;
    final long startsAtMs;
    final long endsAtMs;
    final long alarmAtMs;
    final int minutesBefore;
    /** The block's habits and tasks, one per line ("" = none). */
    final String habits;
    final String tasks;
    /** Same for every ring of one chain ("" = not part of a chain). */
    final String chain;
    /** Position in the chain (0 = first ring) and how many rings it has. */
    final int seq;
    final int total;
    /** "start" or "end" of the block: what the ring is counted from. */
    final String anchor;
    /** "default" (the sound chosen in the app) or the id of a bundled sound. */
    final String sound;
    /** "alarm" = full screen until answered; "notify" = a banner with a sound, no takeover. */
    final String style;
    /** 0 normal, 1 louder, 2 or more = full volume at once. */
    final int level;
    /** Minutes between the rings of the chain (0 = a single ring). */
    final int every;

    AlarmItem(String id, String title, String date, String start, String end, String note,
              long startsAtMs, long alarmAtMs, int minutesBefore) {
        this(id, title, date, start, end, note, startsAtMs, alarmAtMs, minutesBefore, "", "");
    }

    AlarmItem(String id, String title, String date, String start, String end, String note,
              long startsAtMs, long alarmAtMs, int minutesBefore, String habits, String tasks) {
        this(id, title, date, start, end, note, startsAtMs, 0L, alarmAtMs, minutesBefore, habits, tasks,
                "", 0, 1, "start", "default", "alarm", 0, 0);
    }

    AlarmItem(String id, String title, String date, String start, String end, String note,
              long startsAtMs, long endsAtMs, long alarmAtMs, int minutesBefore, String habits, String tasks,
              String chain, int seq, int total, String anchor, String sound, String style, int level, int every) {
        this.habits = habits == null ? "" : habits;
        this.tasks = tasks == null ? "" : tasks;
        this.id = id == null ? "" : id;
        this.title = title == null ? "" : title;
        this.date = date == null ? "" : date;
        this.start = start == null ? "" : start;
        this.end = end == null ? "" : end;
        this.note = note == null ? "" : note;
        this.startsAtMs = startsAtMs;
        this.endsAtMs = endsAtMs;
        this.alarmAtMs = alarmAtMs;
        this.minutesBefore = minutesBefore;
        this.chain = chain == null ? "" : chain;
        this.seq = Math.max(0, seq);
        this.total = Math.max(1, total);
        this.anchor = "end".equals(anchor) ? "end" : "start";
        this.sound = sound == null || sound.isEmpty() ? "default" : sound;
        this.style = "notify".equals(style) ? "notify" : "alarm";
        this.level = Math.max(0, level);
        this.every = Math.max(0, every);
    }

    static AlarmItem fromJson(JSONObject o) {
        return new AlarmItem(
                o.optString("id"),
                o.optString("title", "Block"),
                o.optString("date"),
                o.optString("start"),
                o.optString("end"),
                o.optString("note"),
                o.optLong("startsAtMs"),
                o.optLong("endsAtMs"),
                o.optLong("alarmAtMs"),
                o.optInt("minutesBefore"),
                lines(o, "habits"),
                lines(o, "tasks"),
                o.optString("chain", ""),
                o.optInt("seq", 0),
                o.optInt("total", 1),
                o.optString("anchor", "start"),
                o.optString("sound", "default"),
                o.optString("style", "alarm"),
                o.optInt("level", 0),
                o.optInt("every", 0));
    }

    /** A JSON list (from Personal OS) or a stored string -> one item per line. */
    private static String lines(JSONObject o, String key) {
        JSONArray arr = o.optJSONArray(key);
        if (arr == null) return o.optString(key, "");
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < arr.length(); i++) {
            String s = arr.optString(i, "").trim();
            if (s.isEmpty()) continue;
            if (sb.length() > 0) sb.append("\n");
            sb.append(s);
        }
        return sb.toString();
    }

    /** What the alarm shows under the block name: its habits and its tasks. */
    String details() {
        StringBuilder sb = new StringBuilder();
        if (!habits.isEmpty()) sb.append("Habits\n").append(bullets(habits));
        if (!tasks.isEmpty()) {
            if (sb.length() > 0) sb.append("\n\n");
            sb.append("Tasks\n").append(bullets(tasks));
        }
        return sb.toString();
    }

    private static String bullets(String list) {
        StringBuilder sb = new StringBuilder();
        for (String line : list.split("\n")) {
            if (sb.length() > 0) sb.append("\n");
            sb.append("- ").append(line);
        }
        return sb.toString();
    }

    JSONObject toJson() throws JSONException {
        JSONObject o = new JSONObject();
        o.put("id", id);
        o.put("title", title);
        o.put("date", date);
        o.put("start", start);
        o.put("end", end);
        o.put("note", note);
        o.put("startsAtMs", startsAtMs);
        o.put("endsAtMs", endsAtMs);
        o.put("alarmAtMs", alarmAtMs);
        o.put("minutesBefore", minutesBefore);
        o.put("habits", habits);
        o.put("tasks", tasks);
        o.put("chain", chain);
        o.put("seq", seq);
        o.put("total", total);
        o.put("anchor", anchor);
        o.put("sound", sound);
        o.put("style", style);
        o.put("level", level);
        o.put("every", every);
        return o;
    }

    void putInto(Intent i) {
        i.putExtra("id", id);
        i.putExtra("title", title);
        i.putExtra("date", date);
        i.putExtra("start", start);
        i.putExtra("end", end);
        i.putExtra("note", note);
        i.putExtra("startsAtMs", startsAtMs);
        i.putExtra("endsAtMs", endsAtMs);
        i.putExtra("alarmAtMs", alarmAtMs);
        i.putExtra("minutesBefore", minutesBefore);
        i.putExtra("habits", habits);
        i.putExtra("tasks", tasks);
        i.putExtra("chain", chain);
        i.putExtra("seq", seq);
        i.putExtra("total", total);
        i.putExtra("anchor", anchor);
        i.putExtra("sound", sound);
        i.putExtra("style", style);
        i.putExtra("level", level);
        i.putExtra("every", every);
    }

    static AlarmItem from(Intent i) {
        if (i == null || !i.hasExtra("id")) return null;
        return new AlarmItem(
                i.getStringExtra("id"),
                i.getStringExtra("title"),
                i.getStringExtra("date"),
                i.getStringExtra("start"),
                i.getStringExtra("end"),
                i.getStringExtra("note"),
                i.getLongExtra("startsAtMs", 0L),
                i.getLongExtra("endsAtMs", 0L),
                i.getLongExtra("alarmAtMs", 0L),
                i.getIntExtra("minutesBefore", 0),
                i.getStringExtra("habits"),
                i.getStringExtra("tasks"),
                i.getStringExtra("chain"),
                i.getIntExtra("seq", 0),
                i.getIntExtra("total", 1),
                i.getStringExtra("anchor"),
                i.getStringExtra("sound"),
                i.getStringExtra("style"),
                i.getIntExtra("level", 0),
                i.getIntExtra("every", 0));
    }

    /** The same ring at another time (a snooze). It keeps the chain, so "I'm up" still cancels it. */
    AlarmItem snoozedTo(String newId, long when) {
        return new AlarmItem(newId, title, date, start, end, note, startsAtMs, endsAtMs, when, minutesBefore,
                habits, tasks, chain, seq, total, anchor, sound, style, level, every);
    }

    boolean isNotify() {
        return "notify".equals(style);
    }

    boolean isEnd() {
        return "end".equals(anchor);
    }

    /** True when more rings of this chain are still to come (so silencing this one is not the end). */
    boolean hasMore() {
        return seq < total - 1;
    }

    /** "07:00 - 08:00", or empty for alarms that have no block times (test). */
    String timeRange() {
        if (start.isEmpty()) return "";
        return end.isEmpty() ? start : start + " - " + end;
    }

    /** "Starts in 5 min", "Ends now", "Started 3 min ago": where this ring is, counted from its anchor. */
    String whenLabel(long now) {
        long ref = isEnd() ? endsAtMs : startsAtMs;
        if (ref <= 0) return "";
        long diff = Math.round((ref - now) / 60000.0);
        String future = isEnd() ? "Ends" : "Starts";
        String past = isEnd() ? "Ended" : "Started";
        if (diff > 0) return future + " in " + diff + " min";
        if (diff == 0) return future + " now";
        return past + " " + (-diff) + " min ago";
    }

    /** "Ring 2 of 4" for a chain, empty for a single ring. */
    String ringLabel() {
        return total > 1 ? "Ring " + (seq + 1) + " of " + total : "";
    }
}
