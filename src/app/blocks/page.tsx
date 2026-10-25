import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { currentUserId, getBlockTypes, getSlots } from "@/lib/calendar/model";
import { userTimezone } from "@/lib/calendar/load";
import { formatDateLong, formatMinutes, localNow, timeToMinutes } from "@/lib/time";
import { dayList } from "@/lib/blocks-summary";
import BlockTypeCard from "@/components/BlockTypeCard";
import type { Slot } from "@/lib/calendar/types";
import { isMobileRequest } from "@/lib/device";
import Icon from "@/components/ui/Icon";

export const dynamic = "force-dynamic";

/** One line per time, with the days it repeats on: "Mon–Fri 9:00 AM – 11:00 AM". */
function describeAll(slots: Slot[], today: string) {
  const groups = new Map<string, { days: number[]; s: Slot }>();
  for (const sl of slots) {
    const key = `${sl.start_time}|${sl.end_time}|${sl.valid_from > today ? sl.valid_from : ""}|${sl.valid_to ?? ""}`;
    const g = groups.get(key);
    if (g) g.days.push(sl.weekday);
    else groups.set(key, { days: [sl.weekday], s: sl });
  }
  return [...groups.values()]
    .sort((a, b) => Math.min(...a.days) - Math.min(...b.days) || a.s.start_time.localeCompare(b.s.start_time))
    .map(({ days, s }) => {
      const start = timeToMinutes(s.start_time);
      const end = timeToMinutes(s.end_time);
      let text = `${dayList(days)} · ${formatMinutes(start)} – ${formatMinutes(end)}${end < start ? " (next day)" : ""}`;
      if (s.valid_from > today) text += ` · from ${formatDateLong(s.valid_from)}`;
      if (s.valid_to) text += ` · until ${formatDateLong(s.valid_to)}`;
      return text;
    });
}

export default async function BlocksPage() {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return null;
  const today = localNow(await userTimezone(supabase, userId)).date;
  const [types, slots] = await Promise.all([getBlockTypes(supabase, userId), getSlots(supabase, userId, today)]);
  const mobile = await isMobileRequest();

  return (
    <>
      <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6 lg:py-8">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Blocks</h1>
            {types.length > 0 && (
              <div className="flex flex-wrap items-center gap-2" aria-label="Download blocks summary">
                <span className="flex items-center gap-1.5 text-xs font-medium text-muted">
                  <Icon name="import" size={14} />
                  Download summary
                </span>
                {[
                  { f: "pdf", label: "PDF", hint: "Easy to read or print" },
                  { f: "csv", label: "Excel / CSV", hint: "One row per time slot, to sort and filter" },
                  { f: "txt", label: "Text", hint: "Plain text, clearly laid out" },
                ].map((d) => (
                  <a
                    key={d.f}
                    href={`/api/blocks/summary?format=${d.f}`}
                    download
                    title={d.hint}
                    className="rounded-md border border-edge bg-surface px-2.5 py-1 text-xs font-medium shadow-sm transition-colors hover:bg-subtle"
                  >
                    {d.label}
                  </a>
                ))}
              </div>
            )}
          </div>
          <p className="text-sm text-muted">
            A block is time reserved for an activity and repeats every week. Its name is its identity: one block can have
            many time slots. Create and move blocks in the <Link href="/calendar" className="underline">calendar</Link>.
          </p>
        </div>
        <ul className="space-y-3">
          {types.map((t) => (
            <BlockTypeCard
              key={t.id}
              id={t.id}
              name={t.name}
              color={t.color}
              slots={describeAll(slots.filter((s) => s.block_type_id === t.id), today)}
              readOnly={mobile}
            />
          ))}
          {types.length === 0 && (
            <p className="text-sm text-muted">
              No blocks yet. Open the <Link href="/calendar" className="underline">calendar</Link> and click an empty time.
            </p>
          )}
        </ul>
      </main>
    </>
  );
}
