import type { createClient } from "@/lib/supabase/server";
import type { EntityType } from "@/lib/tags";
import { utcToLocal } from "@/lib/time";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type RelationType = "mentions" | "sub_item" | "blocks" | "fulfills";

/** Which relationship a link gets, based on what is linked to what. */
export function relationFor(source: EntityType, target: EntityType): RelationType {
  if (source === "note") return "mentions";
  if (source === "task" && target === "task") return "blocks";
  return "sub_item";
}

export type ContextTask = { id: string; title: string; status: string };
export type ContextNote = { id: string; title: string };

/** Tasks and notes linked to the given blocks / events (for the Command Center). */
export async function getContextFor(
  supabase: Supabase,
  targets: { type: "time_block" | "event"; id: string }[]
) {
  const empty = { tasks: [] as ContextTask[], notes: [] as ContextNote[] };
  if (!targets.length) return empty;
  const { data } = await supabase
    .from("entity_relations")
    .select("source_type,source_id,target_type,target_id")
    .in("target_id", targets.map((t) => t.id))
    .in("source_type", ["task", "note"])
    .is("deleted_at", null);
  const rels = ((data ?? []) as { source_type: string; source_id: string; target_type: string; target_id: string }[])
    .filter((r) => targets.some((t) => t.type === r.target_type && t.id === r.target_id));
  const taskIds = rels.filter((r) => r.source_type === "task").map((r) => r.source_id);
  const noteIds = rels.filter((r) => r.source_type === "note").map((r) => r.source_id);

  const [tasksRes, notesRes] = await Promise.all([
    taskIds.length
      ? supabase.from("tasks").select("id,title,status").in("id", taskIds).is("deleted_at", null)
      : Promise.resolve({ data: [] }),
    noteIds.length
      ? supabase.from("notes").select("id,title").in("id", noteIds).is("deleted_at", null)
      : Promise.resolve({ data: [] }),
  ]);
  return {
    tasks: (tasksRes.data ?? []) as ContextTask[],
    notes: (notesRes.data ?? []) as ContextNote[],
  };
}

export type OutgoingLink = {
  relationId: string;
  relationship: string;
  targetType: string;
  targetId: string;
  title: string;
};

const TABLE: Record<string, string> = {
  time_block: "time_blocks",
  event: "events",
  task: "tasks",
  note: "notes",
};

/** Links that start at one entity, with the target's title resolved. */
export async function getLinksFrom(supabase: Supabase, sourceType: EntityType, sourceId: string) {
  const { data } = await supabase
    .from("entity_relations")
    .select("id,relationship_type,target_type,target_id")
    .eq("source_type", sourceType)
    .eq("source_id", sourceId)
    .is("deleted_at", null);
  const rels = (data ?? []) as { id: string; relationship_type: string; target_type: string; target_id: string }[];
  const out: OutgoingLink[] = [];
  for (const type of Object.keys(TABLE)) {
    const ids = rels.filter((r) => r.target_type === type).map((r) => r.target_id);
    if (!ids.length) continue;
    const { data: rows } = await supabase.from(TABLE[type]).select("id,title").in("id", ids);
    const titles = new Map(((rows ?? []) as { id: string; title: string }[]).map((r) => [r.id, r.title]));
    for (const r of rels.filter((r) => r.target_type === type)) {
      out.push({
        relationId: r.id,
        relationship: r.relationship_type,
        targetType: type,
        targetId: r.target_id,
        title: titles.get(r.target_id) || "(untitled)",
      });
    }
  }
  return out;
}

/** Options for a "link to..." dropdown: time blocks + upcoming events. Value = "type:id". */
export async function getLinkOptions(supabase: Supabase, fromIso: string, tz: string) {
  const [blocks, events] = await Promise.all([
    supabase.from("time_blocks").select("id,title").is("deleted_at", null).order("start_time"),
    supabase
      .from("events")
      .select("id,title,start_time")
      .is("deleted_at", null)
      .gte("end_time", fromIso)
      .order("start_time")
      .limit(50),
  ]);
  return [
    ...((blocks.data ?? []) as { id: string; title: string }[]).map((b) => ({
      value: `time_block:${b.id}`,
      label: `Block · ${b.title}`,
    })),
    ...((events.data ?? []) as { id: string; title: string; start_time: string }[]).map((e) => ({
      value: `event:${e.id}`,
      label: `Event · ${e.title} (${utcToLocal(e.start_time, tz).date})`,
    })),
  ];
}
