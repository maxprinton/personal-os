"use client";
// One research card (Worker A): whole note · fragment (quote → exact block) · quick card · link · outlier
// reference. Annotation under it. "Move to…" / "Copy to…" buttons always work (phones have no drag).
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deleteCard, moveCard, copyCard, quickCardToNote, updateCard } from "@/app/youtube-actions/research";
import { noteHref } from "@/lib/youtube/research";
import { fmtViews } from "@/lib/youtube/scoring";
import { videoHref } from "@/lib/youtube/constants";
import { AutoField, BTN_SM, Msg } from "@/components/youtube/idea/ui";
import { DND, labVideoLabel, type LabBucket, type LabCard, type LabNote, type LabOption, type LabReference, type LabVideo } from "./shared";

const KIND_ICON: Record<string, string> = { note: "📄", fragment: "❝", quick: "💭", link: "🔗", reference: "🎬" };

export default function CardItem({
  card,
  note,
  reference,
  usedIn,
  buckets,
  copyTargets,
  typeOptions,
  draggable,
  onDropBefore,
}: {
  card: LabCard;
  note: LabNote | null;
  reference: LabReference | null;
  usedIn: LabVideo[];
  /** Buckets of the same board ("Move to…"). */
  buckets: LabBucket[];
  /** Buckets of another board ("Copy to…": shelf → this video). */
  copyTargets?: { label: string; buckets: LabBucket[] };
  typeOptions: LabOption[];
  draggable: boolean;
  onDropBefore?: (e: React.DragEvent) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ error?: string; info?: string }>({});
  const [editing, setEditing] = useState(false);
  const run = (fn: () => Promise<{ error?: string; noteId?: string }>, info?: string) =>
    start(async () => {
      const r = await fn();
      setMsg(r.error ? { error: r.error } : { info });
      if (!r.error) router.refresh();
    });
  const others = buckets.filter((b) => b.id !== card.bucket_id);
  const type = note?.typeId ? typeOptions.find((o) => o.id === note.typeId) : null;
  const missingNote = (card.kind === "note" || card.kind === "fragment") && card.note_id && !note;

  return (
    <li
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData(DND, JSON.stringify({ t: copyTargets ? "copy" : "card", id: card.id }));
        e.dataTransfer.effectAllowed = copyTargets ? "copy" : "move";
      }}
      onDragOver={onDropBefore ? (e) => e.preventDefault() : undefined}
      onDrop={onDropBefore}
      className={`space-y-1.5 rounded-md border border-line bg-surface p-2.5 text-sm shadow-card ${draggable ? "cursor-grab active:cursor-grabbing" : ""} ${pending ? "opacity-60" : ""}`}
    >
      <div className="flex items-start gap-1.5">
        <span aria-hidden className="mt-0.5 text-xs">{KIND_ICON[card.kind] ?? "•"}</span>
        <div className="min-w-0 flex-1 space-y-1">
          {card.kind === "note" &&
            (note ? (
              <>
                <Link href={noteHref(note.id)} className="font-medium text-fg hover:underline">
                  {note.icon ? `${note.icon} ` : ""}
                  {note.title || "Untitled"}
                </Link>
                {(note.summary || note.text) && <p className="line-clamp-3 text-xs text-muted">{note.summary || note.text}</p>}
                <div className="flex flex-wrap gap-1">
                  {type && <span className="rounded bg-subtle px-1.5 text-[11px] text-muted">{type.name}</span>}
                  {note.tags.slice(0, 4).map((t) => (
                    <span key={t} className="rounded bg-accent-soft px-1.5 text-[11px] text-accent">#{t}</span>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-xs text-muted">This note was deleted or moved to the trash.</p>
            ))}
          {card.kind === "fragment" && (
            <>
              <blockquote className="border-l-2 border-accent/50 pl-2 text-sm italic text-fg">{card.quote_text}</blockquote>
              {card.note_id && (
                <Link href={noteHref(card.note_id, card.block_id)} className="text-xs text-accent hover:underline">
                  {note ? `from “${note.title || "Untitled"}”` : "open the note"} →
                </Link>
              )}
            </>
          )}
          {card.kind === "quick" &&
            (editing ? (
              <AutoField
                value={card.text ?? ""}
                multiline
                rows={3}
                label="Quick card"
                onSave={async (v) => {
                  const r = await updateCard(card.id, { text: v });
                  if (!r.error) router.refresh();
                  return r.error ?? null;
                }}
              />
            ) : (
              <button type="button" className="w-full whitespace-pre-wrap text-left text-sm text-fg" title="Click to edit" onClick={() => setEditing(true)}>
                {card.text}
              </button>
            ))}
          {card.kind === "link" && card.url && (
            <a href={card.url} target="_blank" rel="noreferrer" className="flex gap-2 rounded border border-line p-1.5 hover:bg-subtle">
              {card.preview?.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={card.preview.image} alt="" className="h-12 w-20 shrink-0 rounded object-cover" loading="lazy" />
              )}
              <span className="min-w-0">
                <span className="line-clamp-2 block text-sm font-medium text-fg">{card.preview?.title || card.url}</span>
                {card.preview?.description && <span className="line-clamp-2 block text-xs text-muted">{card.preview.description}</span>}
                <span className="block text-[11px] text-faint">{card.preview?.site}</span>
              </span>
            </a>
          )}
          {card.kind === "reference" &&
            (reference ? (
              <a href={reference.url} target="_blank" rel="noreferrer" className="flex gap-2 rounded border border-line p-1.5 hover:bg-subtle">
                {reference.thumbnail_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={reference.thumbnail_url} alt="" className="h-12 w-20 shrink-0 rounded object-cover" loading="lazy" />
                )}
                <span className="min-w-0">
                  <span className="line-clamp-2 block text-sm font-medium text-fg">{reference.title}</span>
                  <span className="block text-[11px] text-faint">
                    {reference.channel_title ?? ""}
                    {reference.views != null ? ` · ${fmtViews(reference.views)} views` : ""}
                    {reference.outlier_score ? ` · ${reference.outlier_score}× outlier` : ""}
                  </span>
                </span>
              </a>
            ) : (
              <p className="text-xs text-muted">Reference not found.</p>
            ))}
          {missingNote && card.kind === "fragment" && <p className="text-[11px] text-warning">⚠ The note of this quote was deleted.</p>}
          {usedIn.length > 1 && (
            <p className="text-[11px] text-faint">
              Used in:{" "}
              {usedIn.map((v, i) => (
                <span key={v.id}>
                  {i > 0 && ", "}
                  <Link href={videoHref(v.id, "research")} className="hover:underline">
                    {labVideoLabel(v)}
                  </Link>
                </span>
              ))}
            </p>
          )}
        </div>
      </div>
      <AutoField
        value={card.annotation ?? ""}
        placeholder="Annotation (e.g. “for the intro”)"
        label="Annotation"
        maxLength={300}
        className="w-full rounded border border-transparent bg-subtle/50 px-2 py-0.5 text-xs text-muted placeholder:text-faint focus:border-line-strong focus:text-fg"
        onSave={async (v) => {
          const r = await updateCard(card.id, { annotation: v });
          return r.error ?? null;
        }}
      />
      <div className="flex flex-wrap items-center gap-1">
        {others.length > 0 && !copyTargets && (
          <select
            aria-label="Move to"
            className="rounded border border-line bg-surface px-1 py-0.5 text-xs text-muted"
            value=""
            disabled={pending}
            onChange={(e) => e.target.value && run(() => moveCard(card.id, e.target.value), "Moved.")}
          >
            <option value="">Move to…</option>
            {others.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        {copyTargets && copyTargets.buckets.length > 0 && card.kind !== "reference" && (
          <select
            aria-label={copyTargets.label}
            className="rounded border border-line bg-surface px-1 py-0.5 text-xs text-muted"
            value=""
            disabled={pending}
            onChange={(e) => e.target.value && run(() => copyCard(card.id, e.target.value), "Copied.")}
          >
            <option value="">{copyTargets.label}</option>
            {copyTargets.buckets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        {card.kind === "quick" && (
          <button type="button" className={BTN_SM} disabled={pending} onClick={() => run(() => quickCardToNote(card.id), "Now it's a note in Notes.")}>
            Turn into note
          </button>
        )}
        {!copyTargets && (
          <button
            type="button"
            className={`${BTN_SM} ml-auto`}
            disabled={pending}
            onClick={() => {
              const ask = card.kind === "reference" ? "Remove this reference from the video?" : "Remove this card? (The note itself is not touched.)";
              if (confirm(ask)) run(() => deleteCard(card.id));
            }}
          >
            Remove
          </button>
        )}
      </div>
      <Msg {...msg} />
    </li>
  );
}
