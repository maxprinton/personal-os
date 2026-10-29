"use client";
// OWNED BY: templates. Shown on a template's page: "Editing template", default / for Type, schedule settings, variables help.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Popover } from "@/components/editor/ui";
import { createFromTemplate, deleteTemplate, duplicateTemplate, runScheduleNow, updateTemplateConfig } from "@/app/template-actions";
import { cleanSchedule, describeSchedule, formatDay, formatRun, localTimeAt, nextRun, TEMPLATE_VARS, varValues } from "@/lib/notes-db/tpl-core";
import { addDays, isoWeekday } from "@/lib/time";
import type { DbData, Schedule, TemplateConfig, TemplateInfo } from "@/lib/notes-db/types";
import { errText, settleEditor, tplTitle } from "./tpl-ui";
import "./templates.css";

type Freq = Schedule["freq"] | "off";
const FREQS: { id: Freq; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
  { id: "yearly", label: "Yearly" },
];
const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DEBOUNCE = 700;

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; text: string };

export default function TemplateBar({ template, data }: { template: TemplateInfo; data: DbData }) {
  const router = useRouter();
  const id = template.id;
  const tz = data.timezone;
  const [cfg, setCfg] = useState<TemplateConfig>(template.config ?? {});
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [vars, setVars] = useState<{ left: number; top: number; bottom: number; right: number } | null>(null);
  const [now, setNow] = useState<Date | null>(null); // after mount only (server and browser HTML match)

  // Text inputs keep their own draft while typing
  const [advDraft, setAdvDraft] = useState(String(template.config?.schedule?.advanceHours ?? 0));

  // Phones: start collapsed
  useEffect(() => {
    if (window.matchMedia?.("(max-width: 640px)").matches) setOpen(false);
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // ---- Saving (one request at a time; the latest wins) ------------------------------------------
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Partial<TemplateConfig> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const send = useCallback(
    async (patch: Partial<TemplateConfig>) => {
      const mine = ++seq.current;
      setSave({ kind: "saving" });
      try {
        const r = await updateTemplateConfig(id, patch);
        if (mine !== seq.current) return; // a newer change is on its way
        if (r.ok) {
          // The server's cleaned settings, except a schedule edit still waiting to be sent
          const waiting = !!pending.current && "schedule" in pending.current;
          setCfg((c) => ({ ...c, ...r.config, schedule: "schedule" in patch && !waiting ? r.config.schedule : c.schedule }));
          setSave({ kind: "saved" });
          if (savedTimer.current) clearTimeout(savedTimer.current);
          savedTimer.current = setTimeout(() => setSave((s) => (s.kind === "saved" ? { kind: "idle" } : s)), 1800);
        } else setSave({ kind: "error", text: errText(r, "Couldn't save. Try again.") });
      } catch (e) {
        if (mine === seq.current) setSave({ kind: "error", text: errText(e, "Couldn't save. Check your connection.") });
      }
    },
    [id],
  );

  /** Sends what is waiting for the debounce, now. */
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const p = pending.current;
    pending.current = null;
    if (p) await send(p);
  }, [send]);

  /** Shows the change at once and saves it (after a pause for text inputs). */
  const change = useCallback(
    (patch: Partial<TemplateConfig>, delay = 0) => {
      setCfg((c) => ({ ...c, ...patch }));
      pending.current = { ...(pending.current ?? {}), ...patch };
      if (timer.current) clearTimeout(timer.current);
      if (delay > 0) {
        setSave({ kind: "saving" });
        timer.current = setTimeout(() => void flush(), delay);
      } else void flush();
    },
    [flush],
  );

  // Leaving the page with a change still waiting: send it
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      const p = pending.current;
      pending.current = null;
      if (p) void updateTemplateConfig(id, p).catch(() => {});
    },
    [id],
  );

  // ---- Schedule -------------------------------------------------------------------------------
  const sched = cfg.schedule ?? null;
  const freq: Freq = sched?.freq ?? "off";
  const today = data.today;

  const setSchedule = (next: Schedule | null, delay = 0) => change({ schedule: next }, delay);
  const patchSchedule = (p: Partial<Schedule>, delay = 0) => {
    if (!sched) return;
    setSchedule({ ...sched, ...p }, delay);
  };

  function setFreq(f: Freq) {
    if (f === "off") return setSchedule(null);
    const [, m, d] = today.split("-").map(Number);
    const base: Schedule = {
      freq: f,
      time: sched?.time ?? "09:00",
      advanceHours: sched?.advanceHours,
      until: sched?.until ?? null,
      paused: sched?.paused,
      skipUnused: sched?.skipUnused,
      notify: sched?.notify,
    };
    if (f === "weekly") base.days = sched?.days?.length ? sched.days : [isoWeekday(today)];
    if (f === "monthly" || f === "yearly") base.monthDay = sched?.monthDay ?? d;
    if (f === "yearly") base.month = sched?.month ?? m;
    setSchedule(base);
  }

  function toggleDay(day: number) {
    if (!sched) return;
    const days = sched.days?.length ? sched.days : [1];
    const next = days.includes(day) ? days.filter((x) => x !== day) : [...days, day].sort();
    if (!next.length) return; // at least one day
    patchSchedule({ days: next });
  }

  const clean = cleanSchedule(sched);
  const next = now && clean ? nextRun(clean, tz, now, cfg.lastKey ?? null) : null;

  // ---- Actions --------------------------------------------------------------------------------
  async function act(key: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(key);
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError(errText(e));
      setBusy(null);
    }
  }

  const go = (r: { ok?: boolean; id?: string; error?: string }, fallback: string) => {
    if (r.ok && r.id) router.push(`/notes/${r.id}`);
    else {
      setActionError(errText(r, fallback));
      setBusy(null);
    }
  };

  const createNow = () =>
    act("now", async () => {
      await settleEditor();
      await flush();
      go(await runScheduleNow(id), "Couldn't create it.");
    });
  const useIt = () =>
    act("use", async () => {
      await settleEditor();
      go(await createFromTemplate(id), "Couldn't create the note.");
    });
  const duplicate = () =>
    act("dup", async () => {
      await settleEditor();
      await flush();
      go(await duplicateTemplate(id), "Couldn't duplicate it.");
    });
  const remove = () => {
    if (!window.confirm(`Delete the template “${tplTitle(template)}”?\n\nThe notes you already made from it stay.`)) return;
    void act("del", async () => {
      if (timer.current) clearTimeout(timer.current);
      pending.current = null;
      const r = await deleteTemplate(id);
      if (r.ok) router.push("/notes");
      else {
        setActionError(errText(r, "Couldn't delete it."));
        setBusy(null);
      }
    });
  };

  // ---- Type -----------------------------------------------------------------------------------
  const typeProp = data.properties.find((p) => p.builtin && p.key === "type") ?? null;
  const typeOptions = typeProp?.config.options ?? [];
  const usedBy = (optId: string) => data.templates.find((t) => t.id !== id && t.config.forType === optId) ?? null;
  const forTypeName = typeOptions.find((o) => o.id === cfg.forType)?.name ?? null;

  const summary = [cfg.isDefault ? "Default" : null, forTypeName ? `Type: ${forTypeName}` : null, sched ? describeSchedule(clean) : null].filter(Boolean).join(" · ");

  return (
    <section className="tpl-bar" aria-label="Template settings">
      <div className="tpl-bar-head">
        <span className="tpl-bar-title">
          <span aria-hidden>📐 </span>
          <b>Editing template</b>
          <span className="tpl-bar-sub"> · this page is a template</span>
          {summary && <span className="tpl-bar-summary"> · {summary}</span>}
        </span>
        <SaveBadge state={save} />
        <button
          type="button"
          className="tpl-ghost"
          onClick={(e) => {
            if (vars) return setVars(null);
            const r = e.currentTarget.getBoundingClientRect();
            setVars({ left: r.left, top: r.top, bottom: r.bottom, right: r.right });
          }}
          aria-expanded={!!vars}
          title="Variables you can use in the title and text"
        >
          {"{{ }}"} Variables
        </button>
        <button type="button" className={`tpl-ghost ${open ? "is-on" : ""}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          Settings {open ? "▴" : "▾"}
        </button>
      </div>

      {open && (
        <div className="tpl-bar-body">
          <p className="tpl-help">
            What you write here is copied into every new note made from this template. Sub-pages you add here are copied too. Use {"{{date}}"}, {"{{weekday}}"}… in the title or text
            (see Variables).
          </p>

          {/* Default */}
          <div className="tpl-row">
            <span className="tpl-label">Default</span>
            <label className="tpl-check">
              <input type="checkbox" checked={!!cfg.isDefault} onChange={(e) => change({ isDefault: e.target.checked })} />
              <span>Use it for the “New” button</span>
            </label>
          </div>

          {/* Use for Type */}
          {typeProp && (
            <div className="tpl-row">
              <label className="tpl-label" htmlFor={`tpl-type-${id}`}>
                Use for Type
              </label>
              <select id={`tpl-type-${id}`} className="tpl-select" value={cfg.forType ?? ""} onChange={(e) => change({ forType: e.target.value || null })}>
                <option value="">None</option>
                {typeOptions.map((o) => {
                  const other = usedBy(o.id);
                  return (
                    <option key={o.id} value={o.id}>
                      {o.name || "Untitled"}
                      {other ? ` (now: ${tplTitle(other)})` : ""}
                    </option>
                  );
                })}
              </select>
              <span className="tpl-hint">Picking this Type on an empty note fills it with this template.</span>
            </div>
          )}

          {/* Schedule */}
          <div className="tpl-row">
            <span className="tpl-label">Repeat</span>
            <div className="tpl-seg" role="radiogroup" aria-label="Repeat">
              {FREQS.map((f) => (
                <button key={f.id} type="button" role="radio" aria-checked={freq === f.id} className={`tpl-seg-btn ${freq === f.id ? "is-on" : ""}`} onClick={() => setFreq(f.id)}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {sched && (
            <>
              {sched.freq === "weekly" && (
                <div className="tpl-row">
                  <span className="tpl-label">On</span>
                  <div className="tpl-days">
                    {DAYS.map((d, i) => {
                      const on = (sched.days?.length ? sched.days : [1]).includes(i + 1);
                      return (
                        <button key={d} type="button" className={`tpl-day ${on ? "is-on" : ""}`} aria-pressed={on} aria-label={DAY_NAMES[i]} title={DAY_NAMES[i]} onClick={() => toggleDay(i + 1)}>
                          {d}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {(sched.freq === "monthly" || sched.freq === "yearly") && (
                <div className="tpl-row">
                  <span className="tpl-label">On</span>
                  {sched.freq === "yearly" && (
                    <select className="tpl-select" aria-label="Month" value={sched.month ?? 1} onChange={(e) => patchSchedule({ month: Number(e.target.value) })}>
                      {MONTHS.map((m, i) => (
                        <option key={m} value={i + 1}>
                          {m}
                        </option>
                      ))}
                    </select>
                  )}
                  <select className="tpl-select" aria-label="Day of the month" value={sched.monthDay ?? 1} onChange={(e) => patchSchedule({ monthDay: Number(e.target.value) })}>
                    {Array.from({ length: 31 }, (_, i) => (
                      <option key={i} value={i + 1}>
                        {sched.freq === "monthly" ? `Day ${i + 1}` : i + 1}
                      </option>
                    ))}
                  </select>
                  {(sched.monthDay ?? 1) > 28 && <span className="tpl-hint">Shorter months use their last day.</span>}
                </div>
              )}

              <div className="tpl-row">
                <label className="tpl-label" htmlFor={`tpl-time-${id}`}>
                  At
                </label>
                <input
                  id={`tpl-time-${id}`}
                  type="time"
                  className="tpl-time"
                  value={sched.time}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (/^\d{2}:\d{2}$/.test(v)) patchSchedule({ time: v }, DEBOUNCE);
                  }}
                />
                <label className="tpl-inline">
                  <span>Create it</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={48}
                    step={1}
                    className="tpl-num"
                    value={advDraft}
                    aria-label="Hours before"
                    onChange={(e) => {
                      setAdvDraft(e.target.value);
                      if (e.target.value === "") return;
                      const n = Math.max(0, Math.min(48, Math.round(Number(e.target.value))));
                      if (Number.isFinite(n)) patchSchedule({ advanceHours: n || undefined }, DEBOUNCE);
                    }}
                    onBlur={() => {
                      const n = Math.max(0, Math.min(48, Math.round(Number(advDraft)) || 0));
                      setAdvDraft(String(n));
                      if (n !== (sched.advanceHours ?? 0)) patchSchedule({ advanceHours: n || undefined });
                      else void flush();
                    }}
                  />
                  <span>hours before</span>
                </label>
              </div>

              <div className="tpl-row">
                <span className="tpl-label">Ends</span>
                <select
                  className="tpl-select"
                  aria-label="Ends"
                  value={sched.until ? "date" : "never"}
                  onChange={(e) => patchSchedule({ until: e.target.value === "date" ? (sched.until ?? addDays(today, 30)) : null })}
                >
                  <option value="never">Never</option>
                  <option value="date">On a date</option>
                </select>
                {sched.until && (
                  <input
                    type="date"
                    className="tpl-date"
                    aria-label="Last date"
                    value={sched.until}
                    min={today}
                    onChange={(e) => {
                      if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) patchSchedule({ until: e.target.value }, DEBOUNCE);
                    }}
                  />
                )}
              </div>

              <div className="tpl-row">
                <span className="tpl-label">Options</span>
                <div className="tpl-checks">
                  <label className="tpl-check">
                    <input type="checkbox" checked={!!sched.skipUnused} onChange={(e) => patchSchedule({ skipUnused: e.target.checked || undefined })} />
                    <span>Delete the previous one if I didn&apos;t use it</span>
                  </label>
                  <label className="tpl-check">
                    <input type="checkbox" checked={!!sched.notify} onChange={(e) => patchSchedule({ notify: e.target.checked || undefined })} />
                    <span>Notify me on Telegram</span>
                  </label>
                </div>
              </div>

              <div className="tpl-next">
                <div className="tpl-next-text">
                  {sched.paused ? (
                    <>
                      <b>Paused</b>
                      <small>{describeSchedule({ ...clean!, paused: false })} · no new notes until you resume it.</small>
                    </>
                  ) : next ? (
                    <>
                      Next: <b>{formatRun(next.at, tz)}</b>
                      <small>
                        {(clean?.advanceHours ?? 0) > 0 ? `The note for ${formatDay(next.key)} · ` : ""}
                        {describeSchedule(clean)}
                        {sched.until ? ` · until ${formatDay(sched.until)}` : ""}
                      </small>
                    </>
                  ) : now ? (
                    <>
                      <b>Ended</b>
                      <small>No more dates{sched.until ? ` after ${formatDay(sched.until)}` : ""}. Change “Ends” to continue.</small>
                    </>
                  ) : (
                    <>{describeSchedule(clean)}</>
                  )}
                </div>
                <button type="button" className="tpl-ghost" onClick={() => patchSchedule({ paused: !sched.paused || undefined })}>
                  {sched.paused ? "▶ Resume" : "⏸ Pause"}
                </button>
                <button type="button" className="tpl-btn" onClick={createNow} disabled={!!busy} title="Make the next note of this schedule right away">
                  {busy === "now" ? "Creating…" : "Create one now"}
                </button>
              </div>
            </>
          )}

          <div className="tpl-row tpl-actions">
            {!sched && (
              <button type="button" className="tpl-btn" onClick={useIt} disabled={!!busy}>
                {busy === "use" ? "Creating…" : "New note from this template"}
              </button>
            )}
            <button type="button" className="tpl-ghost" onClick={duplicate} disabled={!!busy}>
              {busy === "dup" ? "Duplicating…" : "⧉ Duplicate"}
            </button>
            <button type="button" className="tpl-ghost is-danger" onClick={remove} disabled={!!busy}>
              {busy === "del" ? "Deleting…" : "🗑 Delete template"}
            </button>
            {actionError && (
              <span className="tpl-err" role="alert">
                {actionError}
              </span>
            )}
          </div>
        </div>
      )}

      {!open && actionError && (
        <p className="tpl-err tpl-bar-err" role="alert">
          {actionError}
        </p>
      )}

      {vars && <VariablesMenu rect={vars} onClose={() => setVars(null)} today={today} time={now ? localTimeAt(now, tz) : "09:00"} />}
    </section>
  );
}

function SaveBadge({ state }: { state: SaveState }) {
  if (state.kind === "idle") return null;
  if (state.kind === "error")
    return (
      <span className="tpl-err" role="alert">
        {state.text}
      </span>
    );
  return (
    <span className="tpl-saving" aria-live="polite">
      {state.kind === "saving" ? "Saving…" : "Saved"}
    </span>
  );
}

function VariablesMenu({ rect, onClose, today, time }: { rect: { left: number; top: number; bottom: number; right: number }; onClose: () => void; today: string; time: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const live = varValues(today, time);
  const width = typeof window === "undefined" ? 320 : Math.min(320, window.innerWidth - 16);

  async function copy(name: string) {
    const text = `{{${name}}}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Old browsers / no permission: a hidden textarea
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* nothing else to try */
      }
      ta.remove();
    }
    setCopied(name);
    setTimeout(() => setCopied((c) => (c === name ? null : c)), 1500);
  }

  return (
    <Popover rect={{ ...rect, left: Math.max(8, rect.right - width) }} onClose={onClose} width={width} className="n-menu">
      <div className="tpl-vars">
        <p className="n-menu-label">Variables</p>
        <p className="tpl-vars-note">Write them in the title or the text. They are replaced when a note is made (a scheduled note uses its own date). Click one to copy it.</p>
        {TEMPLATE_VARS.map((v) => (
          <button key={v.name} type="button" className="tpl-var" onClick={() => void copy(v.name)} title={`Copy {{${v.name}}}`}>
            <code>{`{{${v.name}}}`}</code>
            <span>
              {v.hint} · {live[v.name] ?? v.example}
            </span>
            {copied === v.name && <em>Copied</em>}
          </button>
        ))}
      </div>
    </Popover>
  );
}
