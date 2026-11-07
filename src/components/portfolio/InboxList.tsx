"use client";
// Portfolio add-on, Phase 6 — messages as cards (readable on a phone).
import { deleteAction, emptySpamAction, handledAction, readAction, readAllAction, spamAction } from "@/app/portfolio-inbox-actions";
import { ActForm, BOX, BTN_PLAIN } from "@/components/portfolio/ui";
import { replyHref, type InboxRow } from "@/lib/portfolio/inbox";

const MINI = "rounded-md border border-line-strong bg-surface px-2.5 py-1 text-xs hover:bg-subtle disabled:opacity-60";
const when = (iso: string) => new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC";

function Tiny({ action, id, value, label, confirm, tone }: { action: (p: never, f: FormData) => Promise<never>; id: string; value?: string; label: string; confirm?: string; tone?: string }) {
  return (
    <ActForm action={action as never} saved="" confirm={confirm}>
      {(pending) => (
        <>
          <input type="hidden" name="id" value={id} />
          {value !== undefined && <input type="hidden" name="value" value={value} />}
          <button className={`${MINI} ${tone ?? ""}`} disabled={pending}>
            {label}
          </button>
        </>
      )}
    </ActForm>
  );
}

export default function InboxList({ rows, spamTab }: { rows: InboxRow[]; spamTab: boolean }) {
  return (
    <div className="space-y-3">
      {rows.length > 0 && (
        <div className="flex justify-end">
          {spamTab ? (
            <ActForm action={emptySpamAction} saved="Emptied ✓" confirm="Delete all spam for good?">
              {(pending) => (
                <button className={BTN_PLAIN} disabled={pending}>
                  Empty spam
                </button>
              )}
            </ActForm>
          ) : (
            rows.some((r) => !r.read_at) && (
              <ActForm action={readAllAction} saved="">
                {(pending) => (
                  <button className={BTN_PLAIN} disabled={pending}>
                    Mark all as read
                  </button>
                )}
              </ActForm>
            )
          )}
        </div>
      )}
      {rows.length === 0 && <p className="text-sm text-muted">{spamTab ? "No spam. Good." : "No messages yet. They show up here when someone uses the contact form."}</p>}
      {rows.map((m) => {
        const href = replyHref(m);
        return (
          <article key={m.id} className={`${BOX} ${!m.read_at && !spamTab ? "border-accent" : ""}`}>
            <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="text-sm font-medium">
                {!m.read_at && !spamTab && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-accent align-middle" aria-label="Unread" />}
                {m.name || "(no name)"} <span className="font-normal text-muted">{m.email}</span>
              </p>
              <p className="text-xs text-muted">
                {when(m.created_at)}
                {m.lang ? ` · ${m.lang.toUpperCase()}` : ""}
                {m.handled_at ? " · Handled" : ""}
                {spamTab ? ` · score ${m.spam_score}` : ""}
              </p>
            </header>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm">{m.message}</p>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {href && !spamTab && (
                <a href={href} className={MINI}>
                  Reply by email
                </a>
              )}
              {!spamTab && <Tiny action={readAction as never} id={m.id} value={m.read_at ? "0" : "1"} label={m.read_at ? "Mark unread" : "Mark read"} />}
              {!spamTab && <Tiny action={handledAction as never} id={m.id} value={m.handled_at ? "0" : "1"} label={m.handled_at ? "Reopen" : "Handled"} />}
              <Tiny action={spamAction as never} id={m.id} value={spamTab ? "0" : "1"} label={spamTab ? "Not spam" : "Spam"} />
              <Tiny action={deleteAction as never} id={m.id} label="Delete" confirm="Delete this message for good?" tone="text-danger" />
            </div>
          </article>
        );
      })}
    </div>
  );
}
