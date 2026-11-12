package app.personalos.alarms;

import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;

/** The alarm sounds: eight made for this app (inside it) plus anything the phone offers. */
final class Ringtones {
    private Ringtones() {}

    static final class Sound {
        final String id;   // stored in Prefs: "raw:<id>"
        final String name;
        final String hint;
        final int res;

        Sound(String id, String name, String hint, int res) {
            this.id = id;
            this.name = name;
            this.hint = hint;
            this.res = res;
        }

        String choice() {
            return "raw:" + id;
        }
    }

    static final Sound[] BUNDLED = {
            new Sound("sunrise", "Sunrise", "Rising chimes, a kind way to wake up", R.raw.sunrise),
            new Sound("calm", "Calm rise", "A slow, soft swell", R.raw.calm),
            new Sound("bells", "Soft bells", "Gentle bell notes", R.raw.bells),
            new Sound("marimba", "Marimba", "Warm, bouncy notes", R.raw.marimba),
            new Sound("dingdong", "Ding dong", "Two-note doorbell", R.raw.dingdong),
            new Sound("radar", "Radar", "A clear repeating ping", R.raw.radar),
            new Sound("digital", "Digital beeps", "The classic alarm clock", R.raw.digital),
            new Sound("alert", "Alert siren", "Loud and impossible to ignore", R.raw.alert),
    };

    static Sound bundled(String choice) {
        if (choice == null || !choice.startsWith("raw:")) return null;
        String id = choice.substring(4);
        for (Sound s : BUNDLED) if (s.id.equals(id)) return s;
        return null;
    }

    /** Name shown in the app for the current choice. */
    static String label(Context c, String choice) {
        Sound s = bundled(choice);
        if (s != null) return s.name;
        if (choice != null && choice.startsWith("uri:")) {
            String saved = Prefs.soundName(c);
            return saved.isEmpty() ? "Sound from your phone" : saved;
        }
        return "Phone default alarm";
    }

    /** The title the phone gives a picked sound, or "" when it cannot be read. */
    static String titleOf(Context c, Uri uri) {
        try {
            Ringtone r = RingtoneManager.getRingtone(c, uri);
            if (r != null) return r.getTitle(c);
        } catch (Exception ignored) {
            // the sound simply keeps a generic name
        }
        return "";
    }

    /**
     * A ready-to-start looping player for the choice. If the chosen sound cannot be opened (a file that was
     * removed, a permission lost) it falls back to the phone's default alarm and then to the first bundled
     * sound, so an alarm is never silent.
     */
    static MediaPlayer open(Context c, String choice) throws Exception {
        try {
            MediaPlayer p = tryOpen(c, choice);
            if (p != null) return p;
        } catch (Exception ignored) {
            // fall through to the defaults
        }
        try {
            MediaPlayer p = tryOpen(c, "");
            if (p != null) return p;
        } catch (Exception ignored) {
            // fall through to the bundled sound
        }
        return tryOpen(c, BUNDLED[0].choice());
    }

    private static MediaPlayer tryOpen(Context c, String choice) throws Exception {
        MediaPlayer p = new MediaPlayer();
        try {
            p.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
            Sound s = bundled(choice);
            if (s != null) {
                AssetFileDescriptor fd = c.getResources().openRawResourceFd(s.res);
                try {
                    p.setDataSource(fd.getFileDescriptor(), fd.getStartOffset(), fd.getLength());
                } finally {
                    fd.close();
                }
            } else if (choice != null && choice.startsWith("uri:")) {
                p.setDataSource(c, Uri.parse(choice.substring(4)));
            } else {
                Uri uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
                if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
                if (uri == null) throw new IllegalStateException("no default alarm sound");
                p.setDataSource(c, uri);
            }
            p.setLooping(true);
            p.prepare();
            return p;
        } catch (Exception e) {
            p.release();
            throw e;
        }
    }
}
