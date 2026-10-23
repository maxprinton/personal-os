import type { createClient } from "@/lib/supabase/server";
import { addDays, occursOn, timeToMinutes, utcToLocal, zonedToUtc } from "@/lib/time";

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
  id: string;
  title: string;
  start: number; // minutes since local midnight
  end: number;
  color: string | null;
  isHabit: boolean;
  fulfilledBy?: string; // block: title of the event that fulfills it
  fulfills?: string; // event: title of the block it fulfills
};

export async function getSettings(supabase: Supabase) {
  const { data } = await supabase.from("user_settings").select("timezone").maybeSingle();
  return { timezone: (data?.timezone as string | undefined) ?? "America/Guayaquil" };
}

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

/** All blocks and events for one local date, sorted by start time. */
export async function getAgenda(supabase: Supabase, date: string, tz: string) {
  const dayStart = zonedToUtc(date, "00:00", tz).toISOString();
  const dayEnd = zonedToUtc(addDays(date, 1), "00:00", tz).toISOString();

  const [blocks, eventsRes] = await Promise.all([
    getActiveBlocks(supabase),
    supabase
      .from("events")
      .select("id,title,start_time,end_time,is_habit")
      .is("deleted_at", null)
      .lt("start_time", dayEnd)
      .gt("end_time", dayStart),
  ]);
  const events = (eventsRes.data ?? []) as EventRow[];
  const fulfills = await getFulfillments(
    supabase,
    events.map((e) => e.id)
  );

  const blockTitle = new Map(blocks.map((b) => [b.id, b.title]));
  const fulfilledBy = new Map<string, string>();
  for (const e of events) {
    const blockId = fulfills.get(e.id);
    if (blockId) fulfilledBy.set(blockId, e.title);
  }

  const items: AgendaItem[] = [];
  const yesterday = addDays(date, -1);
  for (const b of blocks) {
    const start = timeToMinutes(b.start_time);
    const end = timeToMinutes(b.end_time);
    const overnight = end < start; // e.g. 23:00 -> 01:00 ends the next day
    const base = { kind: "block" as const, id: b.id, title: b.title, color: b.color, isHabit: b.is_habit };
    if (occursOn(b, date)) {
      items.push({ ...base, start, end: overnight ? 1440 : end, fulfilledBy: fulfilledBy.get(b.id) });
    }
    if (overnight && occursOn(b, yesterday)) {
      items.push({ ...base, start: 0, end });
    }
  }
  for (const e of events) {
    const s = utcToLocal(e.start_time, tz);
    const en = utcToLocal(e.end_time, tz);
    const blockId = fulfills.get(e.id);
    items.push({
      kind: "event",
      id: e.id,
      title: e.title,
      start: s.date < date ? 0 : s.minutes,
      end: en.date > date ? 1440 : en.minutes,
      color: null,
      isHabit: e.is_habit,
      fulfills: blockId ? blockTitle.get(blockId) : undefined,
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
