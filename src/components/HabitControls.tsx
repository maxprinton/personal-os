import { logHabit } from "@/app/habit-actions";
import type { DayStatus } from "@/lib/streaks";

function Op({ id, op, label, className = "" }: { id: string; op: string; label: string; className?: string }) {
  return (
    <form action={logHabit}>
      <input type="hidden" name="entity_type" value="time_block" />
      <input type="hidden" name="entity_id" value={id} />
      <input type="hidden" name="op" value={op} />
      <button className={`rounded-md border px-2 py-1 text-xs ${className}`}>{label}</button>
    </form>
  );
}

/** Done / Skip (with reason) / Missed buttons for a habit block today. */
export default function HabitControls({
  blockId,
  status,
  reason,
}: {
  blockId: string;
  status: DayStatus | null;
  reason: string | null;
}) {
  if (status) {
    const label =
      status === "completed" ? "Done today" : status === "skipped" ? `Skipped: ${reason ?? ""}` : "Missed today";
    const color =
      status === "completed" ? "text-green-700" : status === "skipped" ? "text-amber-700" : "text-red-600";
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-sm ${color}`}>{label}</span>
        <Op id={blockId} op="clear" label="Undo" className="border-neutral-300 text-neutral-500" />
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Op id={blockId} op="completed" label="Done" className="border-green-600 text-green-700" />
      <form action={logHabit} className="flex items-center gap-1">
        <input type="hidden" name="entity_type" value="time_block" />
        <input type="hidden" name="entity_id" value={blockId} />
        <input type="hidden" name="op" value="skipped" />
        <input
          name="reason"
          required
          placeholder="Reason to skip"
          className="w-32 rounded-md border border-neutral-300 px-2 py-1 text-xs"
        />
        <button className="rounded-md border border-amber-500 px-2 py-1 text-xs text-amber-700">Skip</button>
      </form>
      <Op id={blockId} op="failed" label="Missed" className="border-red-400 text-red-600" />
    </div>
  );
}
