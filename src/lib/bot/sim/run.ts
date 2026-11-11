// Runs ONE step of the Telegram practice chat (server only): a typed message or a button tap goes through the
// real bot code (handleMessage / handleCallback) with the fake Telegram (store.ts) and the copy-on-write database
// (overlay.ts). The page keeps the transcript and `state`, and sends them back with the next step.
import type { SupabaseClient } from "@supabase/supabase-js";
import { handleCallback } from "@/lib/bot/callbacks";
import { makeCtx } from "@/lib/bot/core";
import { handleMessage } from "@/lib/bot/messages";
import { emptyDb, simClient, type SimDb } from "@/lib/bot/sim/overlay";
import { simStore, type Kb, type SimEvent } from "@/lib/bot/sim/store";

export const SIM_CHAT = 777_000_001;
const MAX_STATE_BYTES = 1_500_000;

export type SimState = { db: SimDb; nextId: number };
export const freshState = (): SimState => ({ db: emptyDb(), nextId: 100 });

export type SimInput =
  | { kind: "text"; text: string; replyTo?: number }
  | { kind: "tap"; data: string; message: { id: number; text: string; kb: Kb } };

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

export async function runSim(real: SupabaseClient, userId: string, input: SimInput, state: SimState): Promise<SimResult> {
  const { data: settings } = await real.from("user_settings").select("timezone").eq("user_id", userId).maybeSingle();
  const db = state.db;
  const overlay = simClient(real, db);
  const c = makeCtx(overlay, userId, SIM_CHAT, (settings?.timezone as string | null) ?? null);
  const scope = { events: [] as SimEvent[], nextId: state.nextId };
  let userMessageId: number | undefined;
  let error: string | undefined;

  await simStore.run(scope, async () => {
    try {
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
