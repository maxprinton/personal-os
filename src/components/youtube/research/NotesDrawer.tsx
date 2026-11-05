"use client";
// Left drawer of the Research Laboratory (Worker A): "Suggested for this video" (keyword match, ✨ refine),
// ALL notes with search + Type / Area / Tag filters, a fragment picker (one paragraph → quote card linked
// to that exact block) and — on a video — the topic shelves to copy cards from.
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { addFragmentCard, addNoteCard, aiRefineSuggestions, noteBlocks, type RefinedSuggestion } from "@/app/youtube-actions/research";
import { filterDrawerNotes, noteHref, suggestNotes, type NoteBlock } from "@/lib/youtube/research";
import { AI_BTN, AiPreview, BTN_SM, Chip, INPUT, Msg } from "@/components/youtube/idea/ui";
import CardItem from "./CardItem";
import { DND, type LabBucket, type LabCard, type LabNote, type LabOption, type LabReference, type LabVideo } from "./shared";

type Tab = "suggested" | "all" | "shelves";

export default function NotesDrawer({
  videoId,
  notes,
  terms,
  onBoard,
  buckets,
  typeOptions,
  areaOptions,
  usedIn,
  shelves,
  shelfCards,
  refsById,
  aiReady,
  canDrag,
}: {
  videoId: string | null;
  notes: LabNote[];
  /** Words of the video (idea name, topic, tags) for "Suggested". Empty on the shelves page. */
  terms: string[];
  /** Note ids already on this board. */
  onBoard: Set<string>;
  buckets: LabBucket[];
  typeOptions: LabOption[];
  areaOptions: LabOption[];
  usedIn: Record<string, LabVideo[]>;
  shelves: LabBucket[];
  shelfCards: LabCard[];
  refsById: Map<string, LabReference>;
  aiReady: boolean;
  canDrag: boolean;
}) {
  const [tab, setTab] = useState<Tab>(terms.length ? "suggested" : "all");
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [area, setArea] = useState("");
  const [tag, setTag] = useState("");
  const [limit, setLimit] = useState(60);
  const [refined, setRefined] = useState<RefinedSuggestion[] | null>(null);
  const [aiMsg, setAiMsg] = useState<{ error?: string; info?: string }>({});
  const [aiPending, startAi] = useTransition();
  const byId = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);
  const tags = useMemo(() => [...new Set(notes.flatMap((n) => n.tags))].sort((a, b) => a.localeCompare(b)), [notes]);
  const suggested = useMemo(() => suggestNotes(notes, terms, { limit: 15, exclude: onBoard }), [notes, terms, onBoard]);
  const filtered = useMemo(() => filterDrawerNotes(notes, { q, type, area, tag }), [notes, q, type, area, tag]);

  const refine = () =>
    startAi(async () => {
      if (!videoId) return;
      const r = await aiRefineSuggestions(videoId);
      if (r.error) setAiMsg({ error: r.error, info: r.usage ?? undefined });
      else {
        setRefined(r.items ?? []);
        setAiMsg({ info: r.usage ?? undefined });
      }
    });

  return (
    <aside className="space-y-3 rounded-lg border border-line bg-surface p-3 shadow-card">
      <div className="flex flex-wrap gap-1">
        {terms.length > 0 && (
          <Chip on={tab === "suggested"} onClick={() => setTab("suggested")}>
            Suggested
          </Chip>
        )}
        <Chip on={tab === "all"} onClick={() => setTab("all")}>
          All notes ({notes.length})
        </Chip>
        {videoId && (
          <Chip on={tab === "shelves"} onClick={() => setTab("shelves")}>
            Topic shelves ({shelves.length})
          </Chip>
        )}
      </div>

      {tab === "suggested" && (
        <div className="space-y-2">
          <p className="text-xs text-muted">
            Notes that share words with this video: <span className="text-faint">{terms.slice(0, 8).join(", ")}</span>
          </p>
          {aiReady && videoId && (
            <button type="button" className={AI_BTN} disabled={aiPending} onClick={refine}>
              {aiPending ? "✨ Reading your notes…" : "✨ Refine with AI"}
            </button>
          )}
          <Msg {...aiMsg} />
          {refined && (
            <AiPreview title="AI picks for this video" onDiscard={() => setRefined(null)}>
              <ul className="space-y-1.5">
                {refined.map((s) => {
                  const n = byId.get(s.id);
                  return n ? <NoteRow key={s.id} note={n} why={s.why} {...{ buckets, typeOptions, usedIn, canDrag, onBoard }} /> : null;
                })}
              </ul>
            </AiPreview>
          )}
          {suggested.length ? (
            <ul className="space-y-1.5">
              {suggested.map((n) => (
                <NoteRow key={n.id} note={n} why={`matches: ${n.hits.join(", ")}`} {...{ buckets, typeOptions, usedIn, canDrag, onBoard }} />
              ))}
            </ul>
          ) : (
            <p className="text-xs text-faint">No note shares words with this video yet. Try “All notes” or ✨.</p>
          )}
        </div>
      )}

      {tab === "all" && (
        <div className="space-y-2">
          <input className={INPUT} placeholder="Search notes…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search notes" />
          <div className="grid grid-cols-3 gap-1">
            <select className="rounded border border-line bg-surface px-1 py-1 text-xs" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
              <option value="">Type: all</option>
              {typeOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <select className="rounded border border-line bg-surface px-1 py-1 text-xs" value={area} onChange={(e) => setArea(e.target.value)} aria-label="Area">
              <option value="">Area: all</option>
              {areaOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <select className="rounded border border-line bg-surface px-1 py-1 text-xs" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag">
              <option value="">Tag: all</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  #{t}
                </option>
              ))}
            </select>
          </div>
          <p className="text-[11px] text-faint">{filtered.length} note(s)</p>
          <ul className="max-h-[70vh] space-y-1.5 overflow-y-auto pr-1">
            {filtered.slice(0, limit).map((n) => (
              <NoteRow key={n.id} note={n} {...{ buckets, typeOptions, usedIn, canDrag, onBoard }} />
            ))}
          </ul>
          {filtered.length > limit && (
            <button type="button" className={BTN_SM} onClick={() => setLimit((l) => l + 60)}>
              Show more
            </button>
          )}
        </div>
      )}

      {tab === "shelves" && (
        <div className="space-y-3">
          <p className="text-xs text-muted">
            Shelves live outside any video. Copy a card into this video{canDrag ? " (or drag it onto a bucket)" : ""}. Manage shelves in{" "}
            <Link href="/youtube/lab" className="text-accent hover:underline">
              Lab
            </Link>
            .
          </p>
          {!shelves.length && <p className="text-xs text-faint">No topic shelves yet.</p>}
          {shelves.map((s) => {
            const cards = shelfCards.filter((c) => c.bucket_id === s.id).sort((a, b) => a.position - b.position);
            return (
              <details key={s.id} className="rounded border border-line p-2" open={shelves.length <= 2}>
                <summary className="cursor-pointer text-sm font-medium">
                  {s.name} <span className="text-xs font-normal text-faint">({cards.length})</span>
                </summary>
                {s.description && <p className="mt-1 text-xs text-muted">{s.description}</p>}
                <ul className="mt-2 space-y-2">
                  {cards.map((c) => (
                    <CardItem
                      key={c.id}
                      card={c}
                      note={c.note_id ? byId.get(c.note_id) ?? null : null}
                      reference={c.reference_id ? refsById.get(c.reference_id) ?? null : null}
                      usedIn={c.note_id ? usedIn[c.note_id] ?? [] : []}
                      buckets={[]}
                      copyTargets={{ label: "Copy to…", buckets }}
                      typeOptions={typeOptions}
                      draggable={canDrag}
                    />
                  ))}
                  {!cards.length && <li className="text-xs text-faint">Empty shelf.</li>}
                </ul>
              </details>
            );
          })}
        </div>
      )}
    </aside>
  );
}

