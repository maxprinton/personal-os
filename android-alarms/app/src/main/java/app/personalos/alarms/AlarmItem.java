package app.personalos.alarms;

import android.content.Intent;

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

    AlarmItem(String id, String title, String date, String start, String end, String note,
              long startsAtMs, long alarmAtMs, int minutesBefore) {
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
                o.optInt("minutesBefore"));
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
                i.getIntExtra("minutesBefore", 0));
    }

    /** "07:00 - 08:00", or empty for alarms that have no block times (test). */
    String timeRange() {
        if (start.isEmpty()) return "";
        return end.isEmpty() ? start : start + " - " + end;
    }
}
