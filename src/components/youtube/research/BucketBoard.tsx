"use client";
// Buckets of a video — or the topic shelves (videoId null) — with their cards (Worker A).
// Rename / add / delete / reorder buckets; drop notes and cards (desktop); add quick cards, links and
// new notes inside a bucket. Phones: every move has a button.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addBucket, addLinkCard, addNoteCard, addQuickCard, copyCard, deleteBucket, moveCard, newNoteInBucket, reorderBuckets, restoreDefaultBuckets, updateBucket,
} from "@/app/youtube-actions/research";
import { moveItem, positionBetween } from "@/lib/youtube/research";
import { BTN, BTN_SM, INPUT, Msg } from "@/components/youtube/idea/ui";
import CardItem from "./CardItem";
import { hasDrag, readDrag, type LabBucket, type LabCard, type LabNote, type LabOption, type LabReference, type LabVideo } from "./shared";

type Props = {
  videoId: string | null;
  buckets: LabBucket[];
  cards: LabCard[];
  notesById: Map<string, LabNote>;
  refsById: Map<string, LabReference>;
  usedIn: Record<string, LabVideo[]>;
  typeOptions: LabOption[];
  canDrag: boolean;
};

export default function BucketBoard(p: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ error?: string; info?: string }>({});
  const [newName, setNewName] = useState("");
  const shelf = p.videoId === null;
  const run = (fn: () => Promise<{ error?: string }>, info?: string) =>
    start(async () => {
      const r = await fn();
      setMsg(r.error ? { error: r.error } : { info });
      if (!r.error) router.refresh();
    });

  const reorder = (from: number, to: number) => run(() => reorderBuckets(moveItem(p.buckets, from, to).map((b) => b.id)));

  /** A note or card dropped on a bucket (before `beforeCard`, or at the end). */
  const drop = (bucket: LabBucket, e: React.DragEvent, beforeCard?: LabCard) => {
    const d = readDrag(e.dataTransfer);
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    if (d.t === "note") return run(() => addNoteCard(bucket.id, d.id), "Added.");
    if (d.t === "copy") return run(() => copyCard(d.id, bucket.id), "Copied.");
    if (d.id === beforeCard?.id) return;
    let position: number | undefined;
    if (beforeCard) {
      const list = p.cards.filter((c) => c.bucket_id === bucket.id && c.id !== d.id).sort((a, b) => a.position - b.position);
      const i = list.findIndex((c) => c.id === beforeCard.id);
      position = positionBetween(i > 0 ? list[i - 1].position : null, beforeCard.position);
    }
    run(() => moveCard(d.id, bucket.id, position));
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {p.buckets.map((b, i) => (
          <Bucket
            key={b.id}
            {...p}
            bucket={b}
            index={i}
            shelf={shelf}
            pending={pending}
            onReorder={reorder}
            onDrop={drop}
            run={run}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={`${INPUT} max-w-xs`}
          placeholder={shelf ? "New topic shelf (e.g. ESL teaching tips)" : "New bucket name"}
          value={newName}
          maxLength={60}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newName.trim()) {
              e.preventDefault();
              run(() => addBucket(p.videoId, newName), "Added.");
              setNewName("");
            }
          }}
        />
        <button
          type="button"
          className={BTN}
          disabled={pending || !newName.trim()}
          onClick={() => {
            run(() => addBucket(p.videoId, newName), "Added.");
            setNewName("");
          }}
        >
          + {shelf ? "Shelf" : "Bucket"}
        </button>
        {!shelf && p.videoId && (
          <button type="button" className={BTN_SM} disabled={pending} onClick={() => run(() => restoreDefaultBuckets(p.videoId as string), "Default buckets are back.")}>
            Restore default buckets
          </button>
        )}
        <Msg {...msg} />
      </div>
    </div>
  );
}

