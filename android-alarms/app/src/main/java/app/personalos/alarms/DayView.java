package app.personalos.alarms;

import android.app.Activity;
import android.app.DatePickerDialog;
import android.graphics.Typeface;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.TextStyle;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * The "Alarms" card of the home screen, one day at a time (BL-110, 17 Nov 2026).
 * Decisions: ‹ day › arrows + day chips (Yesterday, Today, Tomorrow, next days) + tap the date for a
 * calendar. Today and the next 6 days work offline from what the phone already has; Today also asks
 * Personal OS for the rings that already happened (faded at the top, with your answer). Past days and
 * days after the next 6 come from Personal OS (needs internet: "Needs internet" + Retry). A chain of
 * rings is one row; tap it to see each ring. A past ring that never rang is flagged "Didn't ring".
 */
final class DayView {
    private static final int LOCAL_DAYS = 6; // today + 6 = what the phone syncs (7 days)

    private final Activity a;
    private final LinearLayout box;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final TextView dateLabel;
    private final LinearLayout chips;
    private final LinearLayout list;
    private LocalDate day = LocalDate.now();
    /** Days already read from Personal OS in this session. */
    private final Map<String, List<Row>> cache = new HashMap<>();
    private final java.util.Set<String> expanded = new java.util.HashSet<>();
    private int loadToken = 0;

    /** One row of the list = one chain of rings. */
    static final class Row {
        String key = "";
        String title = "Alarm";
        String anchor = "start";
        String style = "alarm";
        int minutesBefore;
        int every;
        String state = "upcoming"; // upcoming | rang | didnt_ring | mixed | untracked
        String answer = "";
        boolean unplanned;
        final List<long[]> rings = new ArrayList<>(); // {atMs, statusCode}
        long first() {
            return rings.isEmpty() ? 0 : rings.get(0)[0];
        }
    }

    // ring status codes
    static final int UPCOMING = 0, RANG = 1, DIDNT = 2, STOPPED = 3, UNTRACKED = 4;

