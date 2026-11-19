// Needs & Wants in Telegram (BL-116, server only): "need: sandals 25" / "want: headphones 80" / "/need …" / "/want …".
// The admin client skips RLS: lib/purchases/data.ts filters every query by user_id.
import type { Ctx } from "@/lib/bot/core";
import type { Kb } from "@/lib/bot/tg";
import { addPurchase } from "@/lib/purchases/data";
import { CAPTURE_HELP, captureReply, type Capture } from "@/lib/purchases/rules";

type Reply = { text: string; kb: Kb };

export async function handlePurchaseCapture(c: Ctx, cap: Capture | "help"): Promise<Reply> {
  if (cap === "help") return { text: CAPTURE_HELP, kb: [] };
  const r = await addPurchase(c.admin, c.userId, { ...cap, source: "telegram" });
  if (!r.ok) return { text: r.error, kb: [] };
  return { text: captureReply(r.item, r.countInList), kb: [] };
}
