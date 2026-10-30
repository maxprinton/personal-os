import Link from "next/link";
import ThemeToggle from "@/components/ui/ThemeToggle";
import { createClient } from "@/lib/supabase/server";
import { botToken, tg } from "@/lib/telegram";
import { createLinkCode, deleteTag, deleteUnusedTags, generateInsightsNow, unlinkTelegram } from "@/app/settings-actions";
import { liveTagLinks } from "@/lib/tags";
import ConnectBotButton from "@/components/ConnectBotButton";
import ReminderSettings from "@/components/ReminderSettings";
import WritingSettings from "@/components/WritingSettings";
import AiUsageSection from "@/components/AiUsageSection";

export const dynamic = "force-dynamic";

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? "bg-success-solid" : "bg-subtle-2"}`} />
      <span className={ok ? "" : "text-muted"}>{label}</span>
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
    .select("timezone,currency,locale,telegram_chat_id,telegram_link_code,telegram_link_expires,reminder_morning_enabled,reminder_morning_time,reminder_evening_enabled,reminder_evening_time,reminder_before_minutes,reminder_insights,reminder_unassigned_nag")
    .maybeSingle();
  // "When a block ends" (migration 0019): ON until it exists
  const blockEnd = await supabase.from("user_settings").select("reminder_block_end").maybeSingle();
  const blockEndOn = blockEnd.error ? null : (blockEnd.data?.reminder_block_end as boolean | null | undefined) ?? true;

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
      <main className="mx-auto w-full max-w-3xl space-y-8 px-4 py-6 sm:px-6 lg:py-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted">
            {user?.email} · {s?.timezone} · {s?.currency} · English
          </p>
        </div>

        <section className="card flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <h2 className="font-medium">Appearance</h2>
            <p className="text-sm text-muted">Auto follows your device&apos;s light or dark setting.</p>
          </div>
          <ThemeToggle />
        </section>

        <section className="space-y-3 rounded-lg border border-line p-4 bg-surface shadow-card">
          <h2 className="font-medium">Telegram bot (&quot;invisible UI&quot;)</h2>
          <p className="text-sm text-muted">
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
            <div className="space-y-2 rounded-md bg-subtle p-3 text-sm">
              {codeValid ? (
                <p>
                  Send this to {botName ? <a className="underline" href={`https://t.me/${botName}`} target="_blank">@{botName}</a> : "your bot"}:{" "}
                  <code className="rounded bg-surface px-2 py-1 font-mono text-base">/link {s!.telegram_link_code}</code>{" "}
                  (valid 15 minutes)
                </p>
              ) : (
                <form action={createLinkCode}>
                  <button className="rounded-md bg-accent font-medium shadow-sm transition-colors hover:bg-accent-hover px-3 py-1.5 text-sm text-accent-fg">Get a link code</button>
                </form>
              )}
            </div>
          )}
          {s?.telegram_chat_id && (
            <form action={unlinkTelegram}>
              <button className="text-sm text-muted hover:text-danger">Unlink Telegram</button>
            </form>
          )}
        </section>

        {s?.telegram_chat_id && (
          <ReminderSettings
            values={{
              morningOn: s.reminder_morning_enabled ?? true,
              morningTime: String(s.reminder_morning_time ?? "07:00").slice(0, 5),
              eveningOn: s.reminder_evening_enabled ?? true,
              eveningTime: String(s.reminder_evening_time ?? "21:00").slice(0, 5),
              before: s.reminder_before_minutes ?? 10,
              insightsOn: s.reminder_insights ?? true,
              unassignedOn: s.reminder_unassigned_nag ?? true,
              blockEndOn,
            }}
          />
        )}

        <section className="space-y-3 rounded-lg border border-line p-4 bg-surface shadow-card">
          <div>
            <h2 className="font-medium">Writing</h2>
            <p className="text-sm text-muted">Spelling in Spanish and English, next-word prediction and the AI that checks what the rules can&apos;t.</p>
          </div>
          <WritingSettings />
        </section>

        <section id="ai-usage" className="space-y-3 rounded-lg border border-line p-4 bg-surface shadow-card">
          <div>
            <h2 className="font-medium">AI usage</h2>
            <p className="text-sm text-muted">Groq&apos;s free plan: about 1,000 requests and 200,000 tokens a day per model. Also in Telegram: /usage.</p>
          </div>
          <AiUsageSection />
        </section>

        <section className="space-y-3 rounded-lg border border-line p-4 bg-surface shadow-card">
          <h2 className="font-medium">Weekly insights</h2>
          <p className="text-sm text-muted">
            Every Monday at 8:00 AM the system reviews postponed tasks, stale backlog, habits and budgets, and leaves
            notes on your Today screen.
          </p>
          <form action={generateInsightsNow}>
            <button className="rounded-md border border-edge transition-colors hover:bg-subtle px-3 py-1.5 text-sm">Generate now</button>
          </form>
        </section>

        <section className="space-y-3 rounded-lg border border-line p-4 bg-surface shadow-card">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-medium">Tags</h2>
            {unusedCount > 0 && (
              <form action={deleteUnusedTags}>
                <button className="rounded-md border border-edge transition-colors hover:bg-subtle px-3 py-1 text-sm">
                  Remove {unusedCount} unused
                </button>
              </form>
            )}
          </div>
          <ul className="flex flex-wrap gap-2">
            {tags.map((t) => (
              <li key={t.id} className="flex items-center gap-1 rounded-full bg-subtle py-0.5 pl-3 pr-1 text-sm">
                #{t.name}
                <span className="text-xs text-faint">{t.uses}</span>
                <form action={deleteTag}>
                  <input type="hidden" name="id" value={t.id} />
                  <button aria-label={`Delete tag ${t.name}`} className="rounded-full px-1.5 text-faint hover:text-danger">×</button>
                </form>
              </li>
            ))}
            {tags.length === 0 && <li className="text-sm text-muted">No tags yet.</li>}
          </ul>
        </section>

        <section className="space-y-3 rounded-lg border border-line p-4 bg-surface shadow-card">
          <h2 className="font-medium">Your data</h2>
          <div className="flex flex-wrap gap-2">
            <a href="/api/export" className="rounded-md bg-accent font-medium shadow-sm transition-colors hover:bg-accent-hover px-3 py-1.5 text-sm text-accent-fg">
              Download everything (ZIP)
            </a>
            <Link href="/import" className="rounded-md border border-edge transition-colors hover:bg-subtle px-3 py-1.5 text-sm">
              Import notes, calendar or bank CSV
            </Link>
          </div>
          <p className="text-sm text-muted">
            The ZIP has your notes as Markdown files and every table as CSV. No lock-in.
          </p>
        </section>

        <section className="space-y-2 rounded-lg border border-line p-4 bg-surface shadow-card">
          <h2 className="font-medium">Install on your phone</h2>
          <p className="text-sm text-muted">
            Open this site on your phone. Android (Chrome): menu ⋮ → Install app. iPhone (Safari): Share → Add to Home
            Screen. Quick capture works offline and syncs when you are back online.
          </p>
        </section>
      </main>
    </>
  );
}
