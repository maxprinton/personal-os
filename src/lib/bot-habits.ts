import type { SupabaseClient } from "@supabase/supabase-js";
import { localNow } from "@/lib/time";
import { getBlockTypes } from "@/lib/calendar/model";
import { getHabits } from "@/lib/calendar/habits";
import { normalizeName } from "@/lib/calendar/edit";
import { dayData, markHabitFromBot } from "@/lib/reminders";

// Server-only: Telegram habit commands, rule-based (no AI). Runs with the admin client, so EVERY query filters by user_id.
//   habit: Stretch in Gym   → new habit "Stretch" inside the Gym block (also "habito:" / "hábito:", "en" instead of "in")
//   habit: Stretch          → new habit without a block (waits in "Unscheduled" on the Habits page)
//   done stretch / skip stretch → marks it in today's block (also "hecho", "listo", "saltar")

export type HabitCommand =
  | { kind: "create"; name: string; block: string | null }
  | { kind: "mark"; state: "done" | "skipped"; query: string };

/** Lowercase, no accents, single spaces: "Estiramiento  Básico" → "estiramiento basico". */
export function simplify(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function parseHabitCommand(text: string): HabitCommand | null {
  const create = /^h[aá]bit[o]?\s*:\s*(.+)$/i.exec(text.trim());
  if (create) {
    const body = create[1].trim();
    // The LAST " in " / " en " splits name and block, so "Read in bed in Evening" → "Read in bed" + "Evening"
    const m = /^(.+)\s+(?:in|en)\s+(.+)$/i.exec(body);
    const name = normalizeName(m ? m[1] : body);
    const block = m ? normalizeName(m[2]) : null;
    return name ? { kind: "create", name, block } : null;
  }
  const mark = /^(done|hecho|hecha|listo|lista|hice|termin[eé]|complet[eé]|finished|skip|skipped|saltar|salte|salté)\s+(.+)$/i.exec(text.trim());
  if (mark) {
    const word = simplify(mark[1]);
    const state = ["skip", "skipped", "saltar", "salte"].includes(word) ? "skipped" : "done";
    return { kind: "mark", state, query: mark[2].trim() };
  }
  return null;
}

/** Best matches for a name: exact, then starts with, then contains (accents and case ignored). */
function bestMatches<T extends { name: string }>(items: T[], query: string): T[] {
  const q = simplify(query);
  if (!q) return [];
  for (const test of [(n: string) => n === q, (n: string) => n.startsWith(q), (n: string) => n.includes(q)]) {
    const found = items.filter((i) => test(simplify(i.name)));
    if (found.length) return found;
  }
  return [];
}

export type HabitReply = { text: string; createdId?: string };

export async function runHabitCommand(
  admin: SupabaseClient,
  userId: string,
  timezone: string,
  cmd: HabitCommand
): Promise<HabitReply> {
  const today = localNow(timezone).date;
  const habits = await getHabits(admin, userId);

  if (cmd.kind === "create") {
    let blockId: string | null = null;
    let blockName: string | null = null;
    if (cmd.block) {
      const blocks = await getBlockTypes(admin, userId);
      const found = bestMatches(blocks, cmd.block);
      if (found.length !== 1) {
        const names = blocks.map((b) => b.name).join(", ") || "none yet";
        return {
          text:
            found.length > 1
              ? `"${cmd.block}" matches several blocks: ${found.map((b) => b.name).join(", ")}. Write the full name.`
              : `I don't have a block called "${cmd.block}". Your blocks: ${names}.\nNothing was saved. (If "in ${cmd.block}" is part of the habit's name, add the block at the end: habit: ${cmd.name} in ${cmd.block} in Gym)`,
        };
      }
      blockId = found[0].id;
      blockName = found[0].name;
    }
    const twin = habits.find((h) => simplify(h.name) === simplify(cmd.name) && h.block_type_id === blockId);
    if (twin) return { text: `You already have "${twin.name}"${blockName ? ` in ${blockName}` : ""}. Nothing new was saved.` };

    const { data, error } = await admin
      .from("habits")
      .insert({ user_id: userId, name: cmd.name, block_type_id: blockId, active_from: today })
      .select("id")
      .single();
    if (error || !data) return { text: "Sorry, I could not create that habit." };
    return {
      createdId: data.id as string,
      text: blockName
        ? `Saved ✓ habit "${cmd.name}" in ${blockName}. It shows up every time ${blockName} is on the calendar.`
        : `Saved ✓ habit "${cmd.name}" (no block yet). Place it in a block on the Habits page to start tracking it.`,
    };
  }

  // ---- mark: done / skip ----
  const found = bestMatches(habits, cmd.query);
  if (found.length === 0) {
    const names = habits.map((h) => h.name).join(", ") || "none yet";
    return { text: `I don't have a habit called "${cmd.query}". Your habits: ${names}.` };
  }
  if (new Set(found.map((h) => simplify(h.name))).size > 1) {
    return { text: `"${cmd.query}" matches several habits: ${found.map((h) => h.name).join(", ")}. Write more of the name.` };
  }
  const ids = new Set(found.map((h) => h.id));
  const day = await dayData(admin, { user_id: userId, timezone }, today);
  const slots = day.habits.filter((h) => ids.has(h.habitId));
  if (!slots.length) {
    return { text: `"${found[0].name}" isn't in any block on today's calendar, so there is nothing to mark today.` };
  }
  // Several appearances today → the first one not marked yet (else the first)
  const target = slots.find((s) => !s.status) ?? slots[0];
  if (target.status === cmd.state) {
    return { text: `"${found[0].name}" is already marked ${cmd.state === "done" ? "done" : "skipped"} today.` };
  }
  const r = await markHabitFromBot(admin, userId, timezone, target.habitId, target.occurrenceId, cmd.state);
  return { text: r.text };
}