function NoteRow({
  note,
  why,
  buckets,
  typeOptions,
  usedIn,
  canDrag,
  onBoard,
}: {
  note: LabNote;
  why?: string;
  buckets: LabBucket[];
  typeOptions: LabOption[];
  usedIn: Record<string, LabVideo[]>;
  canDrag: boolean;
  onBoard: Set<string>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ error?: string; info?: string }>({});
  const [frag, setFrag] = useState<{ blocks: NoteBlock[] } | null>(null);
  const [fragBucket, setFragBucket] = useState("");
  const type = note.typeId ? typeOptions.find((o) => o.id === note.typeId) : null;
  const used = usedIn[note.id] ?? [];
  const run = (fn: () => Promise<{ error?: string }>, info: string) =>
    start(async () => {
      const r = await fn();
      setMsg(r.error ? { error: r.error } : { info });
      if (!r.error) router.refresh();
    });
  const openFragments = () =>
    start(async () => {
      if (frag) return setFrag(null);
      const r = await noteBlocks(note.id);
      if (r.error) setMsg({ error: r.error });
      else setFrag({ blocks: r.blocks ?? [] });
    });

  return (
    <li
      draggable={canDrag}
      onDragStart={(e) => {
        e.dataTransfer.setData(DND, JSON.stringify({ t: "note", id: note.id }));
        e.dataTransfer.effectAllowed = "copy";
      }}
      className={`space-y-1 rounded-md border border-line p-2 text-sm ${canDrag ? "cursor-grab" : ""} ${pending ? "opacity-60" : ""}`}
    >
      <div className="flex items-start gap-1">
        <Link href={noteHref(note.id)} className="min-w-0 flex-1 truncate font-medium text-fg hover:underline" title={note.title}>
          {note.icon ? `${note.icon} ` : ""}
          {note.title || "Untitled"}
        </Link>
        {onBoard.has(note.id) && <span className="shrink-0 text-[11px] text-success">✓ on board</span>}
      </div>
      {(note.summary || note.text) && <p className="line-clamp-2 text-xs text-muted">{note.summary || note.text}</p>}
      <div className="flex flex-wrap items-center gap-1 text-[11px]">
        {type && <span className="rounded bg-subtle px-1.5 text-muted">{type.name}</span>}
        {note.tags.slice(0, 3).map((t) => (
          <span key={t} className="rounded bg-accent-soft px-1.5 text-accent">
            #{t}
          </span>
        ))}
        {used.length > 0 && <span className="text-faint">· used in {used.length} video(s)</span>}
        {why && <span className="text-faint">· {why}</span>}
      </div>
      {buckets.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <select
            aria-label="Add to bucket"
            className="rounded border border-line bg-surface px-1 py-0.5 text-xs text-muted"
            value=""
            disabled={pending}
            onChange={(e) => e.target.value && run(() => addNoteCard(e.target.value, note.id), "Added.")}
          >
            <option value="">Add to…</option>
            {buckets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <button type="button" className={BTN_SM} disabled={pending} onClick={openFragments} title="Pick one paragraph of this note as a quote card">
            {frag ? "Close fragments" : "❝ Fragment…"}
          </button>
        </div>
      )}
      {frag && (
        <div className="space-y-1.5 rounded border border-line bg-subtle/50 p-2">
          <select className="w-full rounded border border-line bg-surface px-1 py-0.5 text-xs" value={fragBucket} onChange={(e) => setFragBucket(e.target.value)} aria-label="Bucket for the fragment">
            <option value="">Pick the bucket first…</option>
            {buckets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          {!frag.blocks.length && <p className="text-xs text-faint">This note has no paragraphs.</p>}
          <ul className="max-h-60 space-y-1 overflow-y-auto">
            {frag.blocks.map((bl) => (
              <li key={bl.line} className="flex items-start gap-1.5">
                <button
                  type="button"
                  className={BTN_SM}
                  disabled={pending || !fragBucket}
                  onClick={() => run(() => addFragmentCard(fragBucket, note.id, bl.line), "Fragment added.")}
                >
                  +
                </button>
                <span className={`text-xs ${bl.heading ? "font-semibold text-fg" : "text-muted"} line-clamp-3`}>{bl.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Msg {...msg} />
    </li>
  );
}
