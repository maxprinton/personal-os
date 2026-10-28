// Undo of anything the bot saved or changed (server only): the Undo button and /undo both land here.
import type { SupabaseClient } from "@supabase/supabase-js";
import { undoSaved } from "@/lib/capture";
import { getOccurrence } from "@/lib/calendar/model";
import { recomputeOccurrenceStatus, setHabitCheck } from "@/lib/calendar/habits";
import { writeBlockNote } from "@/lib/block-notes";
import type { Ctx } from "@/lib/bot/core";
import { removeFreeDay } from "@/lib/bot/calendar";
import { deleteTxn } from "@/lib/bot/finance";
import { reopenTask, unarchiveTask, undoMove } from "@/lib/bot/tasks";

export type LogRow = { id: string; entity_type: string | null; entity_id: string | null; status: string; parsed: Record<string, unknown> | null };

const soft = (admin: SupabaseClient, table: string, id: string, userId: string) =>
  admin.from(table).update({ deleted_at: new Date().toISOString() }).eq("id", id).eq("user_id", userId);

/** Reverses one logged action. Returns the text to show, or null when there was nothing to undo. */
export async function undoLogged(c: Ctx, bm: LogRow): Promise<string | null> {
  if (bm.status !== "saved" || !bm.entity_type || !bm.entity_id) return null;
  const id = bm.entity_id;
  const p = bm.parsed ?? {};
  let text = "Undone. Nothing was kept.";
  switch (bm.entity_type) {
    case "event":
      await soft(c.admin, "events", id, c.userId);
      break;
    case "payment_template": {
      await soft(c.admin, "payment_templates", id, c.userId);
      await c.admin
        .from("events")
        .update({ deleted_at: new Date().toISOString() })
        .eq("user_id", c.userId)
        .eq("payment_template_id", id)
        .is("payment_status", null);
      break;
    }
    case "free_day":
      text = await removeFreeDay(c, id);
      break;
    case "block_note": {
      const prev = typeof p.prev === "string" ? p.prev : null;
      if (prev === null) await soft(c.admin, "notes", id, c.userId);
      else await writeBlockNote(c.admin, c.userId, String(p.name ?? ""), prev);
      text = "↩ The block note is back as it was.";
      break;
    }
    case "snapshot":
      await soft(c.admin, "balance_snapshots", id, c.userId);
      text = "↩ Real balance removed.";
      break;
    case "metric": {
      const prev = typeof p.prev === "number" ? p.prev : null;
      if (prev === null) await soft(c.admin, "daily_metrics", id, c.userId);
      else await c.admin.from("daily_metrics").update({ value: prev }).eq("id", id).eq("user_id", c.userId);
      text = "↩ Metric back as it was.";
      break;
    }
    case "habit_check": {
      const occ = await getOccurrence(c.admin, c.userId, String(p.occurrenceId ?? ""));
      if (occ) {
        await setHabitCheck(c.admin, c.userId, id, occ, null, "telegram");
        await recomputeOccurrenceStatus(c.admin, c.userId, occ.id, c.today);
      }
      text = "↩ Mark removed.";
      break;
    }
    case "payment_paid":
      await deleteTxn(c, id);
      text = "↩ Payment undone: it is due again.";
      break;
    case "payment_skip":
      await c.admin.from("events").update({ payment_status: null }).eq("id", id).eq("user_id", c.userId).eq("payment_status", "skipped");
      text = "↩ It is due again.";
      break;
    case "transaction":
      await deleteTxn(c, id);
      break;
    case "task_done":
      text = (await reopenTask(c, id)).text;
      break;
    case "task_move":
      text = (await undoMove(c, id, (p.prevDate as string | null) ?? null, (p.prevOcc as string | null) ?? null)).text;
      break;
    case "task_archive":
      text = (await unarchiveTask(c, id, (p.prevDate as string | null) ?? null, (p.prevOcc as string | null) ?? null)).text;
      break;
    default:
      await undoSaved(c.admin, c.userId, bm.entity_type, id);
  }
  await c.admin.from("bot_messages").update({ status: "undone" }).eq("id", bm.id).eq("user_id", c.userId);
  return text;
}

export async function undoById(c: Ctx, logId: string) {
  const { data } = await c.admin
    .from("bot_messages")
    .select("id,entity_type,entity_id,status,parsed")
    .eq("id", logId)
    .eq("user_id", c.userId)
    .maybeSingle();
  return data ? undoLogged(c, data as LogRow) : null;
}

/** /undo: the last thing saved. */
export async function undoLast(c: Ctx) {
  const { data } = await c.admin
    .from("bot_messages")
    .select("id,entity_type,entity_id,status,parsed")
    .eq("user_id", c.userId)
    .eq("status", "saved")
    .is("deleted_at", null)
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? undoLogged(c, data as LogRow) : null;
}
