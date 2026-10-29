"use client";
// Board view of the notes database (Kanban): one column per option of a Select / Status property
// ("No <property>" first; Status in its group order To-do → In progress → Done). Drag a card to another
// column (mouse), or use "Move ▾" on the card (phones). The change shows at once and is saved after.
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { setNoteValue } from "@/app/notes-db-actions";
import { MenuItem, MenuLabel, Popover } from "@/components/editor/ui";
import NewNoteButton from "@/components/notes-db/NewNoteButton";
import { OptionPill, errorText, toast } from "@/components/notes-db/prop-ui";
import { NoteTitle } from "@/components/notes-db/db-title";
import { CardProps, displayTitle, fit, parentTitle, rectOf, useChunk, useDb, useOpenNote, type Rect } from "@/components/notes-db/db-shared";
import { STATUS_GROUP_LABEL, groupNotes, type BoardGroup } from "@/lib/notes-db/query";
import type { DbNote, NoteProperty } from "@/lib/notes-db/types";

const DRAG_TYPE = "text/x-pos-note";
const keyOf = (id: string | null) => id ?? "__none";

type Move = (note: DbNote, to: string | null) => void;
type Col = Pick<BoardGroup, "id" | "name" | "color" | "group">;

/** The column a note is in (an unknown option counts as "No …", like groupNotes). */
function columnOf(note: DbNote, prop: NoteProperty): string | null {
  const v = note.values[prop.id];
  return typeof v === "string" && (prop.config.options ?? []).some((o) => o.id === v) ? v : null;
}

function ColumnLabel({ col, status }: { col: Col; status: boolean }) {
  if (!col.id) return <span className="db-col-none">{col.name}</span>;
  return <OptionPill option={{ name: col.name, color: col.color, group: col.group }} status={status} small />;
}

type CardP = {
  note: DbNote;
  cols: NoteProperty[];
  properties: NoteProperty[];
  parent: string | null;
  groupProp: NoteProperty;
  columns: Col[];
  dragging: boolean;
  onMove: Move;
  onDrag: (id: string | null) => void;
  open: (e: React.MouseEvent, id: string) => void;
};

