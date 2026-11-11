// Runs ONE step of the Telegram practice chat (server only): a typed message or a button tap goes through the
// real bot code (handleMessage / handleCallback) with the fake Telegram (store.ts) and the copy-on-write database
// (overlay.ts). The page keeps the transcript and `state`, and sends them back with the next step.
import type { SupabaseClient } from "@supabase/supabase-js";
import { handleCallback } from "@/lib/bot/callbacks";
import { makeCtx } from "@/lib/bot/core";
import { handleMessage } from "@/lib/bot/messages";
import { emptyDb, simClient, type SimDb } from "@/lib/bot/sim/overlay";
import { simStore, simTg, type Kb, type SimEvent } from "@/lib/bot/sim/store";
import { zonedToUtc } from "@/lib/time";

export const SIM_CHAT = 777_000_001;
const MAX_STATE_BYTES = 1_500_000;

export type SimState = { db: SimDb; nextId: number };
export const freshState = (): SimState => ({ db: emptyDb(), nextId: 100 });

/** Practice at another date and time (local time of your timezone). null = the real clock. */
export type Clock = { date: string; time: string } | null;

export type SimInput =
  | { kind: "text"; text: string; replyTo?: number }
  | { kind: "tap"; data: string; message: { id: number; text: string; kb: Kb } }
  /** A voice note: `text` is what you say (practice has no microphone). */
  | { kind: "voice"; text: string }
  /** A receipt photo: practice has no camera, so you say what the receipt shows. */
  | { kind: "photo"; merchant: string; amount: number };

export type SimResult = { events: SimEvent[]; state: SimState; userMessageId?: number; error?: string };

/** The state comes from the browser: keep only what has the right shape and size. */
export function cleanState(raw: unknown): SimState {
  try {
    const s = raw as SimState;
    if (!s || typeof s !== "object" || typeof s.nextId !== "number" || !s.db || typeof s.db.rows !== "object" || typeof s.db.gone !== "object") return freshState();
    if (JSON.stringify(s).length > MAX_STATE_BYTES) return freshState();
    return { db: { rows: s.db.rows, gone: s.db.gone }, nextId: Math.max(100, Math.floor(s.nextId)) };
  } catch {
    return freshState();
  }
}

export async function runSim(real: SupabaseClient, userId: string, input: SimInput, state: SimState, clock: Clock = null): Promise<SimResult> {
  const { data: settings } = await real.from("user_settings").select("timezone").eq("user_id", userId).maybeSingle();
  const db = state.db;
  const overlay = simClient(real, db);
  const tz = (settings?.timezone as string | null) ?? "America/Guayaquil";
  const valid = clock && /^\d{4}-\d{2}-\d{2}$/.test(clock.date) && /^\d{2}:\d{2}$/.test(clock.time);
  const scope = { events: [] as SimEvent[], nextId: state.nextId, now: valid ? zonedToUtc(clock.date, clock.time, tz) : undefined };
  let userMessageId: number | undefined;
  let error: string | undefined;

  await simStore.run(scope, async () => {
    try {
      const c = makeCtx(overlay, userId, SIM_CHAT, tz); // inside the scope: "today" follows the practice clock
      if (input.kind === "voice" || input.kind === "photo") {
        // No microphone or camera in practice: what you said / what the receipt shows goes through the same path as the real bot after it listened / read
        const spoken = input.kind === "voice" ? input.text.trim().slice(0, 500) : `spent ${Math.abs(Number(input.amount) || 0)} ${input.merchant.trim().slice(0, 60)}`.trim();
        if (!spoken) return;
        userMessageId = ++scope.nextId;
        if (input.kind === "voice") simTg(scope, "sendMessage", { chat_id: SIM_CHAT, text: `🎙 “${spoken}”` });
        else scope.events.push({ t: "why", text: "Photo → the real bot reads the receipt with the AI; here it is typed for you" });
        await handleMessage(overlay, { message_id: userMessageId, chat: { id: SIM_CHAT }, text: spoken }, { ctx: c });
        return;
      }
      if (input.kind === "text") {
        const text = input.text.slice(0, 4000);
        userMessageId = ++scope.nextId;
        await handleMessage(
          overlay,
          { message_id: userMessageId, chat: { id: SIM_CHAT }, text, ...(input.replyTo ? { reply_to_message: { message_id: input.replyTo, from: { is_bot: true } } } : {}) },
          { ctx: c },
        );
      } else {
        await handleCallback(
          overlay,
          { id: "sim", data: input.data.slice(0, 64), message: { message_id: input.message.id, chat: { id: SIM_CHAT }, reply_markup: { inline_keyboard: input.message.kb } } },
          { ctx: c },
        );
      }
    } catch (e) {
      error = e instanceof Error ? e.message : "Something went wrong in practice mode.";
    }
  });
  return { events: scope.events, state: { db, nextId: scope.nextId }, userMessageId, error };
}
