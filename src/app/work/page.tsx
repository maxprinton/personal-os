import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/agenda";
import { currentUserId } from "@/lib/calendar/model";
import { localNow } from "@/lib/time";
import Section from "@/components/ui/Section";
import WorkRow from "@/components/WorkRow";
import { ExportPanel, NewClassForm, SettingsForm } from "@/components/WorkForms";
import WorkImport from "@/components/WorkImport";
import {
  byTime, classEnded, missingEvidence, DETAIL_HEADERS, detailRows, fmtHours, fmtMoney, isMonthKey, monthBounds, monthKey, monthLabelEn, monthLabelEs,
  shiftMonth, shortDay, SUMMARY_HEADERS, summarize, toWorkClass,
} from "@/lib/work-log";

export const dynamic = "force-dynamic";

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3 shadow-card">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-faint">{sub}</p>}
    </div>
  );
}

export default async function WorkPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return null;
  const { timezone } = await getSettings(supabase);
  const now = localNow(timezone);
  const sp = await searchParams;
  const month = sp.month && isMonthKey(sp.month) ? sp.month : monthKey(now.date);
  const { from, to } = monthBounds(month);

  const [settingsRes, monthRes, pendingRes, recentRes] = await Promise.all([
    supabase.from("work_settings").select("*").maybeSingle(),
    supabase.from("work_classes").select("*").gte("class_date", from).lte("class_date", to).order("class_date").order("start_time"),
    supabase.from("work_classes").select("*").eq("video_posted", false).lte("class_date", now.date).order("class_date", { ascending: false }).limit(200),
    supabase.from("work_classes").select("group_name,requested_by").order("class_date", { ascending: false }).limit(300),
  ]);

  const settings = settingsRes.data as { teacher_name: string | null; substitute_rate: number; head_rate: number; video_folder_url: string | null } | null;
  const tableMissing = monthRes.error?.code === "42P01" || monthRes.error?.message?.includes("work_classes");
  const classes = ((monthRes.data ?? []) as Record<string, unknown>[]).map(toWorkClass).sort(byTime);
  const toPost = ((pendingRes.data ?? []) as Record<string, unknown>[]).map(toWorkClass).filter((c) => c.status === "taught" && classEnded(c, now));
  const recent = (recentRes.data ?? []) as { group_name: string; requested_by: string | null }[];
  const suggestions = {
    groups: [...new Set(recent.map((r) => r.group_name).filter(Boolean))].slice(0, 40),
    people: [...new Set(["Propia", "Academia", ...recent.map((r) => r.requested_by ?? "").filter(Boolean)])].slice(0, 40),
  };

  const sum = summarize(classes, now);
  const folder = settings?.video_folder_url ?? "";
  const teacher = settings?.teacher_name ?? "";
  const subRate = Number(settings?.substitute_rate ?? 6);
  const headRate = Number(settings?.head_rate ?? 4);
  const isCurrent = month === monthKey(now.date);

  if (tableMissing) {
    return (
      <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 sm:px-6 lg:py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Work</h1>
        <p className="rounded-lg border border-warning p-4 text-sm">
          The work log tables don’t exist yet. Open Supabase → SQL Editor, paste the contents of <b>MIGRACION-0027-registro-de-horas.sql</b> and run it,
          then reload this page.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl space-y-8 px-4 py-6 sm:px-6 lg:py-8">
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Work</h1>
            <p className="text-sm text-muted">Your classes, hours and pay, plus the videos you owe the company’s Drive.</p>
          </div>
          <div className="flex items-center gap-1 text-sm">
            <Link href={`/work?month=${shiftMonth(month, -1)}`} className="rounded-md border border-line-strong px-2.5 py-1 hover:bg-subtle" aria-label="Previous month">
              ←
            </Link>
            <span className="min-w-36 px-2 text-center font-medium">{monthLabelEn(month)}</span>
            <Link href={`/work?month=${shiftMonth(month, 1)}`} className="rounded-md border border-line-strong px-2.5 py-1 hover:bg-subtle" aria-label="Next month">
              →
            </Link>
            {!isCurrent && (
              <Link href="/work" className="ml-1 rounded-md px-2 py-1 text-xs text-muted underline">
                This month
              </Link>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Hours" value={fmtHours(sum.hours)} sub={`${sum.classes} ${sum.classes === 1 ? "class" : "classes"}${sum.cancelled ? ` · ${sum.cancelled} cancelled` : ""}`} />
          <Stat label="Earned" value={fmtMoney(sum.amount)} sub={monthLabelEs(month)} />
          <Stat label="Videos to post" value={String(sum.videosPending)} sub="this month" />
          <Stat label="Not posted (all months)" value={String(toPost.length)} />
        </div>
      </section>

      {toPost.length > 0 && (
        <Section
          title="Videos still to post"
          count={toPost.length}
          tone="warning"
          action={
            folder ? (
              <a href={folder} target="_blank" rel="noreferrer" className="text-xs font-medium text-accent underline">
                Open the Drive folder ↗
              </a>
            ) : undefined
          }
        >
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface text-sm shadow-card">
            {toPost.slice(0, 12).map((c) => (
              <li key={c.id}>
                <Link href={`/work?month=${monthKey(c.class_date)}`} className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-subtle">
                  <span className="font-medium">{c.group_name}</span>
                  <span className="text-muted">{shortDay(c.class_date)}</span>
                </Link>
              </li>
            ))}
            {toPost.length > 12 && <li className="px-3 py-2 text-xs text-faint">+ {toPost.length - 12} more (older months)</li>}
          </ul>
        </Section>
      )}

      <Section title="Add a class">
        <NewClassForm today={isCurrent ? now.date : from} suggestions={suggestions} />
      </Section>

      <WorkImport today={now.date} />

      <Section title="Classes" count={classes.length}>
        {classes.length === 0 ? (
          <p className="text-sm text-muted">No classes in {monthLabelEn(month)} yet.</p>
        ) : (
          <ul className="space-y-3">
            {[...classes].reverse().map((c) => (
              <WorkRow key={c.id} c={c} ended={classEnded(c, now)} suggestions={suggestions} />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Excel for the company">
        <ExportPanel
          month={month}
          monthLabel={monthLabelEn(month)}
          detail={detailRows(classes)}
          detailHeaders={DETAIL_HEADERS}
          summaryHeaders={SUMMARY_HEADERS}
          teacher={teacher}
          monthEs={monthLabelEs(month)}
          recoveryHours={fmtHours(sum.recoveryHours)}
          extraHours={fmtHours(sum.extraHours)}
          collaborationCount={sum.collaborationCount}
          blocked={missingEvidence(classes).map((c) => ({ id: c.id, label: `${c.group_name} · ${shortDay(c.class_date)}`, hours: fmtHours(c.hours) }))}
        />
      </Section>

      <Section title="Settings">
        <SettingsForm teacher={teacher} subRate={subRate} headRate={headRate} folder={folder} />
      </Section>
    </main>
  );
}
