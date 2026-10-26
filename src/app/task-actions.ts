"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/agenda";
import { parseTags, setTags, type EntityType } from "@/lib/tags";
import { relationFor } from "@/lib/links";
import { localNow } from "@/lib/time";
import { clearActivity, setActivity } from "@/lib/habits";
import { autoPlaceTasks, countMove, getTask, rescheduleTarget } from "@/lib/calendar/tasks";
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

const EDIT_STATUSES = ["pending", "backlog", "completed", "failed", "archived"] as const;

/**
 * Edit everything about a task after creating it: title, status, date, home block, event,
 * end-of-day policy and tags. Changing the day of a pending task counts as a manual move (+1),
 * like dragging it in the calendar. A new day, home block or event takes it out of the block it was in.
 */
export async function editTask(_prev: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get("id") ?? "");
  const title = String(form.get("title") ?? "").trim().slice(0, 300);
  if (!id) return { error: "Missing task." };
  if (!title) return { error: "Title is required." };
  const statusRaw = String(form.get("status") ?? "pending");
  const status = (EDIT_STATUSES as readonly string[]).includes(statusRaw) ? statusRaw : "pending";
  const policyRaw = String(form.get("rollover_policy") ?? "migrate");
  const policy = (POLICIES as readonly string[]).includes(policyRaw) ? policyRaw : "migrate";
  const home = String(form.get("home_block") ?? "") || null;
  const eventId = String(form.get("event") ?? "") || null;
  const dateRaw = String(form.get("scheduled_for") ?? "");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You are signed out." };
  const { timezone } = await getSettings(supabase);
  const today = localNow(timezone).date;
  const before = await getTask(supabase, user.id, id);
  if (!before) return { error: "That task no longer exists." };

  let scheduled_for: string | null = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : null;
  if (status === "pending" && !scheduled_for) scheduled_for = today;
  if (status === "pending" && scheduled_for && scheduled_for < today && scheduled_for !== before.scheduled_for) {
    return { error: "Pick today or a later date (past days can't receive new tasks)." };
  }

  // "In an event": the task's day must fall inside the event
  let event_id: string | null = null;
  if (eventId && status === "pending") {
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

  // Keep it in its block only if nothing about where/when it goes changed
  const keepPlace =
    status === "pending" &&
    !event_id &&
    scheduled_for === before.scheduled_for &&
    home === before.home_block_type_id &&
    !before.event_id;
  const values: Record<string, unknown> = {
    title,
    status,
    scheduled_for,
    rollover_policy: policy,
    home_block_type_id: home,
    event_id,
    occurrence_id: keepPlace ? before.occurrence_id : null,
    completed_at: status === "completed" ? before.completed_at ?? new Date().toISOString() : null,
    ...(status !== "archived" && before.status === "archived" ? { archived_at: null } : {}),
  };
  const { error } = await supabase.from("tasks").update(values).eq("id", id).eq("user_id", user.id);
  if (error) return { error: error.message };

  // A pending task moved to another day = a manual move (shown as "moved" on the day it left, if that day has come)
  if (before.status === "pending" && status === "pending" && before.scheduled_for && scheduled_for !== before.scheduled_for) {
    await countMove(supabase, user.id, before, before.scheduled_for <= today ? before.scheduled_for : null);
  }
  // The block it was in (and the one it may land in) update their done / partly done state
  if (before.occurrence_id) await recomputeOccurrenceStatus(supabase, user.id, before.occurrence_id, today);
  if (status === "pending" && home && !event_id && !keepPlace) await autoPlaceTasks(supabase, user.id, today);

  await setTags(supabase, "task", id, parseTags(String(form.get("tags") ?? "")));
  refresh();
  return { ok: true, at: Date.now() };
}

// ---------- Task actions available in every view: reschedule, archive, restore ----------

export type TaskActionResult = { ok?: boolean; error?: string; message?: string };

async function taskCtx() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You are signed out. Sign in again.");
  const { timezone } = await getSettings(supabase);
  return { supabase, userId: user.id, today: localNow(timezone).date };
}

/** Where "Next time it happens" would send a task (shown in the Reschedule menu). */
export async function getRescheduleOptions(taskId: string): Promise<{
  error?: string;
  blockName?: string | null;
  next?: { date: string; start: string } | null;
  today?: string;
  scheduledFor?: string | null;
}> {
  try {
    const { supabase, userId, today } = await taskCtx();
    const task = await getTask(supabase, userId, taskId);
    if (!task) return { error: "That task no longer exists." };
    const after = task.scheduled_for && task.scheduled_for > today ? task.scheduled_for : today;
    const { blockName, next } = await rescheduleTarget(supabase, userId, task, after);
    return { blockName, next: next ? { date: next.date, start: next.start_time.slice(0, 5) } : null, today, scheduledFor: task.scheduled_for };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Something went wrong." };
  }
}

