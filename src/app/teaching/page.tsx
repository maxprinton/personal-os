import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/agenda";
import { currentUserId } from "@/lib/calendar/model";
import { localNow } from "@/lib/time";
import Section from "@/components/ui/Section";
import { BulkClasses, PendingVideos } from "@/components/WorkBulk";
import { ExportPanel, NewClassForm, SettingsForm } from "@/components/WorkForms";
import WorkImport from "@/components/WorkImport";
import WorkTable from "@/components/WorkTable";
import WorkGroups, { type GroupRow, type TeacherRow } from "@/components/WorkGroups";
import {
  byTime, classEnded, groupKey, isOrigin, scheduleMap, teacherMap, missingEvidence, DETAIL_HEADERS, detailRows, fmtHours, fmtMoney, isMonthKey, monthBounds, monthKey, monthLabelEn, monthLabelEs,
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

export default async function TeachingPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return null;
  const { timezone } = await getSettings(supabase);
  const now = localNow(timezone);
  const sp = await searchParams;
  const month = sp.month && isMonthKey(sp.month) ? sp.month : monthKey(now.date);
  const { from, to } = monthBounds(month);

  const [settingsRes, monthRes, pendingRes, histRes, savedRes] = await Promise.all([
    supabase.from("work_settings").select("*").maybeSingle(),
    supabase.from("work_classes").select("*").gte("class_date", from).lte("class_date", to).order("class_date").order("start_time"),
    supabase.from("work_classes").select("*").eq("video_posted", false).lte("class_date", now.date).order("class_date", { ascending: false }).limit(200),
    supabase.from("work_classes").select("class_date,group_name,requested_by,start_time,end_time").order("class_date", { ascending: false }).limit(3000),
    supabase.from("work_groups").select("code,code_key,teacher,effective_from"),
  ]);

  const settings = settingsRes.data as { teacher_name: string | null; substitute_rate: number; head_rate: number; video_folder_url: string | null } | null;
  const tableMissing = monthRes.error?.code === "42P01" || monthRes.error?.message?.includes("work_classes");
  const classes = ((monthRes.data ?? []) as Record<string, unknown>[]).map(toWorkClass).sort(byTime);
  const toPost = ((pendingRes.data ?? []) as Record<string, unknown>[]).map(toWorkClass).filter((c) => c.status === "taught" && classEnded(c, now));
  const hist = (histRes.data ?? []) as { class_date: string; group_name: string; requested_by: string | null; start_time: string; end_time: string }[];
  const saved = (savedRes.error ? [] : savedRes.data ?? []) as { code: string; code_key: string; teacher: string; effective_from: string | null }[];
  const map = teacherMap(hist, saved);

  // Class codes (newest first, "KIDS-7" and "Kids-7" count as one) and the teachers they belong to.
  const codes = new Map<string, { code: string; classes: number }>();
  for (const r of hist) {
    const k = groupKey(r.group_name);
    if (!k) continue;
    const e = codes.get(k);
    if (e) e.classes++;
    else codes.set(k, { code: r.group_name.trim(), classes: 1 });
  }
  for (const s of saved) if (!codes.has(s.code_key)) codes.set(s.code_key, { code: s.code, classes: 0 });
  const savedKeys = new Set(saved.map((s) => s.code_key));
  const groupRows: GroupRow[] = [...codes.entries()]
    .map(([k, v]) => ({ code: v.code, classes: v.classes, teacher: map[k] ?? "", saved: savedKeys.has(k) }))
    .sort((a, z) => a.code.localeCompare(z.code, undefined, { numeric: true }));
  const teacherCount = new Map<string, number>();
  for (const r of hist) {
    const who = (r.requested_by ?? "").trim();
    if (who && !isOrigin(who)) teacherCount.set(who, (teacherCount.get(who) ?? 0) + 1);
  }
  for (const t of Object.values(map)) if (!isOrigin(t) && !teacherCount.has(t)) teacherCount.set(t, 0);
  const teacherRows: TeacherRow[] = [...teacherCount.entries()]
    .map(([name, classesN]) => ({ name, classes: classesN, groups: Object.values(map).filter((t) => t === name).length }))
    .sort((a, z) => z.classes - a.classes || a.name.localeCompare(z.name));
  const suggestions = {
    groups: [...codes.values()].map((c) => c.code).slice(0, 60),
    people: teacherRows.map((t) => t.name).slice(0, 60),
    groupTeachers: map,
    groupSchedules: scheduleMap(hist),
    teacher: settings?.teacher_name ?? "",
  };

  // Months for the Excel picker: every month that has classes, plus the one on screen and the current one.
  const monthKeys = [...new Set([month, monthKey(now.date), ...hist.map((r) => monthKey(r.class_date))])].sort().reverse();
  const months = monthKeys.map((k) => ({ key: k, label: monthLabelEn(k) }));

  const sum = summarize(classes, now);
  const folder = settings?.video_folder_url ?? "";
  const teacher = settings?.teacher_name ?? "";
  const subRate = Number(settings?.substitute_rate ?? 6);
  const headRate = Number(settings?.head_rate ?? 4);
  const isCurrent = month === monthKey(now.date);

  if (tableMissing) {
    return (
      <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 sm:px-6 lg:py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Teaching</h1>
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
            <h1 className="text-2xl font-semibold tracking-tight">Teaching</h1>
            <p className="text-sm text-muted">Your classes, hours and pay, plus the videos you owe the company’s Drive.</p>
          </div>
          <div className="flex items-center gap-1 text-sm">
            <Link href={`/teaching?month=${shiftMonth(month, -1)}`} className="rounded-md border border-line-strong px-2.5 py-1 hover:bg-subtle" aria-label="Previous month">
              ←
            </Link>
            <span className="min-w-36 px-2 text-center font-medium">{monthLabelEn(month)}</span>
            <Link href={`/teaching?month=${shiftMonth(month, 1)}`} className="rounded-md border border-line-strong px-2.5 py-1 hover:bg-subtle" aria-label="Next month">
              →
            </Link>
            {!isCurrent && (
              <Link href="/teaching" className="ml-1 rounded-md px-2 py-1 text-xs text-muted underline">
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
        <Section title="Videos still to post" count={toPost.length} tone="warning">
          <PendingVideos classes={toPost} folder={folder} />
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
          <BulkClasses items={[...classes].reverse().map((c) => ({ c, ended: classEnded(c, now) }))} suggestions={suggestions} />
        )}
      </Section>

      <Section title="Teacher and video for each class">
        <WorkTable classes={classes} map={map} people={suggestions.people} />
      </Section>

      <Section title="Excel for the company">
        <ExportPanel
          month={month}
          months={months}
          monthLabel={monthLabelEn(month)}
          classes={classes}
          map={map}
          detailHeaders={DETAIL_HEADERS}
          summaryHeaders={SUMMARY_HEADERS}
          teacher={teacher}
          monthEs={monthLabelEs(month)}
        />
      </Section>

      <Section title="Class codes and teachers">
        <WorkGroups groups={groupRows} teachers={teacherRows} people={suggestions.people} />
      </Section>

      <Section title="Settings">
        <SettingsForm teacher={teacher} subRate={subRate} headRate={headRate} folder={folder} />
      </Section>
    </main>
  );
}
