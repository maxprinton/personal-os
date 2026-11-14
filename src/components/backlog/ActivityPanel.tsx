import Link from "next/link";
import type { ActivityRow } from "@/lib/backlog/data";

const ICON: Record<ActivityRow["kind"], string> = { start: "▶", update: "•", finish: "✓", blocked: "⛔", note: "📝", decision: "⚖" };
const LABEL: Record<ActivityRow["kind"], string> = { start: "Started", update: "Update", finish: "Finished", blocked: "Blocked", note: "Note", decision: "Decision" };

function ago(iso: string, nowMs: number): string {
  const m = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** What Claude is doing now and what it did lately (read-only; Claude writes it through claude_start / claude_log / claude_finish). */
export default function ActivityPanel({ rows, working, nowIso, title = "Claude at work", compact = false }: { rows: ActivityRow[]; working: ActivityRow[]; nowIso: string; title?: string; compact?: boolean }) {
  const nowMs = new Date(nowIso).getTime();
  if (!rows.length) return null;
  return (
    <section className={compact ? "card p-3" : "mb-5 rounded-2xl border border-line bg-surface p-4"}>
      <h2 className="text-sm font-semibold">{title}</h2>
      {working.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {working.map((w) => (
            <li key={w.id} className={`rounded-xl bg-accent-soft px-3 py-2 text-sm ${compact ? "line-clamp-3" : ""}`}>
              <span className="font-medium">Working now:</span> {w.text}
              {w.item && <> · <Link href={`/backlog/${w.item.number}`} className="underline">BL-{w.item.number}</Link></>}
              <span className="text-muted"> · started {ago(w.at, nowMs)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-muted">Claude is not working on anything right now.</p>
      )}
      <details className="mt-2">
        <summary className="cursor-pointer text-sm text-muted">Recent activity ({rows.length})</summary>
        <ul className={`mt-2 space-y-1.5 text-sm ${compact ? "max-h-64 overflow-y-auto" : ""}`}>
          {rows.map((r) => (
            <li key={r.id} className="flex gap-2">
              <span aria-hidden>{ICON[r.kind]}</span>
              <span>
                <span className="text-muted">{LABEL[r.kind]} · {ago(r.at, nowMs)} · </span>
                {r.text}
                {r.item && <> · <Link href={`/backlog/${r.item.number}`} className="underline">BL-{r.item.number}</Link></>}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
