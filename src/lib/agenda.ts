import type { createClient } from "@/lib/supabase/server";
import { addDays, utcToLocal, zonedToUtc } from "@/lib/time";
import { currentUserId, getBlockTypes, getOccurrences } from "@/lib/calendar/model";
import { spanOn } from "@/lib/calendar/overlap";
import type { OccurrenceStatus } from "@/lib/calendar/types";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type BlockRow = {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  rrule: string;
  valid_from: string;
  valid_until: string | null;
  is_habit: boolean;
  color: string | null;
};

export type EventRow = {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  is_habit: boolean;
};

export type AgendaItem = {
  kind: "block" | "event";
  id: string; // block: occurrence id
  title: string;
  start: number; // minutes since local midnight
  end: number;
  color: string | null;
  isHabit: boolean;
  blockTypeId?: string; // block only
  status?: OccurrenceStatus; // block only
  fulfilledBy?: string; // legacy (calendar v1)
  fulfills?: string; // legacy (calendar v1)
};

export async function getSettings(supabase: Supabase) {
  const { data } = await supabase.from("user_settings").select("timezone").maybeSingle();
  return { timezone: (data?.timezone as string | undefined) ?? "America/Guayaquil" };
}

/** Legacy calendar v1 blocks (read-only since calendar v2). */
export async function getActiveBlocks(supabase: Supabase): Promise<BlockRow[]> {
  const { data } = await supabase
    .from("time_blocks")
    .select("id,title,start_time,end_time,rrule,valid_from,valid_until,is_habit,color")
    .is("deleted_at", null)
    .order("start_time");
  return (data ?? []) as BlockRow[];
}

/** Map event id -> block id for "fulfills" relations of the given events. */
export async function getFulfillments(supabase: Supabase, eventIds: string[]) {
  const map = new Map<string, string>();
  if (!eventIds.length) return map;
  const { data } = await supabase
    .from("entity_relations")
    .select("source_id,target_id")
    .eq("relationship_type", "fulfills")
    .eq("source_type", "event")
    .in("source_id", eventIds)
    .is("deleted_at", null);
  for (const r of (data ?? []) as { source_id: string; target_id: string }[]) {
    map.set(r.source_id, r.target_id);
  }
  return map;
}

/** All blocks (occurrences) and events for one local date, sorted by start time. */
export async function getAgenda(supabase: Supabase, date: string, tz: string) {
  const dayStart = zonedToUtc(date, "00:00", tz).toISOString();
  const dayEnd = zonedToUtc(addDays(date, 1), "00:00", tz).toISOString();
  const userId = await currentUserId(supabase);

  const [types, occurrences, eventsRes] = await Promise.all([
    userId ? getBlockTypes(supabase, userId) : Promise.resolve([]),
    userId ? getOccurrences(supabase, userId, date, date) : Promise.resolve([]),
    supabase
      .from("events")
      .select("id,title,start_time,end_time,is_habit")
      .is("deleted_at", null)
      .lt("start_time", dayEnd)
      .gt("end_time", dayStart),
  ]);
  const events = (eventsRes.data ?? []) as EventRow[];
  const typeById = new Map(types.map((t) => [t.id, t]));

  const items: AgendaItem[] = [];
  for (const o of occurrences) {
    const span = spanOn(o, date);
    if (!span) continue;
    const type = typeById.get(o.block_type_id);
    items.push({
      kind: "block",
      id: o.id,
      title: type?.name ?? "Block",
      start: span.start,
      end: span.end,
      color: type?.color ?? null,
      isHabit: false,
      blockTypeId: o.block_type_id,
      status: o.status,
    });
  }
  for (const e of events) {
    const s = utcToLocal(e.start_time, tz);
    const en = utcToLocal(e.end_time, tz);
    items.push({
      kind: "event",
      id: e.id,
      title: e.title,
      start: s.date < date ? 0 : s.minutes,
      end: en.date > date ? 1440 : en.minutes,
      color: null,
      isHabit: e.is_habit,
    });
  }
  return items.sort((a, b) => a.start - b.start || (a.kind === "event" ? -1 : 1));
}

/** Decide what the banner shows at a given minute of the day. */
export function whatNow(items: AgendaItem[], nowMin: number) {
  const isOpen = (i: AgendaItem) => !(i.kind === "block" && i.fulfilledBy);
  const activeEvent = items.find((i) => i.kind === "event" && i.start <= nowMin && nowMin < i.end);
  const activeBlock = items.find(
    (i) => i.kind === "block" && isOpen(i) && i.start <= nowMin && nowMin < i.end
  );
  const next = items.find((i) => i.start > nowMin && isOpen(i));
  return { activeEvent, activeBlock, next };
}
