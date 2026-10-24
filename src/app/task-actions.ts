"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/agenda";
import { parseTags, setTags, type EntityType } from "@/lib/tags";
import { relationFor } from "@/lib/links";
import { localNow } from "@/lib/time";
import { clearActivity, setActivity } from "@/lib/habits";
import { autoPlaceTasks, countMove, getTask } from "@/lib/calendar/tasks";
import { recomputeOccurrenceStatus } from "@/lib/calendar/habits";
import type { ActionState } from "@/app/actions";

const POLICIES = ["migrate", "backlog", "graveyard"] as const;

function refresh() {
  revalidatePath("/");
  revalidatePath("/tasks");
  revalidatePath("/notes");
}

function parseTarget(value: string): { type: EntityType; id: string } | null {
  const [type, id] = value.split(":");
  if (!id || !["time_block", "block_type", "event", "task", "note"].includes(type)) return null;
  return { type: type as EntityType, id };
}

export async function createTask(_prev: ActionState, form: FormData): Promise<ActionState> {
  const title = String(form.get("title") ?? "").trim();
  if (!title) return { error: "Title is required." };
  const policyRaw = String(form.get("rollover_policy") ?? "migrate");
  const policy = (POLICIES as readonly string[]).includes(policyRaw) ? policyRaw : "migrate";
  const noDate = form.get("no_date") === "on";
  const date = String(form.get("scheduled_for") ?? "");

  const supabase = await createClient();
  const { timezone } = await getSettings(supabase);
  const today = localNow(timezone).date;
  let scheduled_for = noDate ? null : date || today;
  if (scheduled_for && scheduled_for < today) return { error: "Pick today or a later date." };
  const home = String(form.get("home_block") ?? "") || null;

  // "In an event": an event with tasks acts like a block for them
  let event_id: string | null = null;
  const eventId = String(form.get("event") ?? "");
  if (eventId && !noDate) {
    const { data: ev } = await supabase
      .from("events")
      .select("id,event_date,end_date")
      .eq("id", eventId)
      .is("deleted_at", null)
      .maybeSingle();
    if (ev) {
      event_id = ev.id as string;
      if (!scheduled_for || scheduled_for < (ev.event_date as string) || scheduled_for > (ev.end_date as string)) {
        scheduled_for = ev.event_date as string;
      }
    }
  }

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      title,
      scheduled_for,
      rollover_policy: policy,
      status: noDate ? "backlog" : "pending",
      home_block_type_id: home,
      event_id,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Could not create task." };
  // If its home block is on that day, it goes straight in (not a move)
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user && home && !event_id) await autoPlaceTasks(supabase, user.id, today);

  const tags = parseTags(String(form.get("tags") ?? ""));
  if (tags.length) await setTags(supabase, "task", data.id, tags);

  const target = parseTarget(String(form.get("link") ?? ""));
  if (target) {
    const { error: relError } = await supabase.from("entity_relations").insert({
      source_type: "task",
      source_id: data.id,
      target_type: target.type,
      target_id: target.id,
      relationship_type: relationFor("task", target.type),
    });
    if (relError) return { error: `Task saved, but link failed: ${relError.message}` };
  }
  refresh();
  return { ok: true, at: Date.now() };
}

/** One action for all task buttons: op = complete | reopen | backlog | today | delete */
export async function updateTask(form: FormData) {
  const id = String(form.get("id") ?? "");
  const op = String(form.get("op") ?? "");
  if (!id) return;
  const supabase = await createClient();
  const now = new Date().toISOString();

  if (op === "complete" || op === "reopen") {
    const done = op === "complete";
    const { data: task } = await supabase
      .from("tasks")
      .update({ status: done ? "completed" : "pending", completed_at: done ? now : null })
      .eq("id", id)
      .select("is_habit,occurrence_id")
      .maybeSingle();
    if (task?.occurrence_id) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { timezone } = await getSettings(supabase);
      if (user) await recomputeOccurrenceStatus(supabase, user.id, task.occurrence_id as string, localNow(timezone).date);
    }
    if (task?.is_habit) {
      // Habit tasks also write to the unified activity log (powers streaks)
      const { timezone } = await getSettings(supabase);
      const date = localNow(timezone).date;
      if (done) await setActivity(supabase, "task", id, date, "completed");
      else await clearActivity(supabase, "task", id, date);
    }
    revalidatePath("/habits");
  } else if (op === "backlog") {
    await supabase
      .from("tasks")
      .update({ status: "backlog", completed_at: null, occurrence_id: null, event_id: null })
      .eq("id", id);
  } else if (op === "today") {
    const { timezone } = await getSettings(supabase);
    const today = localNow(timezone).date;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const before = user ? await getTask(supabase, user.id, id) : null;
    await supabase
      .from("tasks")
      .update({ status: "pending", completed_at: null, scheduled_for: today, occurrence_id: null, event_id: null })
      .eq("id", id);
    if (user && before) {
      // Pulling a planned task to another day is a manual move (+1); from the backlog it is not
      if (before.status === "pending" && before.scheduled_for && before.scheduled_for > today) {
        await countMove(supabase, user.id, before, before.scheduled_for);
      }
      await autoPlaceTasks(supabase, user.id, today);
    }
  } else if (op === "delete") {
    await supabase
      .from("entity_relations")
      .update({ deleted_at: now })
      .eq("source_type", "task")
      .eq("source_id", id);
    await supabase.from("entity_tags").update({ deleted_at: now }).eq("entity_type", "task").eq("entity_id", id);
    await supabase.from("tasks").update({ deleted_at: now }).eq("id", id);
  }
  refresh();
}

/** Add a link from a task or note to a block / event / task / note. */
export async function addLink(_prev: ActionState, form: FormData): Promise<ActionState> {
  const sourceType = String(form.get("source_type") ?? "") as EntityType;
  const sourceId = String(form.get("source_id") ?? "");
  const target = parseTarget(String(form.get("target") ?? ""));
  if (!sourceId || !["task", "note"].includes(sourceType)) return { error: "Invalid source." };
  if (!target) return { error: "Pick something to link to." };
  const supabase = await createClient();
  const { error } = await supabase.from("entity_relations").insert({
    source_type: sourceType,
    source_id: sourceId,
    target_type: target.type,
    target_id: target.id,
    relationship_type: relationFor(sourceType, target.type),
  });
  if (error) {
    if (error.code === "23505") return { error: "Already linked." };
    return { error: error.message };
  }
  refresh();
  revalidatePath(`/notes/${sourceId}`);
  return { ok: true, at: Date.now() };
}

export async function removeLink(form: FormData) {
  const id = String(form.get("relation_id") ?? "");
  const back = String(form.get("back") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("entity_relations").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  refresh();
  if (back.startsWith("/")) revalidatePath(back);
}
