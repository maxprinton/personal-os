"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { addToOutbox, flushOutbox, listOutbox } from "@/lib/outbox";

import { WritingInput } from "@/components/WritingField";
/**
 * One box for everything: "spent 12 on lunch", "task: call mom tomorrow", "note: idea…".
 * Works offline: items wait in the device and sync when the connection is back.
 */
export default function QuickCapture({
  autoFocus = false,
  accounts = [],
}: {
  autoFocus?: boolean;
  accounts?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(true);
  const [accountId, setAccountId] = useState("");

  useEffect(() => {
    const refresh = () => listOutbox().then((l) => setPending(l.length)).catch(() => {});
    const goOnline = async () => {
      setOnline(true);
      const n = await flushOutbox().catch(() => 0);
      if (n) {
        setMsg({ ok: true, text: `Synced ${n} item${n > 1 ? "s" : ""} saved offline.` });
        router.refresh();
      }
    };
    setOnline(navigator.onLine);
    refresh();
    if (navigator.onLine) goOnline();
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", () => setOnline(false));
    window.addEventListener("outbox-changed", refresh);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("outbox-changed", refresh);
    };
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    setBusy(true);
    setMsg(null);
    try {
      if (!navigator.onLine) throw new Error("offline");
      const res = await fetch("/api/capture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: value, accountId: accountId || null }),
      });
      const data = (await res.json().catch(() => ({}))) as { summary?: string; error?: string };
      if (!res.ok) {
        if (res.status >= 500) throw new Error("server");
        setMsg({ ok: false, text: data.error ?? "Could not save." });
      } else {
        setMsg({ ok: true, text: `Saved ✓ ${data.summary ?? ""}` });
        setText("");
        router.refresh();
      }
    } catch {
      await addToOutbox(value, accountId || null);
      setText("");
      setMsg({ ok: true, text: "Saved on this device. It will sync when you are back online." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex flex-wrap gap-2 sm:flex-nowrap">
        <WritingInput area="titles"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus={autoFocus}
          placeholder='Quick capture: "spent 12 on lunch", "task: call mom tomorrow"…'
          className="min-w-0 flex-1 basis-full rounded-md border border-line-strong px-3 py-2 text-sm sm:basis-auto"
        />
        {accounts.length > 0 && (
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            aria-label="Account for money captures"
            title="Account used when you capture an expense or income (an account named in the text wins)"
            className="min-w-0 flex-1 rounded-md border sm:max-w-[9rem] sm:flex-none border-line-strong px-2 py-2 text-sm"
          >
            <option value="">Account: auto</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        )}
        <button disabled={busy} className="rounded-md bg-accent font-medium shadow-sm transition-colors hover:bg-accent-hover px-3 py-2 text-sm text-accent-fg disabled:opacity-50">
          {busy ? "…" : "Save"}
        </button>
      </div>
      <div className="flex flex-wrap gap-3 text-xs">
        {!online && <span className="text-warning">Offline — captures are kept on this device.</span>}
        {pending > 0 && <span className="text-warning">{pending} waiting to sync</span>}
        {msg && <span className={msg.ok ? "text-success" : "text-danger"}>{msg.text}</span>}
      </div>
    </form>
  );
}
