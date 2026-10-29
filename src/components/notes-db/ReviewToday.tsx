"use client";

// Today: "📖 Notes to review" — the notes whose built-in "Review on" date has come (or passed, up to two
// weeks). ✓ Reviewed clears the date; +1 week / +1 month moves it. Hidden when there is nothing to review.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Section from "@/components/ui/Section";
import { markReviewed, reviewAgain } from "@/app/notes-review-actions";
import type { ReviewNote } from "@/lib/notes-db/review";

const MAX = 10;

export default function ReviewToday({ notes }: { notes: ReviewNote[] }) {
  const router = useRouter();
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const list = notes.filter((n) => !gone.has(n.id));
  if (!list.length) return null;

  async function act(id: string, run: () => Promise<{ ok?: boolean; error?: string }>) {
    setBusy(id);
    setErr(null);
    const r = await run().catch(() => ({ error: "Couldn't save it. Try again." }));
    setBusy(null);
    if ("error" in r && r.error) {
      setErr(r.error);
      return;
    }
    setGone((s) => new Set(s).add(id));
    router.refresh();
  }

  const btn = "compact rounded-md border border-line px-2 py-1 text-xs font-medium whitespace-nowrap text-muted transition-colors hover:border-edge hover:text-fg disabled:opacity-50";
  return (
    <Section title="📖 Notes to review" count={list.length} href="/notes" linkLabel="Notes">
      <ul className="card divide-y divide-line text-sm">
        {list.slice(0, MAX).map((n) => (
          <li key={n.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2.5">
            <Link href={`/notes/${n.id}`} className="flex min-w-0 flex-1 items-center gap-2 hover:text-accent">
              <span className="w-5 shrink-0 text-center" aria-hidden>
                {n.icon || "📄"}
              </span>
              <span className="min-w-0 truncate font-medium">{n.title || "Untitled"}</span>
              {n.overdueDays > 0 ? (
                <span className="shrink-0 text-xs text-warning">overdue {n.overdueDays} d</span>
              ) : (
                <span className="shrink-0 text-xs text-muted">today</span>
              )}
            </Link>
            <span className="flex shrink-0 items-center gap-1.5">
              <button type="button" disabled={busy === n.id} onClick={() => act(n.id, () => markReviewed(n.id))} className={btn} title="Reviewed: clears “Review on”">
                ✓ Reviewed
              </button>
              <button type="button" disabled={busy === n.id} onClick={() => act(n.id, () => reviewAgain(n.id, 7))} className={btn} title="Review it again in a week">
                +1 week
              </button>
              <button type="button" disabled={busy === n.id} onClick={() => act(n.id, () => reviewAgain(n.id, 30))} className={btn} title="Review it again in a month">
                +1 month
              </button>
            </span>
          </li>
        ))}
        {list.length > MAX && (
          <li className="px-3 py-2 text-xs text-muted">
            +{list.length - MAX} more · <Link href="/notes" className="font-medium text-accent hover:underline">open Notes</Link>
          </li>
        )}
      </ul>
      {err && <p className="text-xs text-danger">{err}</p>}
    </Section>
  );
}
