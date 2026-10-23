import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { botToken, tg } from "@/lib/telegram";
import { createLinkCode, deleteTag, deleteUnusedTags, generateInsightsNow, unlinkTelegram } from "@/app/settings-actions";
import Nav from "@/components/Nav";
import { liveTagLinks } from "@/lib/tags";
import ConnectBotButton from "@/components/ConnectBotButton";

export const dynamic = "force-dynamic";

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? "bg-green-600" : "bg-neutral-300"}`} />
      <span className={ok ? "" : "text-neutral-500"}>{label}</span>
    </li>
  );
}

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: s } = await supabase
    .from("user_settings")
    .select("timezone,currency,locale,telegram_chat_id,telegram_link_code,telegram_link_expires")
    .maybeSingle();

  const hasToken = Boolean(botToken());
  const hasSecret = Boolean(process.env.SUPABASE_SECRET_KEY);
  const hasAi = Boolean(process.env.ANTHROPIC_API_KEY);
  let botName: string | null = null;
  let webhookOk = false;
  if (hasToken) {
    const me = await tg("getMe", {});
    botName = (me?.result as { username?: string } | undefined)?.username ?? null;
    const info = await tg("getWebhookInfo", {});
    webhookOk = Boolean((info?.result as { url?: string } | undefined)?.url?.endsWith("/api/telegram/webhook"));
  }
  const [{ data: tagRows }, { live: tagUse }] = await Promise.all([
    supabase.from("tags").select("id,name").is("deleted_at", null).order("name"),
    liveTagLinks(supabase),
  ]);
  const useCount = new Map<string, number>();
  for (const u of tagUse) useCount.set(u.tag_id, (useCount.get(u.tag_id) ?? 0) + 1);
  const tags = ((tagRows ?? []) as { id: string; name: string }[]).map((t) => ({ ...t, uses: useCount.get(t.id) ?? 0 }));
  const unusedCount = tags.filter((t) => t.uses === 0).length;

  const codeValid =
    s?.telegram_link_code && s.telegram_link_expires && new Date(s.telegram_link_expires) > new Date();

  return (
    <>
      <Nav active="/settings" />
      <main className="mx-auto max-w-3xl space-y-8 px-4 py-6">
        <div>
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="text-sm text-neutral-500">
            {user?.email} · {s?.timezone} · {s?.currency} · English
          </p>
        </div>

        <section className="space-y-3 rounded-lg border border-neutral-200 p-4">
          <h2 className="font-medium">Telegram bot (&quot;invisible UI&quot;)</h2>
          <p className="text-sm text-neutral-500">
            Text the bot things like &quot;spent 12 on lunch&quot; or &quot;task: call mom tomorrow&quot; and they land here.
          </p>
          <ul className="space-y-1">
            <Check ok={hasToken} label={hasToken ? `Bot token set${botName ? ` (@${botName})` : ""}` : "TELEGRAM_BOT_TOKEN not set in Vercel"} />
            <Check ok={hasSecret} label={hasSecret ? "Database key for the bot set" : "SUPABASE_SECRET_KEY not set in Vercel"} />
            <Check ok={hasAi} label={hasAi ? "Claude understands free text" : "ANTHROPIC_API_KEY not set (simple rules will be used)"} />
            <Check ok={webhookOk} label={webhookOk ? "Bot connected to this app" : "Bot not connected yet"} />
            <Check ok={Boolean(s?.telegram_chat_id)} label={s?.telegram_chat_id ? "Your Telegram chat is linked" : "Your chat is not linked yet"} />
          </ul>
          {hasToken && hasSecret && <ConnectBotButton connected={webhookOk} />}
          {webhookOk && !s?.telegram_chat_id && (
            <div className="space-y-2 rounded-md bg-neutral-50 p-3 text-sm">
              {codeValid ? (
                <p>
                  Send this to {botName ? <a className="underline" href={`https://t.me/${botName}`} target="_blank">@{botName}</a> : "your bot"}:{" "}
                  <code className="rounded bg-white px-2 py-1 font-mono text-base">/link {s!.telegram_link_code}</code>{" "}
                  (valid 15 minutes)
                </p>
              ) : (
                <form action={createLinkCode}>
                  <button className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white">Get a link code</button>
                </form>
              )}
            </div>
          )}
          {s?.telegram_chat_id && (
            <form action={unlinkTelegram}>
              <button className="text-sm text-neutral-500 hover:text-red-600">Unlink Telegram</button>
            </form>
          )}
        </section>

        <section className="space-y-3 rounded-lg border border-neutral-200 p-4">
          <h2 className="font-medium">Weekly insights</h2>
          <p className="text-sm text-neutral-500">
            Every Monday at 8:00 AM the system reviews postponed tasks, stale backlog, habits and budgets, and leaves
            notes on your Today screen.
          </p>
          <form action={generateInsightsNow}>
            <button className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm">Generate now</button>
          </form>
        </section>

        <section className="space-y-3 rounded-lg border border-neutral-200 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-medium">Tags</h2>
            {unusedCount > 0 && (
              <form action={deleteUnusedTags}>
                <button className="rounded-md border border-neutral-300 px-3 py-1 text-sm">
                  Remove {unusedCount} unused
                </button>
              </form>
            )}
          </div>
          <ul className="flex flex-wrap gap-2">
            {tags.map((t) => (
              <li key={t.id} className="flex items-center gap-1 rounded-full bg-neutral-100 py-0.5 pl-3 pr-1 text-sm">
                #{t.name}
                <span className="text-xs text-neutral-400">{t.uses}</span>
                <form action={deleteTag}>
                  <input type="hidden" name="id" value={t.id} />
                  <button aria-label={`Delete tag ${t.name}`} className="rounded-full px-1.5 text-neutral-400 hover:text-red-600">×</button>
                </form>
              </li>
            ))}
            {tags.length === 0 && <li className="text-sm text-neutral-500">No tags yet.</li>}
          </ul>
        </section>

        <section className="space-y-3 rounded-lg border border-neutral-200 p-4">
          <h2 className="font-medium">Your data</h2>
          <div className="flex flex-wrap gap-2">
            <a href="/api/export" className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white">
              Download everything (ZIP)
            </a>
            <Link href="/import" className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm">
              Import notes, calendar or bank CSV
            </Link>
          </div>
          <p className="text-sm text-neutral-500">
            The ZIP has your notes as Markdown files and every table as CSV. No lock-in.
          </p>
        </section>

        <section className="space-y-2 rounded-lg border border-neutral-200 p-4">
          <h2 className="font-medium">Install on your phone</h2>
          <p className="text-sm text-neutral-500">
            Open this site on your phone. Android (Chrome): menu ⋮ → Install app. iPhone (Safari): Share → Add to Home
            Screen. Quick capture works offline and syncs when you are back online.
          </p>
        </section>
      </main>
    </>
  );
}
