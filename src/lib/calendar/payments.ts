// Payments as events (server only). Every query filters by user_id explicitly.
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays } from "@/lib/time";
import { repeatDates, type RepeatUnit } from "@/lib/calendar/recurrence";
import type { FinanceOptions, PaymentTemplate } from "@/lib/calendar/types";

export const TEMPLATE_COLS =
  "id,name,type,expected_amount,account_id,category_id,repeat_unit,repeat_every,start_date,end_date";

const PAYMENTS_TYPE = { name: "Payments", color: "#16a34a" };
/** How far ahead recurring payments create their events. */
const AHEAD_DAYS = 62;

export async function getPaymentTemplates(sb: SupabaseClient, userId: string): Promise<PaymentTemplate[]> {
  const { data } = await sb
    .from("payment_templates")
    .select(TEMPLATE_COLS)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("name");
  return ((data ?? []) as PaymentTemplate[]).map((t) => ({
    ...t,
    expected_amount: t.expected_amount === null ? null : Number(t.expected_amount),
  }));
}

export async function getFinanceOptions(sb: SupabaseClient, userId: string): Promise<FinanceOptions> {
  const [templates, acc, cat] = await Promise.all([
    getPaymentTemplates(sb, userId),
    sb.from("accounts").select("id,name").eq("user_id", userId).is("deleted_at", null).order("created_at"),
    sb.from("categories").select("id,name,kind").eq("user_id", userId).is("deleted_at", null).order("name"),
  ]);
  return {
    templates,
    accounts: (acc.data ?? []) as FinanceOptions["accounts"],
    categories: (cat.data ?? []) as FinanceOptions["categories"],
  };
}

/** The "Payments" event type (green), created the first time it's needed. */
async function paymentsEventType(sb: SupabaseClient, userId: string) {
  const { data } = await sb
    .from("event_types")
    .select("id,name")
    .eq("user_id", userId)
    .is("deleted_at", null);
  const found = ((data ?? []) as { id: string; name: string }[]).find((t) => t.name.toLowerCase() === "payments");
  if (found) return found.id;
  const { data: created } = await sb
    .from("event_types")
    .insert({ user_id: userId, ...PAYMENTS_TYPE })
    .select("id")
    .single();
  return (created?.id as string | undefined) ?? null;
}

/**
 * Creates the missing events of every payment template from `from` up to ~2 months ahead.
 * Recurring payments generate their own events this way (run daily and after edits).
 */
export async function ensurePaymentEvents(sb: SupabaseClient, userId: string, today: string, onlyTemplateId?: string, from?: string) {
  const templates = (await getPaymentTemplates(sb, userId)).filter((t) => !onlyTemplateId || t.id === onlyTemplateId);
  if (!templates.length) return 0;
  const until = addDays(today, AHEAD_DAYS);
  const start = from ?? today;
  const { data: existing } = await sb
    .from("events")
    .select("payment_template_id,event_date")
    .eq("user_id", userId)
    .in("payment_template_id", templates.map((t) => t.id))
    .gte("event_date", start)
    .lte("event_date", until);
  const have = new Set(((existing ?? []) as { payment_template_id: string; event_date: string }[]).map((e) => `${e.payment_template_id}|${e.event_date}`));
  const typeId = await paymentsEventType(sb, userId);
  const rows: Record<string, unknown>[] = [];
  for (const t of templates) {
    for (const d of repeatDates(t.start_date, t.repeat_unit as RepeatUnit, t.repeat_every, start, until, t.end_date)) {
      if (have.has(`${t.id}|${d}`)) continue;
      rows.push({
        user_id: userId,
        title: t.name,
        event_date: d,
        end_date: d,
        start_time: null,
        end_time: null,
        is_payment: true,
        payment_template_id: t.id,
        event_type_id: typeId,
      });
    }
  }
  // One by one: a duplicate (another run got there first) just fails on the unique index
  for (const r of rows) await sb.from("events").insert(r);
  return rows.length;
}

export type DuePayment = {
  eventId: string;
  date: string;
  title: string;
  template: PaymentTemplate | null;
};

/** Payment events from the last month up to today that are not paid or skipped yet. */
export async function getDuePayments(sb: SupabaseClient, userId: string, today: string): Promise<DuePayment[]> {
  const [{ data }, templates] = await Promise.all([
    sb
      .from("events")
      .select("id,title,event_date,payment_template_id")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .eq("is_payment", true)
      .is("payment_status", null)
      .gte("event_date", addDays(today, -31))
      .lte("event_date", today)
      .order("event_date"),
    getPaymentTemplates(sb, userId),
  ]);
  const byId = new Map(templates.map((t) => [t.id, t]));
  return ((data ?? []) as { id: string; title: string; event_date: string; payment_template_id: string | null }[]).map((e) => ({
    eventId: e.id,
    date: e.event_date,
    title: e.title,
    template: e.payment_template_id ? byId.get(e.payment_template_id) ?? null : null,
  }));
}
