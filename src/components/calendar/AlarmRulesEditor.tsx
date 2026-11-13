"use client";

import { useState } from "react";
import {
  describeRing,
  MAX_OFFSET,
  MAX_REPEATS,
  MAX_RINGS,
  PRESETS,
  SOUNDS,
  type AlarmRing,
} from "@/lib/alarm-rules";
import { btnPrimary, btnSecondary, inputCls } from "@/components/calendar/Modal";

const EVERY_OPTIONS = [1, 2, 3, 5, 10, 15, 20, 30];

const FIRST_RING: AlarmRing = {
  anchor: "start",
  offset: 0,
  sound: "default",
  repeatSound: null,
  style: "alarm",
  repeats: 0,
  every: 5,
  louder: false,
};

/**
 * Phone-alarm rules of a block: a list of rings (start or end of the block, minutes before/after, sound,
 * repeats that escalate). Edited locally and saved with one button; applies to every block with this name.
 */
export default function AlarmRulesEditor({
  blockName,
  initial,
  busy,
  onSave,
}: {
  blockName: string;
  initial: AlarmRing[];
  busy: boolean;
  onSave: (rules: AlarmRing[]) => Promise<boolean>;
}) {
  const [rules, setRules] = useState<AlarmRing[]>(initial);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const dirty = JSON.stringify(rules) !== saved;

  const patch = (i: number, change: Partial<AlarmRing>) =>
    setRules((list) =>
      list.map((r, j) => {
        if (j !== i) return r;
        const next = { ...r, ...change };
        if (next.repeats === 0) {
          next.louder = false;
          next.repeatSound = null;
        }
        return next;
      })
    );

  const add = (rings: AlarmRing[]) => setRules((list) => [...list, ...rings].slice(0, MAX_RINGS));

  async function save() {
    if (await onSave(rules)) setSaved(JSON.stringify(rules));
  }

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={rules.length > 0}
          disabled={busy}
          onChange={(e) => setRules(e.target.checked ? [FIRST_RING] : [])}
        />
        Ring alarms on my phone
      </label>

      {rules.length > 0 && (
        <ul className="space-y-2">
          {rules.map((r, i) => (
            <li key={i} className="space-y-2 rounded-md border border-line p-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-xs font-medium text-muted">Ring {i + 1}</span>
                <input
                  type="number"
                  min={0}
                  max={MAX_OFFSET}
                  value={Math.abs(r.offset)}
                  onChange={(e) => {
                    const n = Math.min(MAX_OFFSET, Math.max(0, Math.round(Number(e.target.value) || 0)));
                    patch(i, { offset: r.offset < 0 ? -n : n });
                  }}
                  className={`${inputCls} !w-20`}
                  aria-label="Minutes"
                />
                <span className="text-xs text-muted">min</span>
                <select
                  value={r.offset === 0 ? "at" : r.offset < 0 ? "before" : "after"}
                  onChange={(e) => {
                    const n = Math.abs(r.offset);
                    patch(i, { offset: e.target.value === "before" ? -(n || 5) : e.target.value === "after" ? n || 5 : 0 });
                  }}
                  className={`${inputCls} !w-auto`}
                  aria-label="Before or after"
                >
                  <option value="at">exactly at</option>
                  <option value="before">before</option>
                  <option value="after">after</option>
                </select>
                <select
                  value={r.anchor}
                  onChange={(e) => patch(i, { anchor: e.target.value === "end" ? "end" : "start" })}
                  className={`${inputCls} !w-auto`}
                  aria-label="Start or end of the block"
                >
                  <option value="start">the start</option>
                  <option value="end">the end</option>
                </select>
                <button
                  type="button"
                  onClick={() => setRules((list) => list.filter((_, j) => j !== i))}
                  className="ml-auto text-xs text-muted hover:text-danger"
                  aria-label={`Remove ring ${i + 1}`}
                >
                  Remove
                </button>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="space-y-1 text-xs text-muted">
                  Sound
                  <select value={r.sound} onChange={(e) => patch(i, { sound: e.target.value })} className={inputCls}>
                    {SOUNDS.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-xs text-muted">
                  How it shows
                  <select
                    value={r.style}
                    onChange={(e) => patch(i, { style: e.target.value === "notify" ? "notify" : "alarm" })}
                    className={inputCls}
                  >
                    <option value="alarm">Full-screen alarm</option>
                    <option value="notify">Banner with a sound (quieter)</option>
                  </select>
                </label>
                <label className="space-y-1 text-xs text-muted">
                  Then ring again
                  <select
                    value={r.repeats}
                    onChange={(e) => patch(i, { repeats: Number(e.target.value) })}
                    className={inputCls}
                  >
                    <option value={0}>Never (rings once)</option>
                    {Array.from({ length: MAX_REPEATS }, (_, n) => n + 1).map((n) => (
                      <option key={n} value={n}>
                        {n} more time{n === 1 ? "" : "s"}
                      </option>
                    ))}
                  </select>
                </label>
                {r.repeats > 0 && (
                  <label className="space-y-1 text-xs text-muted">
                    Every
                    <select value={r.every} onChange={(e) => patch(i, { every: Number(e.target.value) })} className={inputCls}>
                      {EVERY_OPTIONS.map((m) => (
                        <option key={m} value={m}>
                          {m} min
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              {r.repeats > 0 && (
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={r.louder} onChange={(e) => patch(i, { louder: e.target.checked })} />
                    Louder each time
                  </label>
                  <label className="flex items-center gap-2 text-xs text-muted">
                    Repeat sound
                    <select
                      value={r.repeatSound ?? ""}
                      onChange={(e) => patch(i, { repeatSound: e.target.value || null })}
                      className={`${inputCls} !w-auto`}
                    >
                      <option value="">Same as the first</option>
                      {SOUNDS.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}

              <p className="text-xs text-muted">{describeRing(r)}</p>
            </li>
          ))}
        </ul>
      )}

      {rules.length > 0 && rules.length < MAX_RINGS && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted">Add:</span>
          {PRESETS.map((p) => (
            <button key={p.id} type="button" title={p.hint} onClick={() => add(p.rings)} className={`${btnSecondary} !px-2 !py-1 !text-xs`}>
              + {p.name}
            </button>
          ))}
          <button type="button" onClick={() => add([FIRST_RING])} className={`${btnSecondary} !px-2 !py-1 !text-xs`}>
            + Custom ring
          </button>
        </div>
      )}
      {rules.length === 0 && (
        <p className="text-xs text-muted">Turn it on, then add rings from the presets (Wake-up, Start now, Wrap-up heads-up, Hard stop).</p>
      )}

      <p className="text-xs text-muted">
        When a ring repeats, it keeps coming back by itself, even if you silence it, until you tap “I’m up” / “Got it” on the phone, the block ends
        (rings of the start), or it runs out. Applies to every “{blockName}” block. Needs the Personal OS Alarms app (Settings → Phone alarms).
      </p>

      {dirty && (
        <div className="flex items-center gap-2">
          <button type="button" disabled={busy} onClick={save} className={btnPrimary}>
            Save alarms
          </button>
          <button type="button" disabled={busy} onClick={() => setRules(JSON.parse(saved) as AlarmRing[])} className={btnSecondary}>
            Undo changes
          </button>
        </div>
      )}
    </div>
  );
}
