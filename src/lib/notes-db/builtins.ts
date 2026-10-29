// The properties every notes database starts with (agreed with the user, Oct 2026). Created the first
// time the database loads; you can rename, hide, reorder them and edit their options, but not delete them.
import type { NoteProperty, PropConfig, PropType } from "@/lib/notes-db/types";

export type BuiltinDef = { key: string; name: string; type: PropType; config?: PropConfig; hidden?: boolean };

export const BUILTINS: BuiltinDef[] = [
  {
    key: "type",
    name: "Type",
    type: "select",
    config: {
      options: [
        { id: "idea", name: "Idea", color: "yellow" },
        { id: "diario", name: "Diario", color: "blue" },
        { id: "aprendizaje", name: "Aprendizaje", color: "green" },
        { id: "referencia", name: "Referencia", color: "gray" },
        { id: "plan", name: "Plan", color: "purple" },
        { id: "reunion", name: "Reunión", color: "orange" },
      ],
    },
  },
  {
    key: "status",
    name: "Status",
    type: "status",
    config: {
      options: [
        { id: "inbox", name: "Inbox", color: "gray", group: "todo" },
        { id: "desarrollando", name: "Desarrollando", color: "blue", group: "in_progress" },
        { id: "lista", name: "Lista", color: "green", group: "done" },
        { id: "archivada", name: "Archivada", color: "brown", group: "done" },
      ],
      defaultOptionId: "inbox",
    },
  },
  {
    key: "area",
    name: "Area",
    type: "select",
    config: {
      options: [
        { id: "trabajo", name: "Trabajo", color: "blue" },
        { id: "salud", name: "Salud", color: "green" },
        { id: "finanzas", name: "Finanzas", color: "yellow" },
        { id: "aprendizaje", name: "Aprendizaje", color: "purple" },
        { id: "personal", name: "Personal", color: "pink" },
        { id: "relaciones", name: "Relaciones", color: "orange" },
      ],
    },
  },
  { key: "tags", name: "Tags", type: "tags" },
  { key: "favorite", name: "Favorite", type: "checkbox" },
  { key: "review_on", name: "Review on", type: "date" },
  { key: "source", name: "Source", type: "url" },
  { key: "id", name: "ID", type: "unique_id", config: { prefix: "NOTE" } },
  { key: "tasks", name: "Tasks", type: "relation", config: { target: "tasks" } },
  { key: "pending_tasks", name: "Pending tasks", type: "rollup", config: { relationPropId: "@tasks", calc: "count_pending" } },
  { key: "events", name: "Events & blocks", type: "relation", config: { target: "events" } },
  { key: "related", name: "Related notes", type: "relation", config: { target: "notes", twoWay: true } },
  { key: "backlinks", name: "Backlinks", type: "backlinks" },
  { key: "open_todos", name: "Open to-dos", type: "open_todos" },
  { key: "word_count", name: "Words", type: "word_count", hidden: true },
  { key: "ai_summary", name: "AI summary", type: "ai_summary" },
  { key: "kind", name: "Kind", type: "kind", hidden: true },
  { key: "created", name: "Created", type: "created_time", hidden: true },
  { key: "edited", name: "Last edited", type: "last_edited_time", hidden: true },
];

/** Built-in relations live in entity_relations (the "Linked to" links, so Today keeps showing them). */
export const BUILTIN_RELATION_KEYS = ["tasks", "events", "related"] as const;
export const isBuiltinRelation = (p: Pick<NoteProperty, "key" | "builtin" | "type">) =>
  p.builtin && p.type === "relation" && (BUILTIN_RELATION_KEYS as readonly string[]).includes(p.key);

/** "@tasks" in a rollup config = the built-in property with that key (ids differ per user). */
export function resolvePropRef(ref: string | undefined, props: NoteProperty[]) {
  if (!ref) return null;
  if (ref.startsWith("@")) return props.find((p) => p.key === ref.slice(1)) ?? null;
  return props.find((p) => p.id === ref) ?? null;
}

export const propByKey = (props: NoteProperty[], key: string) => props.find((p) => p.key === key) ?? null;
