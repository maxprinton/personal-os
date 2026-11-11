import TelegramModule, { type FeatureView } from "@/components/telegram/TelegramModule";
import { FEATURES, baseWords, isEditable } from "@/lib/bot/registry";
import { createClient } from "@/lib/supabase/server";
import { MENU_KEYBOARD } from "@/lib/telegram";
import type { VocabRow } from "@/lib/bot/vocab";

export const metadata = { title: "Telegram · Personal OS" };
export const dynamic = "force-dynamic";

export default async function TelegramPage() {
  const supabase = await createClient();
  // RLS: only your own rows. A missing table (migration 0055 not run yet) just shows the built-in words.
  const { data } = await supabase.from("bot_vocab").select("feature_id,word,kind");
  const vocab = ((data ?? []) as VocabRow[]).filter((r) => r.kind === "add" || r.kind === "hide");
  const features: FeatureView[] = FEATURES.map((f) => ({ ...f, base: baseWords(f), editable: isEditable(f) }));
  const menu = MENU_KEYBOARD.keyboard.map((row) => row.map((b) => b.text));
  return (
    <main className="mx-auto w-full max-w-7xl space-y-4 px-4 py-6 sm:px-6 lg:py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Telegram</h1>
        <p className="text-sm text-muted">
          Everything the bot can do, how each thing works, and a practice chat that runs the real bot without saving anything.
        </p>
      </div>
      <TelegramModule features={features} menu={menu} initialVocab={vocab} />
    </main>
  );
}
