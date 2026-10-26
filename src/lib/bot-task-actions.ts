import type { SupabaseClient } from "@supabase/supabase-js";
import { localNow } from "@/lib/time";
import { countMove, getTask, rescheduleTarget } from "@/lib/calendar/tasks";
import { recomputeOccurrenceStatus } from "@/lib/calendar/habits";

// Server-only: task actions from Telegram buttons (admin client, so EVERY query filters by user_id).

/** ⏭ = the next time the task's block happens (counts as a move). */
export async function rescheduleNextFromBot(admin: SupabaseClient, userId: string, timezone: string, taskId: string) {
  const today = localNow(timezone).date;
  const task = await getTask(admin, userId, taskId);
  if (!task) return { ok: false, text: "Could not find that task." };
  if (task.status !== "pending" && task.status !== "backlog") return { ok: false, text: `“${task.title}” is not open any more.` };
  const after = task.scheduled_for && task.scheduled_for > today ? task.scheduled_for : today;
  const { blockName, next } = await rescheduleTarget(admin, userId, task, after);
  if (!blockName) return { ok: false, text: `“${task.title}” is not in a block. Pick a date in the app.` };
  if (!next) return { ok: false, text: `${blockName} is not on the calendar in the next 8 weeks. Pick a date in the app.` };
  await admin
    .from("tasks")
    .update({ scheduled_for: next.date, occurrence_id: next.id, event_id: null, status: "pending", hold_placement: false })
    .eq("id", task.id)
    .eq("user_id", userId);
  if (task.status === "pending" && task.scheduled_for) {
    await countMove(admin, userId, task, task.scheduled_for <= today ? task.scheduled_for : null);
  }
  if (task.occurrence_id) await recomputeOccurrenceStatus(admin, userId, task.occurrence_id, today);
  await recomputeOccurrenceStatus(admin, userId, next.id, today);
  const when = new Date(`${next.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  return { ok: true, text: `⏭ “${task.title}” → next ${blockName}, ${when} ${next.start_time.slice(0, 5)}` };
}

/** 🗄 Archive: not done, not deleted. Restorable in the app (Tasks → Archived). */
export async function archiveFromBot(admin: SupabaseClient, userId: string, timezone: string, taskId: string) {
  const today = localNow(timezone).date;
  const task = await getTask(admin, userId, taskId);
  if (!task) return { ok: false, text: "Could not find that task." };
  const { error } = await admin
    .from("tasks")
    .update({ status: "archived", archived_at: new Date().toISOString(), occurrence_id: null, event_id: null })
    .eq("id", task.id)
    .eq("user_id", userId);
  if (error) return { ok: false, text: "Archiving needs the database update (migration 0015) first." };
  if (task.occurrence_id) await recomputeOccurrenceStatus(admin, userId, task.occurrence_id, today);
  return { ok: true, text: `🗄 Archived “${task.title}” (restore it in the app: Tasks → Archived)` };
}
