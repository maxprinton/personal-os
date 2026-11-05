"use client";
// /youtube/settings form (Lead).
import { useActionState } from "react";
import type { ActionState } from "@/app/actions";
import { saveYtSettings } from "@/app/youtube/settings/actions";
import { MUSIC_STYLES, WEEKDAYS } from "@/lib/youtube/constants";
import type { YtSettings } from "@/lib/youtube/types";

const INPUT = "w-full rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-fg";
const LABEL = "space-y-1 text-xs text-muted";
const BOX = "grid grid-cols-1 gap-3 rounded-lg border border-line bg-surface p-4 shadow-card sm:grid-cols-2";
const H = "col-span-full text-sm font-semibold text-fg";

export default function SettingsForm({ s }: { s: YtSettings }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveYtSettings, {});
  const f = s.finder_filters;
  const m = s.sonic_identity;
  return (
    <form action={action} className="space-y-4">
      <div className={BOX}>
        <p className={H}>Channel</p>
        <label className={`${LABEL} sm:col-span-2`}>
          Channel link
          <input name="channel_url" defaultValue={s.channel_url ?? ""} placeholder="https://www.youtube.com/@yourname" className={INPUT} />
        </label>
        <label className={LABEL}>
          View goal per video (used until there are 5+ videos to compare)
          <input name="view_goal" inputMode="numeric" defaultValue={s.view_goal ?? ""} placeholder="e.g. 10000" className={INPUT} />
        </label>
        <label className={LABEL}>
          Work-in-progress limit (videos between Package and Publishing)
          <input name="wip_limit" inputMode="numeric" defaultValue={s.wip_limit} className={INPUT} />
        </label>
        <label className={LABEL}>
          Speaking speed (words per minute, for script length)
          <input name="words_per_min" inputMode="numeric" defaultValue={s.words_per_min} className={INPUT} />
        </label>
        <label className={LABEL}>
          Footage folder (PC path or Drive link)
          <input name="footage_root" defaultValue={s.footage_root ?? ""} placeholder="D:\YouTube or https://drive.google.com/…" className={INPUT} />
        </label>
      </div>

      <div className={BOX}>
        <p className={H}>Outlier finder (Topic step)</p>
        <label className={LABEL}>
          Minimum views
          <input name="min_views" inputMode="numeric" defaultValue={f.min_views} className={INPUT} />
        </label>
        <label className={LABEL}>
          Channels with fewer subscribers than
          <input name="max_subs" inputMode="numeric" defaultValue={f.max_subs} className={INPUT} />
        </label>
        <label className={LABEL}>
          Outlier: at least × the channel’s usual views
          <input name="min_outlier" inputMode="decimal" defaultValue={f.min_outlier} className={INPUT} />
        </label>
        <label className={LABEL}>
          Older than (days)
          <input name="min_age_days" inputMode="numeric" defaultValue={f.min_age_days} className={INPUT} />
        </label>
        <label className={LABEL}>
          Results per search
          <input name="max_results" inputMode="numeric" defaultValue={f.max_results} className={INPUT} />
        </label>
        <label className={LABEL}>
          Shorts in results
          <select name="shorts" defaultValue={f.shorts ?? "exclude"} className={INPUT}>
            <option value="exclude">Leave out Shorts</option>
            <option value="include">Include Shorts</option>
            <option value="only">Only Shorts</option>
          </select>
        </label>
      </div>

      <div className={BOX}>
        <p className={H}>Sonic identity (Music Lab)</p>
        <label className={`${LABEL} sm:col-span-2`}>
          Instruments (comma separated)
          <input name="instruments" defaultValue={(m.instruments ?? []).join(", ")} placeholder="soft pad, electric piano, sub bass, light drums" className={INPUT} />
        </label>
        <label className={LABEL}>
          BPM from
          <input name="bpm_min" inputMode="numeric" defaultValue={m.bpm_min ?? ""} placeholder="80" className={INPUT} />
        </label>
        <label className={LABEL}>
          BPM to
          <input name="bpm_max" inputMode="numeric" defaultValue={m.bpm_max ?? ""} placeholder="110" className={INPUT} />
        </label>
        <label className={LABEL}>
          Preferred key
          <input name="music_key" defaultValue={m.key ?? ""} placeholder="e.g. D minor" className={INPUT} />
        </label>
        <label className={LABEL}>
          Style
          <input name="music_style" list="yt-music-styles" defaultValue={m.style ?? ""} placeholder="lo-fi" className={INPUT} />
          <datalist id="yt-music-styles">
            {MUSIC_STYLES.map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
        </label>
        <label className={`${LABEL} sm:col-span-2`}>
          Notes (references you like)
          <input name="music_notes" defaultValue={m.notes ?? ""} className={INPUT} />
        </label>
      </div>

      <div className={BOX}>
        <p className={H}>Weekly channel review</p>
        <label className={LABEL}>
          Day
          <select name="weekly_day" defaultValue={s.weekly_review.day} className={INPUT}>
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL}>
          Time
          <input type="time" name="weekly_time" defaultValue={s.weekly_review.time} className={INPUT} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="weekly_telegram" defaultChecked={s.weekly_review.telegram} /> Send it on Telegram
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="weekly_note" defaultChecked={s.weekly_review.note} /> Save it as a note
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button disabled={pending} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60">
          {pending ? "Saving..." : "Save settings"}
        </button>
        {state.error && <p className="text-sm text-danger">{state.error}</p>}
        {state.ok && !state.error && <p className="text-sm text-success">Saved ✓</p>}
      </div>
    </form>
  );
}
