import type { createClient } from "@/lib/supabase/server";
import { currentUserId, getBlockTypes, getOccurrences } from "@/lib/calendar/model";
import { getEvents, getEventTypes } from "@/lib/calendar/events";
import { eventSpanOn, spanOn } from "@/lib/calendar/overlap";
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
  allDay?: boolean; // event without time (metadata of the day)
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
  const userId = await currentUserId(supabase);
  if (!userId) return [] as AgendaItem[];

  const [types, occurrences, events, eventTypes] = await Promise.all([
    getBlockTypes(supabase, userId, { includeDeleted: true }),
    getOccurrences(supabase, userId, date, date),
    getEvents(supabase, userId, date, date, tz),
    getEventTypes(supabase, userId),
  ]);
  const typeById = new Map(types.map((t) => [t.id, t]));
  const eventColor = new Map(eventTypes.map((t) => [t.id, t.color]));

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
    const span = eventSpanOn(e, date);
    if (!span) continue;
    items.push({
      kind: "event",
      id: e.id,
      title: e.title,
      start: span.start,
      end: span.end,
      color: (e.event_type_id && eventColor.get(e.event_type_id)) || null,
      isHabit: false,
      allDay: span.allDay,
    });
  }
  return items.sort(
    (a, b) => Number(Boolean(b.allDay)) - Number(Boolean(a.allDay)) || a.start - b.start || (a.kind === "event" ? -1 : 1)
  );
}

/** Decide what the banner shows at a given minute of the day (events without time are ignored). */
export function whatNow(all: AgendaItem[], nowMin: number) {
  const items = all.filter((i) => !i.allDay && i.status !== "free_day");
  const isOpen = (i: AgendaItem) => !(i.kind === "block" && i.fulfilledBy);
  const activeEvent = items.find((i) => i.kind === "event" && i.start <= nowMin && nowMin < i.end);
  const activeBlock = items.find(
    (i) => i.kind === "block" && isOpen(i) && i.start <= nowMin && nowMin < i.end
  );
  const next = items.find((i) => i.start > nowMin && isOpen(i));
  return { activeEvent, activeBlock, next };
}