/**
 * Quick reschedule. mode "next" = the next time its block happens (the block it is in, else its home
 * block). mode "date" = another day, out of its current block (its home block picks it up that day).
 * Both count as a move (+1) when the task already had a day.
 */
export async function rescheduleTask(input: { taskId: string; mode: "next" | "date"; date?: string }): Promise<TaskActionResult> {
  try {
    const { supabase, userId, today } = await taskCtx();
    const task = await getTask(supabase, userId, input.taskId);
    if (!task) return { error: "That task no longer exists." };
    if (task.status !== "pending" && task.status !== "backlog") return { error: "Only open tasks can be rescheduled." };

    let date: string;
    let occurrence_id: string | null = null;
    let label: string;
    if (input.mode === "next") {
      const after = task.scheduled_for && task.scheduled_for > today ? task.scheduled_for : today;
      const { blockName, next } = await rescheduleTarget(supabase, userId, task, after);
      if (!blockName) return { error: "This task has no block. Pick a date instead." };
      if (!next) return { error: `${blockName} is not on the calendar in the next 8 weeks. Pick a date instead.` };
      date = next.date;
      occurrence_id = next.id;
      label = `next ${blockName}`;
    } else {
      if (!input.date || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { error: "Pick a date." };
      if (input.date < today) return { error: "Pick today or a later date." };
      if (input.date === task.scheduled_for && task.status === "pending" && !task.occurrence_id && !task.event_id) {
        return { error: "It is already on that day." };
      }
      date = input.date;
      label = date;
    }

    const { error } = await supabase
      .from("tasks")
      .update({ scheduled_for: date, occurrence_id, event_id: null, status: "pending", hold_placement: false, completed_at: null })
      .eq("id", task.id)
      .eq("user_id", userId);
    if (error) return { error: error.message };

    const hadDay = task.status === "pending" && Boolean(task.scheduled_for);
    if (hadDay && (task.scheduled_for !== date || task.occurrence_id !== occurrence_id)) {
      await countMove(supabase, userId, task, task.scheduled_for! <= today ? task.scheduled_for : null);
    }
    if (task.occurrence_id) await recomputeOccurrenceStatus(supabase, userId, task.occurrence_id, today);
    if (occurrence_id) await recomputeOccurrenceStatus(supabase, userId, occurrence_id, today);
    if (input.mode === "date") await autoPlaceTasks(supabase, userId, today);
    refresh();
    return { ok: true, message: `Moved to ${label}.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Something went wrong." };
  }
}

/** Archive: not done, not deleted — you won't do it. Leaves every list and block; restorable. */
export async function archiveTask(input: { taskId: string }): Promise<TaskActionResult> {
  try {
    const { supabase, userId, today } = await taskCtx();
    const task = await getTask(supabase, userId, input.taskId);
    if (!task) return { error: "That task no longer exists." };
    const { error } = await supabase
      .from("tasks")
      .update({ status: "archived", archived_at: new Date().toISOString(), occurrence_id: null, event_id: null })
      .eq("id", task.id)
      .eq("user_id", userId);
    if (error) {
      if (/archived|invalid input value|archived_at/i.test(error.message)) {
        return { error: "Archiving needs a one-time database update: run MIGRACION-0015-archivar-tareas.sql in Supabase." };
      }
      return { error: error.message };
    }
    if (task.occurrence_id) await recomputeOccurrenceStatus(supabase, userId, task.occurrence_id, today);
    refresh();
    return { ok: true, message: "Archived. Find it in Tasks → Archived." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Something went wrong." };
  }
}

/** Bring an archived task back, for today (its home block picks it up if it is on today). */
export async function restoreTask(input: { taskId: string }): Promise<TaskActionResult> {
  try {
    const { supabase, userId, today } = await taskCtx();
    const { error } = await supabase
      .from("tasks")
      .update({ status: "pending", archived_at: null, scheduled_for: today, occurrence_id: null, event_id: null, completed_at: null })
      .eq("id", input.taskId)
      .eq("user_id", userId);
    if (error) return { error: error.message };
    await autoPlaceTasks(supabase, userId, today);
    refresh();
    return { ok: true, message: "Restored for today." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Something went wrong." };
  }
}

/** Tick / untick from any list. */
export async function toggleTaskDone(input: { taskId: string; done: boolean }): Promise<TaskActionResult> {
  try {
    const { supabase, userId, today } = await taskCtx();
    const task = await getTask(supabase, userId, input.taskId);
    if (!task) return { error: "That task no longer exists." };
    const { error } = await supabase
      .from("tasks")
      .update({ status: input.done ? "completed" : "pending", completed_at: input.done ? new Date().toISOString() : null })
      .eq("id", task.id)
      .eq("user_id", userId);
    if (error) return { error: error.message };
    if (task.occurrence_id) await recomputeOccurrenceStatus(supabase, userId, task.occurrence_id, today);
    refresh();
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Something went wrong." };
  }
}
