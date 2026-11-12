package app.personalos.alarms;

import android.content.Intent;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** One alarm: it comes from Personal OS, or it is a snooze / test alarm made on the phone. */
final class AlarmItem {
    final String id;
    final String title;
    final String date;
    final String start;
    final String end;
    final String note;
    final long startsAtMs;
    final long alarmAtMs;
    final int minutesBefore;
    /** The block's habits and tasks, one per line ("" = none). */
    final String habits;
    final String tasks;

    AlarmItem(String id, String title, String date, String start, String end, String note,
              long startsAtMs, long alarmAtMs, int minutesBefore) {
        this(id, title, date, start, end, note, startsAtMs, alarmAtMs, minutesBefore, "", "");
    }

    AlarmItem(String id, String title, String date, String start, String end, String note,
              long startsAtMs, long alarmAtMs, int minutesBefore, String habits, String tasks) {
        this.habits = habits == null ? "" : habits;
        this.tasks = tasks == null ? "" : tasks;
        this.id = id == null ? "" : id;
        this.title = title == null ? "" : title;
        this.date = date == null ? "" : date;
        this.start = start == null ? "" : start;
        this.end = end == null ? "" : end;
        this.note = note == null ? "" : note;
        this.startsAtMs = startsAtMs;
        this.alarmAtMs = alarmAtMs;
        this.minutesBefore = minutesBefore;
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
                o.optLong("alarmAtMs"),
                o.optInt("minutesBefore"),
                lines(o, "habits"),
                lines(o, "tasks"));
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
        o.put("alarmAtMs", alarmAtMs);
        o.put("minutesBefore", minutesBefore);
        o.put("habits", habits);
        o.put("tasks", tasks);
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
        i.putExtra("alarmAtMs", alarmAtMs);
        i.putExtra("minutesBefore", minutesBefore);
        i.putExtra("habits", habits);
        i.putExtra("tasks", tasks);
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
                i.getLongExtra("alarmAtMs", 0L),
                i.getIntExtra("minutesBefore", 0),
                i.getStringExtra("habits"),
                i.getStringExtra("tasks"));
    }

    /** "07:00 - 08:00", or empty for alarms that have no block times (test). */
    String timeRange() {
        if (start.isEmpty()) return "";
        return end.isEmpty() ? start : start + " - " + end;
    }
}
