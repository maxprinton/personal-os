"use client";
// ✨ Auto-categorize panel: reads every uncategorized transaction (history first, then the AI, one question per
// merchant), shows what it did with Undo, and lists NEW categories the AI proposes for you to approve or skip.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { approveCategoryProposal, confirmAutoCategories, rejectCategoryProposal, undoAutoCategorize } from "@/app/categorize-actions";
import { showAiUsage } from "@/lib/ai-usage-client";
import type { RoundResult } from "@/lib/auto-categorize";
import type { Proposal } from "@/lib/category-proposals";
import { btnPrimary, btnSecondary, inputCls } from "@/components/calendar/Modal";

type Round = RoundResult & { usage?: string | null };
type Summary = { categorized: number; byHistory: number; byAi: number; unsure: number; proposed: { name: string; count: number }[]; applied: { id: string; categoryId: string }[]; note?: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const wait429 = /limit is used up|busy|too long/i;

export default function AutoCategorize({
  uncategorized = 0,
  autoCount = 0,
  proposals = [],
  onShow,
  autoStart = false,
}: {
  uncategorized?: number;
  autoCount?: number;
  proposals?: Proposal[];
  onShow?: (filter: "none" | "auto") => void;
  autoStart?: boolean;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const started = useRef(false);

  async function run() {
    setRunning(true);
    setError("");
    setSummary(null);
    const sum: Summary = { categorized: 0, byHistory: 0, byAi: 0, unsure: 0, proposed: [], applied: [] };
    let skip: string[] = [];
    let retried = 0;
    try {
      for (let i = 0; i < 40; i++) {
        setProgress(i === 0 ? "Reading your transactions…" : `Categorized ${sum.categorized} so far…`);
        const res = await fetch("/api/categorize", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ skip }) });
        const r = (await res.json().catch(() => null)) as (Round & { error?: string }) | null;
        if (!r) throw new Error(res.status === 504 ? "The AI took too long. Press the button again to continue." : "No answer. Press the button again to continue.");
        if (r.usage) showAiUsage(r.usage);
        sum.categorized += r.categorized;
        sum.byHistory += r.byHistory;
        sum.byAi += r.byAi;
        sum.applied.push(...r.applied);
        for (const p of r.proposed) sum.proposed.push({ name: p.name, count: p.count });
        skip = [...skip, ...r.unsure];
        sum.unsure = skip.length;
        if (r.aiOff) sum.note = "The AI isn't connected (GROQ_API_KEY), so only your own habits were used.";
        if (r.proposalsOff && !sum.note) sum.note = "To let the AI propose new categories, run MIGRACION-0026-categorias-automaticas.sql in Supabase.";
        else if (!r.markers && !sum.note) sum.note = "Run MIGRACION-0026-categorias-automaticas.sql in Supabase to see ✨ marks and review the guesses.";
        if (r.error) {
          if (wait429.test(r.error) && retried < 2) {
            retried++;
            for (let s = 30; s > 0; s--) {
              setProgress(`Waiting for the free AI limit to reset… ${s}s`);
              await sleep(1000);
            }
            continue;
          }
          setError(`${r.error} Everything done so far is kept; press the button again to continue.`);
          break;
        }
        if (r.left === 0 || r.aiOff) break;
        await sleep(r.byAi || r.proposed.length ? 5000 : 0); // gentle with the free AI limit per minute
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Press the button again.");
    }
    setSummary(sum);
    setRunning(false);
    router.refresh();
  }

  useEffect(() => {
    if (autoStart && !started.current) {
      started.current = true;
      void run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function undo() {
    if (!summary) return;
    const r = await undoAutoCategorize(summary.applied);
    setSummary(null);
    setProgress(r.ok ? `Undone: ${r.undone ?? 0} back to uncategorized.` : r.error ?? "");
    router.refresh();
  }

  const nothing = !running && !summary && uncategorized === 0 && autoCount === 0 && proposals.length === 0;
  if (nothing && !autoStart) return null;

  return (
    <div className="space-y-2 rounded-lg border border-accent/30 bg-subtle p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">✨ Auto-categorize</span>
        {!running && uncategorized > 0 && (
          <>
            <span className="text-muted">{uncategorized} uncategorized</span>
            <button type="button" onClick={run} className={`${btnPrimary} ml-auto`}>Categorize them with AI</button>
          </>
        )}
        {!running && uncategorized === 0 && !summary && <span className="text-muted">Every transaction has a category.</span>}
        {running && <span className="text-muted">{progress}</span>}
      </div>

      {error && <p className="text-danger">{error}</p>}

      {summary && (
        <div className="space-y-1">
          <p>
            <span className="font-medium">{summary.categorized}</span> categorized
            {summary.byHistory > 0 && ` (${summary.byHistory} from your habits, ${summary.byAi} by AI)`}
            {summary.proposed.length > 0 && <> · <span className="font-medium">{summary.proposed.length}</span> new categor{summary.proposed.length === 1 ? "y" : "ies"} proposed below</>}
            {summary.unsure > 0 && <> · <span className="font-medium">{summary.unsure}</span> too unclear — left for you</>}.
          </p>
          {summary.note && <p className="text-xs text-warning">{summary.note}</p>}
          <div className="flex flex-wrap gap-2">
            {summary.unsure > 0 && onShow && <button type="button" onClick={() => onShow("none")} className={btnSecondary}>Show the ones left</button>}
            {summary.categorized > 0 && onShow && <button type="button" onClick={() => onShow("auto")} className={btnSecondary}>Review the ✨ guesses</button>}
            {summary.applied.length > 0 && <button type="button" onClick={undo} className={btnSecondary}>Undo this run</button>}
          </div>
        </div>
      )}

      {!running && autoCount > 0 && !summary && (
        <p className="flex flex-wrap items-center gap-2 text-muted">
          <span>✨ {autoCount} categorized automatically</span>
          {onShow && <button type="button" onClick={() => onShow("auto")} className="text-accent hover:underline">Review</button>}
          <button
            type="button"
            onClick={async () => {
              await confirmAutoCategories();
              router.refresh();
            }}
            className="text-accent hover:underline"
          >
            Looks right — confirm all
          </button>
        </p>
      )}

      {proposals.length > 0 && !running && (
        <div className="space-y-2 border-t border-line pt-2">
          <p className="font-medium">New categories proposed by the AI</p>
          {proposals.map((p) => (
            <ProposalCard key={p.id} p={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProposalCard({ p }: { p: Proposal }) {
  const router = useRouter();
  const [name, setName] = useState(p.name);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function approve() {
    setBusy(true);
    const r = await approveCategoryProposal(p.id, name);
    if (!r.ok) {
      setErr(r.error);
      setBusy(false);
      return;
    }
    router.refresh();
  }
  async function skip() {
    setBusy(true);
    const r = await rejectCategoryProposal(p.id);
    if (!r.ok) setErr(r.error ?? "");
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="space-y-1.5 rounded-md border border-line bg-surface p-2">
      <p className="text-muted">
        {p.count} {p.kind} transaction{p.count === 1 ? "" : "s"}
        {p.samples.length > 0 && <> like “{p.samples.join("”, “")}”</>} don&apos;t fit any of your categories.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Category name" className={`${inputCls} max-w-[12rem]`} />
        <span className="text-xs text-faint">({p.kind})</span>
        <button type="button" disabled={busy || !name.trim()} onClick={approve} className={btnPrimary}>Create &amp; apply</button>
        <button type="button" disabled={busy} onClick={skip} className={btnSecondary}>Skip</button>
      </div>
      {err && <p className="text-xs text-danger">{err}</p>}
    </div>
  );
}
