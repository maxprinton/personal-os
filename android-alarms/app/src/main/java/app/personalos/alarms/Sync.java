package app.personalos.alarms;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/** Re-reads the alarms from Personal OS and replaces the ones set on the phone. Call off the main thread. */
final class Sync {
    private Sync() {}

    static final class Result {
        final boolean ok;
        /** True when trying again later may work (no network, server busy); false for a wrong key or no setup. */
        final boolean retry;
        final String message;
        final int count;

        Result(boolean ok, boolean retry, String message, int count) {
            this.ok = ok;
            this.retry = retry;
            this.message = message;
            this.count = count;
        }
    }

    private static Result fail(Context c, boolean retry, String message) {
        Prefs.setSync(c, System.currentTimeMillis(), false, message);
        return new Result(false, retry, message, 0);
    }

    static synchronized Result run(Context ctx) {
        Context c = ctx.getApplicationContext();
        String base = Prefs.baseUrl(c);
        String key = Prefs.key(c);
        if (base.isEmpty() || key.isEmpty()) {
            return fail(c, false, "Enter the address and the key first.");
        }
        // Answers first, so the alarms read next already reflect them (ticked habits, closed blocks)
        Answers.flush(c);
        HttpURLConnection con = null;
        try {
            URL url = new URL(base + "/api/alarms");
            con = (HttpURLConnection) url.openConnection();
            con.setConnectTimeout(20000);
            con.setReadTimeout(30000);
            con.setRequestMethod("GET");
            con.setRequestProperty("Authorization", "Bearer " + key);
            con.setRequestProperty("Accept", "application/json");
            int code = con.getResponseCode();
            if (code == 401) {
                return fail(c, false, "Personal OS did not accept the key. Make a new one in Settings > Phone alarms.");
            }
            if (code != 200) {
                return fail(c, code >= 500, "Personal OS answered " + code + ".");
            }
            String body = read(con.getInputStream());
            JSONObject root = new JSONObject(body);
            JSONArray arr = root.getJSONArray("alarms");
            List<AlarmItem> list = new ArrayList<>();
            for (int i = 0; i < arr.length(); i++) {
                list.add(AlarmItem.fromJson(arr.getJSONObject(i)));
            }
            Scheduler.replaceAll(c, list);
            Prefs.setSync(c, System.currentTimeMillis(), true, list.size() + " alarm(s) set");
            return new Result(true, false, list.size() + " alarm(s) set", list.size());
        } catch (Exception e) {
            String why = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            return fail(c, true, "Could not reach Personal OS (" + why + "). The alarms already set keep working.");
        } finally {
            if (con != null) con.disconnect();
        }
    }

    static String read(InputStream in) throws Exception {
        StringBuilder sb = new StringBuilder();
        try (BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            char[] buf = new char[4096];
            int n;
            while ((n = r.read(buf)) != -1) sb.append(buf, 0, n);
        }
        return sb.toString();
    }
}
