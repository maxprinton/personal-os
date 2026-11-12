package app.personalos.alarms;

import android.content.Context;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Small helpers so every screen looks the same: dark, rounded cards, one accent colour. */
final class Ui {
    private Ui() {}

    static final int BG = 0xFF12141C;
    static final int CARD = 0xFF1B1F2B;
    static final int CARD_HI = 0xFF262C3D;
    static final int TEXT = 0xFFF2F4FA;
    static final int MUTED = 0xFF9AA3B8;
    static final int ACCENT = 0xFF5B8CFF;
    static final int OK = 0xFF3DD68C;
    static final int WARN = 0xFFFFB454;
    static final int BAD = 0xFFFF6B6B;

    static int dp(Context c, int v) {
        return Math.round(v * c.getResources().getDisplayMetrics().density);
    }

    static GradientDrawable round(Context c, int color, int radiusDp) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(color);
        g.setCornerRadius(dp(c, radiusDp));
        return g;
    }

    static GradientDrawable outline(Context c, int fill, int stroke, int radiusDp) {
        GradientDrawable g = round(c, fill, radiusDp);
        g.setStroke(dp(c, 2), stroke);
        return g;
    }

    static TextView text(Context c, String s, int sp, int color, boolean bold) {
        TextView t = new TextView(c);
        t.setText(s);
        t.setTextSize(sp);
        t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    static LinearLayout.LayoutParams lp(int w, int h) {
        return new LinearLayout.LayoutParams(w, h);
    }

    static LinearLayout.LayoutParams wrap(Context c, int topDp) {
        LinearLayout.LayoutParams p = lp(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        p.topMargin = dp(c, topDp);
        return p;
    }

    /** A rounded card with a small heading. Returns the card; add rows to it. */
    static LinearLayout card(Context c, String heading) {
        LinearLayout card = new LinearLayout(c);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setBackground(round(c, CARD, 18));
        card.setPadding(dp(c, 16), dp(c, 14), dp(c, 16), dp(c, 16));
        if (heading != null) {
            TextView h = text(c, heading.toUpperCase(), 12, MUTED, true);
            h.setLetterSpacing(0.08f);
            h.setPadding(0, 0, 0, dp(c, 8));
            card.addView(h);
        }
        return card;
    }

    static Button button(Context c, String label, boolean primary, View.OnClickListener l) {
        Button b = new Button(c);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(16);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setTextColor(primary ? 0xFFFFFFFF : TEXT);
        b.setBackground(round(c, primary ? ACCENT : CARD_HI, 14));
        b.setStateListAnimator(null);
        b.setMinHeight(dp(c, 50));
        b.setMinimumHeight(dp(c, 50));
        b.setOnClickListener(l);
        return b;
    }

    /** A small button used inside rows ("Allow"). */
    static Button smallButton(Context c, String label, View.OnClickListener l) {
        Button b = new Button(c);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(13);
        b.setTextColor(0xFFFFFFFF);
        b.setBackground(round(c, ACCENT, 12));
        b.setStateListAnimator(null);
        b.setMinHeight(dp(c, 36));
        b.setMinimumHeight(dp(c, 36));
        b.setMinWidth(dp(c, 72));
        b.setMinimumWidth(dp(c, 72));
        b.setPadding(dp(c, 14), 0, dp(c, 14), 0);
        b.setOnClickListener(l);
        return b;
    }

    static EditText field(Context c, String hint, boolean secret) {
        EditText e = new EditText(c);
        e.setHint(hint);
        e.setSingleLine(true);
        e.setTextColor(TEXT);
        e.setHintTextColor(0xFF646C80);
        e.setTextSize(15);
        e.setInputType(InputType.TYPE_CLASS_TEXT
                | (secret ? InputType.TYPE_TEXT_VARIATION_PASSWORD : InputType.TYPE_TEXT_VARIATION_URI));
        e.setBackground(round(c, BG, 12));
        e.setPadding(dp(c, 14), dp(c, 12), dp(c, 14), dp(c, 12));
        return e;
    }

    /** A coloured dot, for status rows. */
    static View dot(Context c, int color) {
        View v = new View(c);
        GradientDrawable g = new GradientDrawable();
        g.setShape(GradientDrawable.OVAL);
        g.setColor(color);
        v.setBackground(g);
        LinearLayout.LayoutParams p = lp(dp(c, 12), dp(c, 12));
        p.gravity = Gravity.CENTER_VERTICAL;
        p.rightMargin = dp(c, 12);
        v.setLayoutParams(p);
        return v;
    }
}
