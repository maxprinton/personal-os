"use client";
// /youtube/weekly UI (Worker C): "Run now" (+ send to Telegram) and the past reviews (Markdown shown simply).
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { YtWeekly } from "@/lib/youtube/types";
import { runWeeklyNow } from "@/app/youtube-actions/results";
import { BOX, PRIMARY } from "@/components/youtube/results/ui";

function SimpleMd({ text }: { text: string }) {
  return (
    <div className="space-y-1 text-sm">
      {text.split("\n").map((l, i) =>
        l.startsWith("## ") ? (
          <p key={i} className="pt-2 font-semibold">
            {l.slice(3)}
          </p>
        ) : l.startsWith("- ") ? (
          <p key={i} className="pl-4">
            • {l.slice(2)}
          </p>
        ) : l.startsWith("> ") ? (
          <p key={i} className="rounded bg-warning-soft px-2 py-1">
            {l.slice(2)}
          </p>
        ) : l.trim() ? (
          <p key={i}>{l}</p>
        ) : null,
      )}
    </div>
  );
}

export default function WeeklyView({ rows, telegram }: { rows: YtWeekly[]; telegram: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [send, setSend] = useState(telegram);
  const [msg, setMsg] = useState<{ error?: string; info?: string } | null>(null);
  const [openId, setOpenId] = useState<string | null>(rows[0]?.id ?? null);
  return (
    <div className="space-y-4">
      <div className={`${BOX} flex flex-wrap items-center gap-3`}>
        <button
          type="button"
          className={PRIMARY}
          disabled={pending}
          onClick={() =>
            start(async () => {
              setMsg(null);
              const r = await runWeeklyNow(send);
              setMsg(r.error ? { error: r.error } : { info: r.info });
              router.refresh();
            })
          }
        >
          {pending ? "Building…" : "Run the review now"}
        </button>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={send} disabled={!telegram} onChange={(e) => setSend(e.target.checked)} /> Also send to Telegram {telegram ? "" : "(bot not linked)"}
        </label>
        <span className="text-xs text-muted">Covers the last 7 days. Running it again the same week updates that week’s review and note.</span>
        {msg && <p className={`w-full text-sm ${msg.error ? "text-danger" : "text-success"}`}>{msg.error ?? msg.info}</p>}
      </div>
      {!rows.length && <p className="text-sm text-muted">No reviews yet.</p>}
      {rows.map((r) => (
        <section key={r.id} className={BOX}>
          <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setOpenId(openId === r.id ? null : r.id)}>
            <span className="font-semibold">Week of {r.week_start}</span>
            <span className="text-xs text-muted">
              {r.sent_at ? "sent to Telegram · " : ""}
              {openId === r.id ? "▲" : "▼"}
            </span>
          </button>
          {openId === r.id && (
            <>
              <SimpleMd text={r.summary} />
              {r.note_id && (
                <Link className="text-sm text-accent underline" href={`/notes/${r.note_id}`}>
                  Open the note →
                </Link>
              )}
            </>
          )}
        </section>
      ))}
    </div>
  );
}
