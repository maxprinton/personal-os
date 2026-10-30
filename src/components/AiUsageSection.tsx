// Settings → AI usage, and the small line on Today (server components). Groq has no usage API: the
// numbers are the app's own record (ai_usage, migration 0025); "requests left" comes from Groq itself.
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/agenda";
import { addDays, localNow } from "@/lib/time";
import { DAY_REQUESTS, DAY_TOKENS, featureName, fmtK, refreshFromGroq, startOfDay, usageSummary, type UsageSummary } from "@/lib/ai-usage";

async function load(days: number, ask = false) {
  const sb = await createClient();
  const { timezone } = await getSettings(sb);
  const today = localNow(timezone).date;
  if (ask) {
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (user) await refreshFromGroq(sb, user.id, timezone).catch(() => false);
  }
  const sum = await usageSummary(sb, { from: startOfDay(addDays(today, -(days - 1)), timezone), tz: timezone }).catch(() => null);
  return { sum, today };
}

function todayModels(sum: UsageSummary, today: string) {
  const m = new Map<string, { calls: number; tokens: number }>();
  for (const r of sum.rows.filter((x) => x.day === today)) {
    const cur = m.get(r.model) ?? { calls: 0, tokens: 0 };
    cur.calls += r.calls;
    cur.tokens += r.tokens;
    m.set(r.model, cur);
  }
  return [...m].sort((a, b) => b[1].tokens - a[1].tokens);
}

/** One line for Today: "✨ AI today: 23.4K tokens · 41 requests · 959 requests left". */
export async function AiUsageLine() {
  const { sum, today } = await load(1);
  if (!sum) return null;
  const models = todayModels(sum, today);
  if (!models.length) return null;
  const tokens = models.reduce((s, [, v]) => s + v.tokens, 0);
  const calls = models.reduce((s, [, v]) => s + v.calls, 0);
  const main = models[0][0];
  const latest = sum.latest.find((l) => l.model === main);
  const pct = Math.round(Math.max(models[0][1].tokens / DAY_TOKENS, latest?.remaining_requests != null ? 1 - latest.remaining_requests / (latest.limit_requests ?? DAY_REQUESTS) : 0) * 100);
  return (
    <a href="/settings#ai-usage" className="block text-xs text-muted hover:text-fg">
      ✨ AI today: {fmtK(tokens)} tokens · {calls} {calls === 1 ? "request" : "requests"}
      {latest?.remaining_requests != null ? ` · ${latest.remaining_requests.toLocaleString("en-US")} requests left` : ""} · {pct}% of today&apos;s limit
    </a>
  );
}

/** Settings → AI usage: today by model and feature, and the last 7 days. */
export default async function AiUsageSection() {
  const { sum, today } = await load(7, true);
  if (!sum) return <p className="text-sm text-muted">Run MIGRACION-0025-uso-de-ia.sql in Supabase to see your AI usage.</p>;
  const models = todayModels(sum, today);
  const features = new Map<string, { calls: number; tokens: number }>();
  for (const r of sum.rows.filter((x) => x.day === today)) {
    const cur = features.get(r.feature) ?? { calls: 0, tokens: 0 };
    cur.calls += r.calls;
    cur.tokens += r.tokens;
    features.set(r.feature, cur);
  }
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, -i));
  const perDay = days.map((d) => {
    const rows = sum.rows.filter((r) => r.day === d);
    return { d, calls: rows.reduce((s, r) => s + r.calls, 0), tokens: rows.reduce((s, r) => s + r.tokens, 0) };
  });
  const bar = (v: number, max: number) => (
    <span className="inline-block h-1.5 w-24 overflow-hidden rounded-full bg-subtle align-middle">
      <span className="block h-full bg-accent" style={{ width: `${Math.min(100, Math.round((v / max) * 100))}%` }} />
    </span>
  );
  return (
    <div className="space-y-4 text-sm">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">Today, by model (each has its own daily limit)</p>
        {!models.length && <p className="text-muted">Nothing used yet today.</p>}
        {models.map(([model, v]) => {
          const latest = sum.latest.find((l) => l.model === model);
          const left = latest?.remaining_requests;
          const limit = latest?.limit_requests ?? DAY_REQUESTS;
          const whisper = model.startsWith("whisper");
          return (
            <div key={model} className="rounded-md border border-line p-2">
              <p className="font-medium">{model}</p>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                <span>
                  {v.calls} requests{left != null ? ` · ${left.toLocaleString("en-US")} of ${limit.toLocaleString("en-US")} left` : ""}
                </span>
                {left != null && bar(limit - left, limit)}
                {!whisper && (
                  <>
                    <span>
                      {fmtK(v.tokens)} of {fmtK(DAY_TOKENS)} tokens ({Math.round((v.tokens / DAY_TOKENS) * 100)}%)
                    </span>
                    {bar(v.tokens, DAY_TOKENS)}
                  </>
                )}
              </p>
            </div>
          );
        })}
      </div>
      {features.size > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Today, by feature</p>
          <ul className="space-y-0.5">
            {[...features].sort((a, b) => b[1].tokens - a[1].tokens).map(([f, v]) => (
              <li key={f} className="flex justify-between gap-2">
                <span>{featureName(f)}</span>
                <span className="text-muted">
                  {v.calls} · {fmtK(v.tokens)} tokens
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Last 7 days</p>
        <table className="w-full text-left text-xs">
          <thead className="text-muted">
            <tr>
              <th className="py-1 font-medium">Day</th>
              <th className="py-1 font-medium">Requests</th>
              <th className="py-1 font-medium">Tokens</th>
            </tr>
          </thead>
          <tbody>
            {perDay.map((r) => (
              <tr key={r.d} className="border-t border-line">
                <td className="py-1">{r.d === today ? "Today" : r.d}</td>
                <td className="py-1">{r.calls}</td>
                <td className="py-1">{r.tokens.toLocaleString("en-US")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sum.since && sum.since.slice(0, 10) >= today && (
        <p className="text-xs text-muted">
          Tokens are counted since {new Date(sum.since).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} today, when counting started: what you used before isn&apos;t in them.
        </p>
      )}
      <p className="text-xs text-faint">Requests left come straight from Groq (exact, they include everything, also what you used before counting started). Tokens used are counted by Personal OS: Groq doesn&apos;t report its daily token count.</p>
    </div>
  );
}
