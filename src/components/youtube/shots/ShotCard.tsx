"use client";
// One shot of the shot list: ✓ filmed, type, what we see, flags (script changed, pickup, ✨), file name
// with Copy, and the details (camera, setup, edit) behind "Details".
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { addShot, deleteShot, keepShot, setShotDone, updateShot, type ShotPatch } from "@/app/youtube-actions/shots";
import { FRAMINGS, SHOT_KINDS } from "@/lib/youtube/constants";
import type { ShotKind, YtShot } from "@/lib/youtube/types";
import { BlurField, BTN_SM, Chip, INPUT, Msg } from "@/components/youtube/script/ui";
import { cameraSummary, setupKey, setupSummary, shotName, shotTag } from "./logic";

export function CopyName({ name, className = BTN_SM }: { name: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={className}
      title="Copy the file name"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(name);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          window.prompt("Copy the file name:", name);
        }
      }}
    >
      {copied ? "Copied ✓" : "Copy"}
    </button>
  );
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block space-y-0.5">
    <span className="text-[11px] font-medium text-muted">{label}</span>
    {children}
  </label>
);

export default function ShotCard({ shot, code, sectionNum, showLine, isIntro }: { shot: YtShot; code: string | null; sectionNum: number | null; showLine: boolean; isIntro: boolean }) {
  const router = useRouter();
  const [s, setS] = useState(shot);
  useEffect(() => setS(shot), [shot]);
  const [open, setOpen] = useState(false);
  const [take, setTake] = useState(1);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (patch: ShotPatch): Promise<string | null> => {
    setS((x) => ({ ...x, ...patch }) as YtShot);
    const r = await updateShot(s.id, patch);
    if (r.error) {
      setS(shot);
      return r.error;
    }
    return null;
  };
  const text = (f: keyof ShotPatch) => (v: string) => save({ [f]: v } as ShotPatch);
  const run = async (fn: () => Promise<{ error?: string }>) => {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    setErr(r.error ?? null);
    if (!r.error) router.refresh();
  };

  const name = shotName(code, sectionNum, s, take);
  const cam = cameraSummary(s);
  const setup = setupKey(s);

  return (
    <div className={`rounded-lg border bg-surface p-3 shadow-card ${s.script_changed ? "border-warning" : "border-line"} ${s.done ? "opacity-75" : ""}`}>
      {showLine && s.line_text && <p className="mb-2 border-l-2 border-line-strong pl-2 text-xs italic text-muted">“{s.line_text}”</p>}
      <div className="flex flex-wrap items-start gap-2">
        <button
          type="button"
          aria-pressed={s.done}
          aria-label={s.done ? "Filmed — tap to undo" : "Mark as filmed"}
          title={s.done ? "Filmed" : "Mark as filmed"}
          disabled={busy}
          onClick={async () => {
            const done = !s.done;
            setS((x) => ({ ...x, done }));
            const r = await setShotDone(s.id, done);
            if (r.error) {
              setS((x) => ({ ...x, done: !done }));
              setErr(r.error);
            } else router.refresh();
          }}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-base ${s.done ? "border-success bg-success-soft text-success" : "border-line-strong text-faint hover:bg-subtle"}`}
        >
          ✓
        </button>
        <span className="mt-1 shrink-0 font-mono text-xs text-muted">{shotTag(sectionNum, s.num)}</span>
        <select
          value={s.kind}
          onChange={(e) => void save({ kind: e.target.value as ShotKind }).then(setErr)}
          className="rounded-md border border-line-strong bg-surface px-1.5 py-1 text-xs"
          aria-label="Shot type"
        >
          {SHOT_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.id} · {k.label}
            </option>
          ))}
        </select>
        <div className="min-w-[12rem] flex-1">
          <BlurField value={s.description ?? ""} onSave={text("description")} placeholder={s.kind === "AR" ? "Talking head (add a note if needed)" : "What we see"} ariaLabel="What we see" />
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {s.ai_suggested && <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] text-accent">✨ AI</span>}
          {s.is_pickup && <span className="rounded bg-warning-soft px-1.5 py-0.5 text-[10px] text-warning">Pickup</span>}
          {isIntro && s.matches_thumbnail && <span className="rounded bg-success-soft px-1.5 py-0.5 text-[10px] text-success">Matches thumbnail</span>}
        </div>
      </div>

      {s.script_changed && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-warning-soft px-2 py-1.5 text-xs text-warning">
          <span className="font-medium">Script changed</span>
          <span className="text-muted">— the line of this shot was edited or removed.</span>
          <button type="button" className={BTN_SM} disabled={busy} onClick={() => void run(() => keepShot(s.id))}>
            Still fine
          </button>
          <button type="button" className={BTN_SM} disabled={busy} onClick={() => confirm("Delete this shot?") && void run(() => deleteShot(s.id))}>
            Delete
          </button>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <code className="rounded bg-subtle px-1.5 py-0.5 font-mono text-[11px]">{name}</code>
        <label className="flex items-center gap-1 text-muted">
          Take
          <input
            type="number"
            min={1}
            max={99}
            value={take}
            onChange={(e) => setTake(Math.max(1, Math.min(99, Number(e.target.value) || 1)))}
            className="w-12 rounded border border-line bg-surface px-1 py-0.5 text-xs"
            aria-label="Take number"
          />
        </label>
        <CopyName name={name} />
        <span className="text-muted">
          {setup}
          {cam ? ` · ${cam}` : ""}
          {s.duration_s ? ` · ${s.duration_s}s` : ""}
        </span>
        <button type="button" className={`${BTN_SM} ml-auto`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "Hide details" : "Details"}
        </button>
      </div>
      <Msg error={err} />

      {open && (
        <div className="mt-3 grid gap-3 border-t border-line pt-3 sm:grid-cols-3">
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Camera</h4>
            <Field label="Framing">
              <div className="flex gap-1">
                {FRAMINGS.map((f) => (
                  <Chip key={f} on={s.framing === f} onClick={() => void save({ framing: s.framing === f ? null : f }).then(setErr)}>
                    {f}
                  </Chip>
                ))}
              </div>
            </Field>
            <Field label="Angle">
              <BlurField value={s.angle ?? ""} onSave={text("angle")} placeholder="eye level, high, low, over the shoulder…" />
            </Field>
            <Field label="Movement">
              <BlurField value={s.movement ?? ""} onSave={text("movement")} placeholder="static, pan, slow push…" />
            </Field>
          </div>
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Setup (continuity)</h4>
            <Field label="Setup / scene">
              <SuggestField value={s.setup ?? ""} list="yt-setups" onSave={text("setup")} placeholder="Desk, Kitchen, Outside…" />
            </Field>
            <Field label="Location">
              <SuggestField value={s.location ?? ""} list="yt-locations" onSave={text("location")} placeholder="Home office…" />
            </Field>
            <Field label="Props">
              <BlurField value={s.props ?? ""} onSave={text("props")} />
            </Field>
            <Field label="Light">
              <BlurField value={s.lighting ?? ""} onSave={text("lighting")} />
            </Field>
            <Field label="Outfit">
              <BlurField value={s.outfit ?? ""} onSave={text("outfit")} />
            </Field>
            {setupSummary(s) && <p className="text-[11px] text-muted">{setupSummary(s)}</p>}
          </div>
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Edit</h4>
            <Field label="Duration (seconds)">
              <BlurField value={s.duration_s == null ? "" : String(s.duration_s)} onSave={(v) => save({ duration_s: v === "" ? null : Number(v) })} placeholder="e.g. 4" />
            </Field>
            <Field label="Music / SFX">
              <BlurField value={s.audio ?? ""} onSave={text("audio")} placeholder="whoosh, music drops…" />
            </Field>
            <Field label="Notes for the edit">
              <BlurField value={s.edit_notes ?? ""} onSave={text("edit_notes")} multiline rows={3} />
            </Field>
            <div className="flex flex-wrap gap-1.5">
              <Chip on={s.is_pickup} onClick={() => void save({ is_pickup: !s.is_pickup }).then(setErr)} title="Film it in a re-shoot session (shows in Missing shots)">
                Pickup
              </Chip>
              {isIntro && (
                <Chip on={s.matches_thumbnail} onClick={() => void save({ matches_thumbnail: !s.matches_thumbnail }).then(setErr)} title="The first shot of the intro should match the thumbnail">
                  Matches thumbnail
                </Chip>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 pt-1">
              <button type="button" className={BTN_SM} disabled={busy} onClick={() => void run(() => addShot(s.video_id, { afterId: s.id, kind: "BR" }))}>
                + Shot for this line
              </button>
              <button type="button" className={BTN_SM} disabled={busy} onClick={() => confirm("Delete this shot?") && void run(() => deleteShot(s.id))}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Text field with suggestions from the values already used (datalist), saved on blur. */
function SuggestField({ value, list, onSave, placeholder }: { value: string; list: string; onSave: (v: string) => Promise<string | null>; placeholder?: string }) {
  const [t, setT] = useState(value);
  const [focused, setFocused] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!focused) setT(value);
  }, [value, focused]);
  return (
    <>
      <input
        className={INPUT}
        list={list}
        value={t}
        placeholder={placeholder}
        aria-label={placeholder}
        onFocus={() => setFocused(true)}
        onChange={(e) => setT(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        onBlur={async () => {
          setFocused(false);
          if (t !== value) setErr(await onSave(t));
        }}
      />
      {err && <Msg error={err} />}
    </>
  );
}