function Bucket(
  p: Props & {
    bucket: LabBucket;
    index: number;
    shelf: boolean;
    pending: boolean;
    onReorder: (from: number, to: number) => void;
    onDrop: (b: LabBucket, e: React.DragEvent, before?: LabCard) => void;
    run: (fn: () => Promise<{ error?: string }>, info?: string) => void;
  },
) {
  const { bucket: b, index: i } = p;
  const [over, setOver] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(b.name);
  const [adding, setAdding] = useState<"quick" | "link" | "note" | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const cards = p.cards.filter((c) => c.bucket_id === b.id).sort((a, c) => a.position - c.position);

  const submit = async () => {
    const v = value.trim();
    if (!v && adding !== "note") return;
    setBusy(true);
    if (adding === "quick") p.run(() => addQuickCard(b.id, v), "Added.");
    else if (adding === "link") {
      let preview: { title?: string | null; description?: string | null; image?: string | null } | undefined;
      try {
        const url = /^https?:\/\//i.test(v) ? v : `https://${v}`;
        const r = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`);
        if (r.ok) preview = (await r.json()) as typeof preview;
      } catch {
        // no preview: the card still keeps the link
      }
      p.run(() => addLinkCard(b.id, v, preview), "Added.");
    } else if (adding === "note") {
      const r = await newNoteInBucket(b.id, v);
      if (r.error) alert(r.error);
      else {
        router.refresh();
        if (r.noteId && confirm("Note created in Notes (Type: Research). Open it now?")) router.push(`/notes/${r.noteId}`);
      }
    }
    setBusy(false);
    setValue("");
    setAdding(null);
  };

  return (
    <section
      onDragOver={(e) => {
        if (!hasDrag(e.dataTransfer)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        p.onDrop(b, e);
      }}
      className={`flex flex-col gap-2 rounded-lg border bg-subtle/40 p-3 ${over ? "border-accent bg-accent-soft/40" : "border-line"}`}
      aria-label={b.name}
    >
      <header className="flex items-center gap-1">
        {renaming ? (
          <input
            autoFocus
            className={`${INPUT} py-0.5`}
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              setRenaming(false);
              if (name.trim() && name !== b.name) p.run(() => updateBucket(b.id, { name }));
              else setName(b.name);
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <button type="button" className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-fg" title="Click to rename" onClick={() => setRenaming(true)}>
            {b.name} <span className="text-xs font-normal text-faint">({cards.length})</span>
          </button>
        )}
        <button type="button" className={BTN_SM} aria-label="Move bucket up" disabled={p.pending || i === 0} onClick={() => p.onReorder(i, i - 1)}>
          ↑
        </button>
        <button type="button" className={BTN_SM} aria-label="Move bucket down" disabled={p.pending || i === p.buckets.length - 1} onClick={() => p.onReorder(i, i + 1)}>
          ↓
        </button>
        <button
          type="button"
          className={BTN_SM}
          aria-label="Delete bucket"
          disabled={p.pending}
          onClick={() => confirm(`Delete “${b.name}” and its ${cards.length} card(s)? Notes are not touched.`) && p.run(() => deleteBucket(b.id), "Deleted.")}
        >
          ✕
        </button>
      </header>
      {p.shelf && (
        <input
          className="w-full rounded border border-transparent bg-transparent px-1 text-xs text-muted placeholder:text-faint focus:border-line-strong"
          defaultValue={b.description ?? ""}
          placeholder="What goes on this shelf?"
          maxLength={300}
          onBlur={(e) => e.target.value !== (b.description ?? "") && p.run(() => updateBucket(b.id, { description: e.target.value }))}
        />
      )}
      <ul className="space-y-2">
        {cards.map((c) => (
          <CardItem
            key={c.id}
            card={c}
            note={c.note_id ? p.notesById.get(c.note_id) ?? null : null}
            reference={c.reference_id ? p.refsById.get(c.reference_id) ?? null : null}
            usedIn={c.note_id ? p.usedIn[c.note_id] ?? [] : []}
            buckets={p.buckets}
            typeOptions={p.typeOptions}
            draggable={p.canDrag}
            onDropBefore={p.canDrag ? (e) => p.onDrop(b, e, c) : undefined}
          />
        ))}
        {!cards.length && <li className="rounded border border-dashed border-line p-3 text-center text-xs text-faint">{p.canDrag ? "Drag notes here, or add below." : "Add notes from the drawer, or below."}</li>}
      </ul>
      {adding ? (
        <div className="space-y-1.5">
          {adding === "quick" ? (
            <textarea autoFocus rows={3} className={INPUT} placeholder="A thought, a line, an example…" value={value} onChange={(e) => setValue(e.target.value)} maxLength={4000} />
          ) : (
            <input
              autoFocus
              className={INPUT}
              placeholder={adding === "link" ? "https://… (article, video, post)" : "Title of the new note (optional)"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void submit()}
            />
          )}
          <div className="flex gap-1">
            <button type="button" className={BTN_SM} disabled={busy} onClick={() => void submit()}>
              {busy ? "Adding…" : adding === "note" ? "Create note" : "Add"}
            </button>
            <button type="button" className={BTN_SM} onClick={() => {
                setAdding(null);
                setValue("");
              }}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1">
          <button type="button" className={BTN_SM} onClick={() => setAdding("quick")}>
            + Quick card
          </button>
          <button type="button" className={BTN_SM} onClick={() => setAdding("link")}>
            + Link
          </button>
          <button type="button" className={BTN_SM} onClick={() => setAdding("note")} title="Creates a real note in Notes (Type: Research)">
            + New note
          </button>
        </div>
      )}
    </section>
  );
}