const BoardCard = memo(function BoardCard({ note, cols, properties, parent, groupProp, columns, dragging, onMove, onDrag, open }: CardP) {
  const [menu, setMenu] = useState<Rect | null>(null);
  const current = columnOf(note, groupProp);
  const status = groupProp.type === "status";
  return (
    <div
      className={`db-bcard ${dragging ? "is-dragging" : ""}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData(DRAG_TYPE, note.id);
        e.dataTransfer.setData("text/plain", displayTitle(note));
        onDrag(note.id);
      }}
      onDragEnd={() => onDrag(null)}
      onClick={(e) => open(e, note.id)}
    >
      <div className="db-bcard-top">
        <NoteTitle note={note} parent={parent} />
        <button
          type="button"
          className="db-bcard-move"
          title={`Move to another ${groupProp.name || "column"}`}
          aria-label={`Move “${displayTitle(note)}” to…`}
          aria-haspopup="menu"
          aria-expanded={!!menu}
          onClick={(e) => {
            const r = rectOf(e.currentTarget);
            setMenu((m) => (m ? null : r));
          }}
        >
          <span className="db-bcard-move-label">Move</span>
          <span aria-hidden className="db-caret">
            ▾
          </span>
        </button>
      </div>
      <CardProps note={note} cols={cols} properties={properties} />
      {menu && (
        <Popover rect={menu} onClose={() => setMenu(null)} width={fit(240)} className="n-menu">
          <div className="max-h-[min(60vh,360px)] overflow-y-auto p-1">
            <MenuLabel>Move to</MenuLabel>
            {columns.map((c) => (
              <MenuItem
                key={keyOf(c.id)}
                icon={<span className={`db-check is-radio ${c.id === current ? "is-on" : ""}`} aria-hidden>{c.id === current ? "✓" : ""}</span>}
                label={<ColumnLabel col={c} status={status} />}
                onClick={() => {
                  setMenu(null);
                  onMove(note, c.id);
                }}
              />
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
});

type ColumnP = {
  group: BoardGroup;
  groupProp: NoteProperty;
  columns: Col[];
  cols: NoteProperty[];
  titles: Map<string, string>;
  dragId: string | null;
  over: boolean;
  firstOfGroup: boolean;
  onOver: (key: string | null) => void;
  onDropNote: (id: string, to: string | null) => void;
  onMove: Move;
  onDrag: (id: string | null) => void;
};

function Column({ group, groupProp, columns, cols, titles, dragId, over, firstOfGroup, onOver, onDropNote, onMove, onDrag }: ColumnP) {
  const env = useDb();
  const open = useOpenNote();
  const { limit, sentinel } = useChunk(group.notes.length, 50);
  const key = keyOf(group.id);
  const status = groupProp.type === "status";
  const values = useMemo(() => {
    const v: Record<string, unknown> = { ...env.newValues };
    if (group.id) v[groupProp.id] = group.id;
    else delete v[groupProp.id];
    return v;
  }, [env.newValues, group.id, groupProp.id]);
  const cards = group.notes.length > limit ? group.notes.slice(0, limit) : group.notes;
  return (
    <section
      className={`db-col ${over ? "is-over" : ""}`}
      aria-label={`${group.name}: ${group.notes.length} ${group.notes.length === 1 ? "note" : "notes"}`}
      onDragOver={(e) => {
        if (!dragId && !e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!over) onOver(key);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onOver(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData(DRAG_TYPE) || dragId;
        onOver(null);
        onDrag(null);
        if (id) onDropNote(id, group.id);
      }}
    >
      <header className="db-col-head">
        {status && (
          <span className={`db-col-group ${group.id && firstOfGroup ? "" : "is-repeat"}`} aria-hidden>
            {group.id ? STATUS_GROUP_LABEL[group.group ?? "todo"] : "\u00a0"}
          </span>
        )}
        <div className="db-col-title">
          <ColumnLabel col={group} status={status} />
          <span className="db-col-count">{group.notes.length}</span>
        </div>
      </header>
      <div className="db-col-body">
        {cards.map((n) => (
          <BoardCard
            key={n.id}
            note={n}
            cols={cols}
            properties={env.properties}
            parent={parentTitle(n, titles)}
            groupProp={groupProp}
            columns={columns}
            dragging={dragId === n.id}
            onMove={onMove}
            onDrag={onDrag}
            open={open}
          />
        ))}
        {sentinel}
        {!group.notes.length && <div className="db-col-empty">{dragId ? "Drop here" : "No notes"}</div>}
        <div className="db-col-new">
          <NewNoteButton templates={env.templates} values={values} compact />
        </div>
      </div>
    </section>
  );
}

export function BoardView({ notes, cols, groupProp, titles, hideEmpty }: { notes: DbNote[]; cols: NoteProperty[]; groupProp: NoteProperty | null; titles: Map<string, string>; hideEmpty: boolean }) {
  const env = useDb();
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const byId = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);
  const groups = useMemo(() => (groupProp ? groupNotes(notes, groupProp) : []), [notes, groupProp]);
  const columns = useMemo<Col[]>(() => groups.map((g) => ({ id: g.id, name: g.name, color: g.color, group: g.group })), [groups]);
  // The card's props without the property of the columns (already the column)
  const cardCols = useMemo(() => (groupProp ? cols.filter((c) => c.id !== groupProp.id) : cols), [cols, groupProp]);
  const envRef = useRef(env);
  envRef.current = env;

  const move = useCallback<Move>(
    (note, to) => {
      if (!groupProp) return;
      if (columnOf(note, groupProp) === to) return;
      const { onNote, refresh } = envRef.current;
      onNote({ ...note, values: { ...note.values, [groupProp.id]: to } });
      void (async () => {
        try {
          const r = await setNoteValue(note.id, groupProp.id, to);
          if (!r.ok) throw r;
          if (r.templateApplied) refresh();
        } catch (e) {
          envRef.current.onNote(note);
          toast(errorText(e, "Couldn't move the note."));
        }
      })();
    },
    [groupProp],
  );
  const dropNote = useCallback(
    (id: string, to: string | null) => {
      const n = byId.get(id);
      if (n) move(n, to);
    },
    [byId, move],
  );

  if (!groupProp)
    return (
      <div className="db-empty">
        <span className="db-empty-icon" aria-hidden>
          ▥
        </span>
        <p>The board needs a Select or Status property to make its columns.</p>
        <p className="text-sm text-faint">Add one with “+” in the Table view, then come back.</p>
      </div>
    );

  // While dragging, empty columns show too (so you can drop there)
  const shown = hideEmpty && !dragId ? groups.filter((g) => g.notes.length > 0) : groups;
  const hidden = groups.length - shown.length;
  return (
    <div className="db-board-wrap">
      <div className="db-board" aria-label={`Board by ${groupProp.name}`}>
        {shown.map((g, i) => (
          <Column
            key={keyOf(g.id)}
            group={g}
            groupProp={groupProp}
            columns={columns}
            cols={cardCols}
            titles={titles}
            dragId={dragId}
            over={over === keyOf(g.id)}
            firstOfGroup={i === 0 || !shown[i - 1].id || (shown[i - 1].group ?? "todo") !== (g.group ?? "todo")}
            onOver={setOver}
            onDropNote={dropNote}
            onMove={move}
            onDrag={setDragId}
          />
        ))}
        {!shown.length && <p className="db-hint">Every column is empty.</p>}
      </div>
      {hidden > 0 && (
        <p className="db-board-note">
          {hidden} empty {hidden === 1 ? "column is" : "columns are"} hidden.
        </p>
      )}
    </div>
  );
}
