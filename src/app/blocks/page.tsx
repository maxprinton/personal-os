import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { currentUserId, getBlockTypes, getSlots } from "@/lib/calendar/model";
import { userTimezone } from "@/lib/calendar/load";
import { formatDateLong, formatMinutes, localNow, timeToMinutes, ISO_DAY_SHORT } from "@/lib/time";
import Nav from "@/components/Nav";
import BlockTypeCard from "@/components/BlockTypeCard";
import type { Slot } from "@/lib/calendar/types";
import { isMobileRequest } from "@/lib/device";

export const dynamic = "force-dynamic";

function describe(s: Slot, today: string) {
  const end = timeToMinutes(s.end_time);
  const start = timeToMinutes(s.start_time);
  let text = `${ISO_DAY_SHORT[s.weekday - 1]} ${formatMinutes(start)} – ${formatMinutes(end)}${end < start ? " (next day)" : ""}`;
  if (s.valid_from > today) text += ` · from ${formatDateLong(s.valid_from)}`;
  if (s.valid_to) text += ` · until ${formatDateLong(s.valid_to)}`;
  return text;
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
      <Nav active="/blocks" />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
        <div>
          <h1 className="text-2xl font-semibold">Blocks</h1>
          <p className="text-sm text-neutral-500">
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
              slots={slots.filter((s) => s.block_type_id === t.id).map((s) => describe(s, today))}
              readOnly={mobile}
            />
          ))}
          {types.length === 0 && (
            <p className="text-sm text-neutral-500">
              No blocks yet. Open the <Link href="/calendar" className="underline">calendar</Link> and click an empty time.
            </p>
          )}
        </ul>
      </main>
    </>
  );
}
