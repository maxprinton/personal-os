"use client";

import { useActionState } from "react";
import { saveReminders, sendTestReminder } from "@/app/settings-actions";
import type { ActionState } from "@/app/actions";

type Values = {
  morningOn: boolean;
  morningTime: string;
  eveningOn: boolean;
  eveningTime: string;
  before: number;
  insightsOn: boolean;
  unassignedOn: boolean;
};

const input = "rounded-md border border-line-strong px-2 py-1 text-sm";

export default function ReminderSettings({ values }: { values: Values }) {
  const [saved, save, saving] = useActionState<ActionState, FormData>(saveReminders, {});
  const [test, sendTest, testing] = useActionState<ActionState, FormData>(sendTestReminder, {});
  return (
    <section className="space-y-3 rounded-lg border border-line p-4 bg-surface shadow-card">
      <h2 className="font-medium">Telegram reminders</h2>
      <p className="text-sm text-muted">The bot writes to you. Times are in your timezone.</p>
      <form action={save} className="space-y-2 text-sm">
        <label className="flex flex-wrap items-center gap-2">
          <input type="checkbox" name="morning_on" defaultChecked={values.morningOn} />
          Morning summary at
          <input type="time" name="morning_time" defaultValue={values.morningTime} className={input} />
          <span className="text-faint">schedule, tasks and habits for the day</span>
        </label>
        <label className="flex flex-wrap items-center gap-2">
          Remind me
          <select name="before" defaultValue={String(values.before)} className={input}>
            <option value="0">never</option>
            <option value="5">5 min</option>
            <option value="10">10 min</option>
            <option value="15">15 min</option>
            <option value="30">30 min</option>
            <option value="60">1 hour</option>
          </select>
          before each event and time block
        </label>
        <label className="flex flex-wrap items-center gap-2">
          <input type="checkbox" name="evening_on" defaultChecked={values.eveningOn} />
          Evening check-in at
          <input type="time" name="evening_time" defaultValue={values.eveningTime} className={input} />
          <span className="text-faint">log habits with one tap</span>
        </label>
        <label className="flex flex-wrap items-center gap-2">
          <input type="checkbox" name="unassigned_on" defaultChecked={values.unassignedOn} />
          Keep reminding me (11:00 and 16:00) while tasks have no block
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="insights_on" defaultChecked={values.insightsOn} />
          Send the Monday insights to Telegram too
        </label>
        <button disabled={saving} className="rounded-md bg-accent font-medium shadow-sm transition-colors hover:bg-accent-hover px-3 py-1.5 text-accent-fg disabled:opacity-50">
          {saving ? "Saving..." : "Save reminders"}
        </button>
        {saved.ok && <span className="ml-2 text-success">Saved.</span>}
        {saved.error && <span className="ml-2 text-danger">{saved.error}</span>}
      </form>
      <form action={sendTest} className="text-sm">
        <button disabled={testing} className="rounded-md border border-edge transition-colors hover:bg-subtle px-3 py-1.5 disabled:opacity-50">
          {testing ? "Sending..." : "Send me a test message"}
        </button>
        {test.ok && <span className="ml-2 text-success">Sent — check Telegram.</span>}
        {test.error && <span className="ml-2 text-danger">{test.error}</span>}
      </form>
    </section>
  );
}
