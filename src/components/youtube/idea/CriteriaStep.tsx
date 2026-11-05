"use client";
// Ideation step 4 · Criteria: 3 gates (hard), view potential from references, 5 ratings, weighted score,
// approve → Package (the database gives the V-number). A failed gate keeps the idea in the bank.
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { approveIdea, saveCriteria } from "@/app/youtube-actions/ideas";
import { GATES, RATINGS, RATING_MAX, RATING_MIN, videoHref } from "@/lib/youtube/constants";
import { canApprove, dataScore, gateStatus, ideaScore } from "@/lib/youtube/scoring";
import type { Gates, Ratings } from "@/lib/youtube/types";
import type { IdeaPageData } from "@/components/youtube/idea/IdeaStepper";
import { BOX, INPUT, Msg, PRIMARY, BTN } from "@/components/youtube/idea/ui";

export default function CriteriaStep({ data }: { data: IdeaPageData }) {
  const { video } = data;
  const router = useRouter();
  const [gates, setGates] = useState<Gates>(video.gates ?? {});
  const [ratings, setRatings] = useState<Ratings>(video.ratings ?? {});
  const ds = dataScore(data.refs, data.viewGoal);
  const [manual, setManual] = useState<number | null>(ds.score == null ? video.view_potential : null);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ error?: string; info?: string }>({});
  const [approved, setApproved] = useState<{ code: string | null; warn: string | null } | null>(null);
  const [pending, start] = useTransition();
  const vp = ds.score ?? manual;
  const score = useMemo(() => ideaScore(ratings, vp, data.weights), [ratings, vp, data.weights]);
  const g = gateStatus(gates);
  const isBank = video.stage === "bank" || video.stage === "idea";
  const check = canApprove({ stage: video.stage, gates, idea_name: video.idea_name });

  const setGate = (k: keyof Gates, v: boolean | null) => {
    setGates((x) => ({ ...x, [k]: v }));
    setDirty(true);
  };
  const setRating = (k: keyof Ratings, v: number | null) => {
    setRatings((x) => {
      const n = { ...x };
      if (v == null) delete n[k];
      else n[k] = v;
      return n;
    });
    setDirty(true);
  };
  const save = () =>
    new Promise<boolean>((resolve) =>
      start(async () => {
        const r = await saveCriteria(video.id, { gates, ratings, manualViewPotential: ds.score == null ? manual : undefined });
        if (r.error) {
          setMsg({ error: r.error });
          resolve(false);
        } else {
          setDirty(false);
          setMsg({ info: `Saved. Score ${r.score ?? "—"}.` });
          router.refresh();
          resolve(true);
        }
      }),
    );
  const approve = async () => {
    if (dirty && !(await save())) return;
    start(async () => {
      const r = await approveIdea(video.id);
      if (r.error) setMsg({ error: r.error });
      else {
        setApproved({ code: r.code ?? null, warn: r.wipWarning ?? null });
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className={BOX}>
        <h3 className="text-sm font-semibold">1 · Gates — all three must be “yes” to leave the bank</h3>
        <ul className="space-y-2">
          {GATES.map((gate) => {
            const v = gates[gate.id];
            return (
              <li key={gate.id} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">{gate.label}</p>
                  <p className="text-xs text-muted">{gate.question}</p>
                </div>
                <div role="radiogroup" aria-label={gate.label} className="flex overflow-hidden rounded-md border border-line-strong text-xs">
                  {([
                    [true, "Yes", "bg-success-soft text-success"],
                    [null, "Not sure", "bg-subtle text-fg"],
                    [false, "No", "bg-danger-soft text-danger"],
                  ] as const).map(([val, label, on]) => (
                    <button key={label} type="button" role="radio" aria-checked={v === val || (val === null && v == null)} onClick={() => setGate(gate.id, val)} className={`px-3 py-1.5 ${v === val || (val === null && v == null) ? `${on} font-semibold` : "text-muted hover:bg-subtle"}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
        <textarea
          rows={2}
          value={gates.notes ?? ""}
          onChange={(e) => {
            setGates((x) => ({ ...x, notes: e.target.value }));
            setDirty(true);
          }}
          placeholder="Notes (e.g. the quick title + thumbnail idea for Packageability)"
          className={INPUT}
          aria-label="Gate notes"
        />
        {g === "fail" && <p className="rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">A gate says no: the idea stays in the bank (never deleted). Try another angle or format, or park it.</p>}
      </div>

      <div className={BOX}>
        <h3 className="text-sm font-semibold">2 · View potential</h3>
        {ds.score != null ? (
          <p className="text-sm">
            <b className="text-lg tabular-nums">{ds.score}</b>/10 from {ds.n} saved reference{ds.n === 1 ? "" : "s"} <span className="text-xs text-muted">· {ds.why}</span>
          </p>
        ) : (
          <div className="space-y-1">
            <p className="text-xs text-muted">{ds.why} Until then, your own guess:</p>
            <RatingInput value={manual} onChange={(v) => {
              setManual(v);
              setDirty(true);
            }} label="View potential (your guess)" />
          </div>
        )}
      </div>

      <div className={BOX}>
        <h3 className="text-sm font-semibold">3 · Your ratings (1–10)</h3>
        <ul className="space-y-2">
          {RATINGS.map((r) => (
            <li key={r.id} className="grid items-center gap-1 sm:grid-cols-[14rem_1fr]">
              <span className="text-sm">
                {r.label}
                {r.sign < 0 && <span className="ml-1 text-xs text-muted">(more effort = lower score)</span>}
              </span>
              <RatingInput value={ratings[r.id] ?? null} onChange={(v) => setRating(r.id, v)} label={r.label} />
            </li>
          ))}
        </ul>
      </div>

      <div className={`${BOX} sm:flex sm:items-center sm:justify-between sm:space-y-0`}>
        <div>
          <p className="text-sm">
            Idea score: <b className="text-2xl tabular-nums">{score.score ?? "—"}</b>
            <span className="text-xs text-muted"> / 100</span>
          </p>
          <p className="text-[11px] text-faint">
            Weighted: {score.parts.map((p) => `${p.key.replace("_", " ")} ×${p.weight}`).join(" · ") || "rate something"} — change weights in Settings later (calibration).
          </p>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 sm:mt-0">
          <button type="button" onClick={() => void save()} disabled={pending || !dirty} className={BTN}>
            {pending ? "Saving…" : dirty ? "Save" : "Saved"}
          </button>
          {isBank && (
            <button type="button" onClick={() => void approve()} disabled={pending || !check.ok} className={PRIMARY} title={check.reason}>
              Approve → Package
            </button>
          )}
        </div>
      </div>
      <Msg {...msg} />
      {isBank && !check.ok && <p className="text-xs text-muted">{check.reason}</p>}
      {approved && (
        <div className="rounded-md bg-success-soft px-3 py-2 text-sm text-success">
          ✅ Approved{approved.code ? ` as ${approved.code}` : ""}.{" "}
          <Link href={videoHref(video.id, "package")} className="font-medium underline-offset-2 hover:underline">
            Package it →
          </Link>
          {approved.warn && <p className="mt-1 text-warning">{approved.warn}</p>}
        </div>
      )}
    </div>
  );
}

function RatingInput({ value, onChange, label }: { value: number | null; onChange: (v: number | null) => void; label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label={label}>
      {Array.from({ length: RATING_MAX - RATING_MIN + 1 }, (_, i) => i + RATING_MIN).map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          onClick={() => onChange(value === n ? null : n)}
          className={`h-7 w-7 rounded text-xs tabular-nums ${value === n ? "bg-accent font-semibold text-accent-fg" : value != null && n < value ? "bg-accent-soft text-accent" : "border border-line text-muted hover:bg-subtle"}`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}