    DayView(Activity activity, LinearLayout card) {
        this.a = activity;
        this.box = card;

        LinearLayout nav = new LinearLayout(a);
        nav.setOrientation(LinearLayout.HORIZONTAL);
        nav.setGravity(Gravity.CENTER_VERTICAL);
        nav.addView(arrow("‹", v -> show(day.minusDays(1))));
        dateLabel = Ui.text(a, "", 16, Ui.TEXT, true);
        dateLabel.setGravity(Gravity.CENTER);
        dateLabel.setPadding(0, dp(10), 0, dp(10));
        dateLabel.setOnClickListener(v -> pickDate());
        nav.addView(dateLabel, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        nav.addView(arrow("›", v -> show(day.plusDays(1))));
        box.addView(nav);

        HorizontalScrollView hs = new HorizontalScrollView(a);
        hs.setHorizontalScrollBarEnabled(false);
        chips = new LinearLayout(a);
        chips.setOrientation(LinearLayout.HORIZONTAL);
        hs.addView(chips);
        box.addView(hs, Ui.wrap(a, 4));

        list = new LinearLayout(a);
        list.setOrientation(LinearLayout.VERTICAL);
        box.addView(list, Ui.wrap(a, 8));
    }

    /** Redraw the day shown (after a sync, or when the app comes back). Today stays today. */
    void refresh() {
        cache.remove(LocalDate.now().toString());
        show(day);
    }

    void showToday() {
        show(LocalDate.now());
    }

    void show(LocalDate d) {
        day = d;
        LocalDate today = LocalDate.now();
        drawHeader(today);
        list.removeAllViews();
        int token = ++loadToken;
        long dayDiff = d.toEpochDay() - today.toEpochDay();
        String key = d.toString();

        if (dayDiff >= 0 && dayDiff <= LOCAL_DAYS) {
            // What the phone already has: works offline
            List<Row> local = localRows(d);
            if (dayDiff == 0) {
                List<Row> cached = cache.get(key);
                if (cached != null) {
                    draw(cached, today, null);
                    return;
                }
                draw(local, today, "Loading what already rang today…");
                fetch(key, token, rows -> draw(rows, today, null),
                        () -> draw(local, today, "Earlier rings of today need internet."));
            } else {
                draw(local, today, null);
            }
            return;
        }
        List<Row> cached = cache.get(key);
        if (cached != null) {
            draw(cached, today, null);
            return;
        }
        list.addView(Ui.text(a, "Loading…", 14, Ui.MUTED, false));
        fetch(key, token, rows -> draw(rows, today, null), () -> {
            list.removeAllViews();
            list.addView(Ui.text(a, "Needs internet: this day comes from Personal OS.", 14, Ui.MUTED, false));
            list.addView(Ui.smallButton(a, "Retry", v -> show(day)), Ui.wrap(a, 8));
        });
    }

    // ---------------------------------------------------------------- header

    private void drawHeader(LocalDate today) {
        long diff = day.toEpochDay() - today.toEpochDay();
        String name = diff == 0 ? "Today" : diff == 1 ? "Tomorrow" : diff == -1 ? "Yesterday" : null;
        String date = day.format(DateTimeFormatter.ofPattern("EEE d MMM", Locale.getDefault()));
        if (day.getYear() != today.getYear()) date += " " + day.getYear();
        dateLabel.setText(name != null ? name + " · " + date : date);

        chips.removeAllViews();
        for (int i = -1; i <= 4; i++) {
            LocalDate c = today.plusDays(i);
            String label = i == -1 ? "Yesterday" : i == 0 ? "Today" : i == 1 ? "Tomorrow"
                    : c.getDayOfWeek().getDisplayName(TextStyle.SHORT, Locale.getDefault()) + " " + c.getDayOfMonth();
            chips.addView(chip(label, c.equals(day), v -> show(c)));
        }
    }

    private TextView chip(String label, boolean on, View.OnClickListener l) {
        TextView t = Ui.text(a, label, 13, on ? 0xFFFFFFFF : Ui.TEXT, on);
        t.setBackground(on ? Ui.round(a, Ui.ACCENT, 14) : Ui.outline(a, Ui.CARD, Ui.CARD_HI, 14));
        t.setPadding(dp(12), dp(7), dp(12), dp(7));
        t.setOnClickListener(l);
        LinearLayout.LayoutParams p = Ui.lp(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        p.rightMargin = dp(6);
        t.setLayoutParams(p);
        return t;
    }

    private TextView arrow(String s, View.OnClickListener l) {
        TextView t = Ui.text(a, s, 28, Ui.TEXT, true);
        t.setPadding(dp(14), 0, dp(14), dp(4));
        t.setOnClickListener(l);
        return t;
    }

    private void pickDate() {
        DatePickerDialog dlg = new DatePickerDialog(a, (picker, y, m, d) -> show(LocalDate.of(y, m + 1, d)),
                day.getYear(), day.getMonthValue() - 1, day.getDayOfMonth());
        dlg.show();
    }

    // ---------------------------------------------------------------- data

    /** Rings the phone already has for that day, grouped by chain (only those still to come). */
    private List<Row> localRows(LocalDate d) {
        long now = System.currentTimeMillis();
        Map<String, Row> byChain = new LinkedHashMap<>();
        List<AlarmItem> items = new ArrayList<>(Prefs.alarms(a));
        Collections.sort(items, (x, y) -> Long.compare(x.alarmAtMs, y.alarmAtMs));
        for (AlarmItem it : items) {
            if (it.alarmAtMs <= now) continue;
            LocalDate ringDay = java.time.Instant.ofEpochMilli(it.alarmAtMs).atZone(java.time.ZoneId.systemDefault()).toLocalDate();
            if (!ringDay.equals(d)) continue;
            String k = it.chain.isEmpty() ? "one:" + it.id : it.chain;
            Row r = byChain.get(k);
            if (r == null) {
                r = new Row();
                r.key = k;
                r.title = it.title.isEmpty() ? "Alarm" : it.title;
                r.anchor = it.id.startsWith("nag:") ? "event" : it.anchor;
                r.style = it.style;
                r.minutesBefore = it.minutesBefore;
                r.every = it.every;
                byChain.put(k, r);
            }
            r.rings.add(new long[]{it.alarmAtMs, UPCOMING});
        }
        return new ArrayList<>(byChain.values());
    }

    interface Done { void ok(List<Row> rows); }

    /** GET /api/alarms/day?date= in the background; results are kept for this session. */
    private void fetch(String date, int token, Done done, Runnable failed) {
        String base = Prefs.baseUrl(a);
        String key = Prefs.key(a);
        if (base.isEmpty() || key.isEmpty()) {
            ui.post(failed);
            return;
        }
        new Thread(() -> {
            HttpURLConnection con = null;
            List<Row> rows = null;
            try {
                con = (HttpURLConnection) new URL(base + "/api/alarms/day?date=" + date).openConnection();
                con.setConnectTimeout(15000);
                con.setReadTimeout(25000);
                con.setRequestProperty("Authorization", "Bearer " + key);
                con.setRequestProperty("Accept", "application/json");
                if (con.getResponseCode() == 200) rows = parse(new JSONObject(Sync.read(con.getInputStream())));
            } catch (Exception ignored) {
                rows = null;
            } finally {
                if (con != null) con.disconnect();
            }
            final List<Row> result = rows;
            ui.post(() -> {
                if (token != loadToken) return; // the user already moved to another day
                if (result == null) {
                    failed.run();
                    return;
                }
                cache.put(date, result);
                done.ok(result);
            });
        }).start();
    }

    private static List<Row> parse(JSONObject root) throws Exception {
        List<Row> out = new ArrayList<>();
        JSONArray arr = root.optJSONArray("chains");
        if (arr == null) return out;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.getJSONObject(i);
            Row r = new Row();
            r.key = o.optString("key", "c" + i);
            r.title = o.optString("title", "Alarm");
            r.anchor = o.optString("anchor", "start");
            r.style = o.optString("style", "alarm");
            r.minutesBefore = o.optInt("minutesBefore", 0);
            r.every = o.optInt("every", 0);
            r.state = o.optString("state", "upcoming");
            r.answer = o.isNull("answer") ? "" : o.optString("answer", "");
            r.unplanned = o.optBoolean("unplanned", false);
            JSONArray rings = o.optJSONArray("rings");
            if (rings != null) {
                for (int k = 0; k < rings.length(); k++) {
                    JSONObject g = rings.getJSONObject(k);
                    String s = g.optString("status", "upcoming");
                    int code = "rang".equals(s) ? RANG : "didnt_ring".equals(s) ? DIDNT : "stopped".equals(s) ? STOPPED
                            : "untracked".equals(s) ? UNTRACKED : UPCOMING;
                    r.rings.add(new long[]{g.optLong("at", 0), code});
                }
            }
            out.add(r);
        }
        return out;
    }

    // ---------------------------------------------------------------- list

    private void draw(List<Row> rows, LocalDate today, String note) {
        list.removeAllViews();
        boolean isToday = day.equals(today);
        boolean past = day.isBefore(today);
        if (rows.isEmpty()) {
            list.addView(Ui.text(a, past ? "No alarms on this day." : isToday ? "No more alarms today."
                    : "No alarms on this day. In Personal OS, open a block and turn on \"Ring alarms on my phone\".",
                    14, Ui.MUTED, false));
        }
        // Already-rung ones first (faded on Today), then the ones still to come: the list is sorted by time anyway
        List<Row> sorted = new ArrayList<>(rows);
        Collections.sort(sorted, (x, y) -> Long.compare(x.first(), y.first()));
        long now = System.currentTimeMillis();
        for (Row r : sorted) list.addView(row(r, isToday && lastRing(r) <= now));
        if (note != null) {
            TextView t = Ui.text(a, note, 12, Ui.MUTED, false);
            t.setPadding(0, dp(6), 0, 0);
            list.addView(t);
        }
    }

    private static long lastRing(Row r) {
        return r.rings.isEmpty() ? 0 : r.rings.get(r.rings.size() - 1)[0];
    }

    private View row(Row r, boolean faded) {
        SimpleDateFormat hm = new SimpleDateFormat("HH:mm", Locale.getDefault());
        LinearLayout wrap = new LinearLayout(a);
        wrap.setOrientation(LinearLayout.VERTICAL);
        wrap.setPadding(0, dp(7), 0, dp(7));

        LinearLayout line = new LinearLayout(a);
        line.setOrientation(LinearLayout.HORIZONTAL);
        line.setGravity(Gravity.CENTER_VERTICAL);
        TextView time = Ui.text(a, hm.format(new Date(r.first())), 22, Ui.TEXT, true);
        time.setMinWidth(dp(72));
        line.addView(time);
        LinearLayout col = new LinearLayout(a);
        col.setOrientation(LinearLayout.VERTICAL);
        col.addView(Ui.text(a, r.title, 15, Ui.TEXT, true));
        col.addView(Ui.text(a, describe(r), 12, Ui.MUTED, false));
        String badge = badge(r);
        if (!badge.isEmpty()) {
            int color = "didnt_ring".equals(r.state) ? Ui.BAD : "mixed".equals(r.state) ? Ui.WARN
                    : "untracked".equals(r.state) ? Ui.MUTED : Ui.OK;
            TextView b = Ui.text(a, badge, 12, color, true);
            b.setPadding(0, dp(2), 0, 0);
            col.addView(b);
        }
        line.addView(col, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        if (r.rings.size() > 1) line.addView(Ui.text(a, expanded.contains(r.key) ? "▴" : "▾", 16, Ui.MUTED, false));
        wrap.addView(line);

        if (r.rings.size() > 1 && expanded.contains(r.key)) {
            for (long[] g : r.rings) {
                String s = g[1] == RANG ? "rang" : g[1] == DIDNT ? "didn't ring" : g[1] == STOPPED ? "not needed (answered)"
                        : g[1] == UNTRACKED ? "not tracked" : "to come";
                int c = g[1] == DIDNT ? Ui.BAD : g[1] == RANG ? Ui.OK : Ui.MUTED;
                TextView t = Ui.text(a, hm.format(new Date(g[0])) + "   " + s, 13, c, false);
                t.setPadding(dp(72), dp(3), 0, 0);
                wrap.addView(t);
            }
        }
        if (r.rings.size() > 1) {
            wrap.setOnClickListener(v -> {
                if (!expanded.remove(r.key)) expanded.add(r.key);
                LocalDate today = LocalDate.now();
                List<Row> cached = cache.get(day.toString());
                if (cached != null) draw(cached, today, null);
                else show(day);
            });
        }
        if (faded) wrap.setAlpha(0.55f);
        return wrap;
    }

    private static String describe(Row r) {
        StringBuilder sb = new StringBuilder();
        if ("event".equals(r.anchor)) sb.append("event reminder");
        else if ("end".equals(r.anchor)) sb.append("end of the block");
        else if (r.minutesBefore > 0) sb.append(r.minutesBefore).append(" min before");
        else sb.append("start of the block");
        if (r.rings.size() > 1) sb.append("  -  ").append(r.rings.size()).append(" rings, every ").append(r.every).append(" min");
        if ("notify".equals(r.style)) sb.append("  -  quiet");
        if (r.unplanned) sb.append("  -  not in today's plan");
        return sb.toString();
    }

    /** What happened: your answer, or that it never rang. Empty for rings still to come. */
    private static String badge(Row r) {
        switch (r.state) {
            case "didnt_ring":
                return "✕ Didn't ring";
            case "untracked":
                return "Not tracked (before the app reported rings)";
            case "rang":
            case "mixed": {
                String ans = answerLabel(r.answer);
                String s = ans.isEmpty() ? "Rang · no answer" : "✓ " + ans;
                if ("mixed".equals(r.state)) s += " · some rings didn't ring";
                return s;
            }
            default:
                return "";
        }
    }

    static String answerLabel(String a) {
        switch (a == null ? "" : a) {
            case "started": return "I'm up";
            case "already_done": return "Already done";
            case "skip": return "Skipped";
            case "done": return "Done";
            case "partial": return "Partly done";
            case "not_done": return "Didn't do it";
            case "snooze": return "Snoozed";
            case "silence": return "Silenced";
            case "dismiss": return "Dismissed";
            case "missed": return "No answer";
            default: return "";
        }
    }

    private int dp(int v) {
        return Ui.dp(a, v);
    }
}
