import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;
export type EntityType = "time_block" | "event" | "task" | "note";
export type Tag = { name: string; color: string | null };

/** "work, #ideas,  urgent" -> ["work", "ideas", "urgent"] */
export function parseTags(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(",")) {
    const name = raw.trim().replace(/^#/, "").slice(0, 40);
    if (name && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      out.push(name);
    }
  }
  return out;
}

/** Replace the tags of one entity with the given names (creates missing tags). */
export async function setTags(supabase: Supabase, entityType: EntityType, entityId: string, names: string[]) {
  await supabase
    .from("entity_tags")
    .update({ deleted_at: new Date().toISOString() })
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .is("deleted_at", null);
  if (!names.length) return;

  const { data: existing } = await supabase.from("tags").select("id,name").is("deleted_at", null);
  const byName = new Map(
    ((existing ?? []) as { id: string; name: string }[]).map((t) => [t.name.toLowerCase(), t.id])
  );
  const ids: string[] = [];
  for (const name of names) {
    let id = byName.get(name.toLowerCase());
    if (!id) {
      const { data, error } = await supabase.from("tags").insert({ name }).select("id").single();
      if (error || !data) continue;
      id = data.id as string;
      byName.set(name.toLowerCase(), id);
    }
    ids.push(id);
  }
  if (ids.length) {
    await supabase
      .from("entity_tags")
      .insert(ids.map((tag_id) => ({ tag_id, entity_type: entityType, entity_id: entityId })));
  }
}

type TagJoin = { name: string; color: string | null; deleted_at: string | null };

/** Map entity id -> its tags. */
export async function getTagsFor(supabase: Supabase, entityType: EntityType, ids: string[]) {
  const map = new Map<string, Tag[]>();
  if (!ids.length) return map;
  const { data } = await supabase
    .from("entity_tags")
    .select("entity_id, tags(name,color,deleted_at)")
    .eq("entity_type", entityType)
    .in("entity_id", ids)
    .is("deleted_at", null);
  for (const row of (data ?? []) as unknown as { entity_id: string; tags: TagJoin | TagJoin[] | null }[]) {
    const t = Array.isArray(row.tags) ? row.tags[0] : row.tags;
    if (!t || t.deleted_at) continue;
    const list = map.get(row.entity_id) ?? [];
    list.push({ name: t.name, color: t.color });
    map.set(row.entity_id, list);
  }
  return map;
}

/** Ids of entities of a type that carry the tag (case-insensitive). */
export async function idsWithTag(supabase: Supabase, entityType: EntityType, tagName: string) {
  const { data: tags } = await supabase
    .from("tags")
    .select("id")
    .ilike("name", tagName.replace(/[%_]/g, ""))
    .is("deleted_at", null);
  const tagIds = ((tags ?? []) as { id: string }[]).map((t) => t.id);
  if (!tagIds.length) return [];
  const { data } = await supabase
    .from("entity_tags")
    .select("entity_id")
    .eq("entity_type", entityType)
    .in("tag_id", tagIds)
    .is("deleted_at", null);
  return ((data ?? []) as { entity_id: string }[]).map((r) => r.entity_id);
}

export async function allTagNames(supabase: Supabase) {
  const { data } = await supabase.from("tags").select("name").is("deleted_at", null).order("name");
  return ((data ?? []) as { name: string }[]).map((t) => t.name);
}

const ENTITY_TABLE: Record<EntityType, string> = {
  task: "tasks",
  note: "notes",
  event: "events",
  time_block: "time_blocks",
};

/** Tag links split into live ones and orphans (pointing at deleted items). */
export async function liveTagLinks(supabase: Supabase) {
  const { data } = await supabase.from("entity_tags").select("id,tag_id,entity_type,entity_id").is("deleted_at", null);
  const links = (data ?? []) as { id: string; tag_id: string; entity_type: EntityType; entity_id: string }[];
  const alive = new Set<string>();
  for (const type of Object.keys(ENTITY_TABLE) as EntityType[]) {
    const ids = [...new Set(links.filter((l) => l.entity_type === type).map((l) => l.entity_id))];
    if (!ids.length) continue;
    const { data: rows } = await supabase.from(ENTITY_TABLE[type]).select("id").in("id", ids).is("deleted_at", null);
    for (const r of (rows ?? []) as { id: string }[]) alive.add(`${type}:${r.id}`);
  }
  return {
    live: links.filter((l) => alive.has(`${l.entity_type}:${l.entity_id}`)),
    orphans: links.filter((l) => !alive.has(`${l.entity_type}:${l.entity_id}`)),
  };
}
