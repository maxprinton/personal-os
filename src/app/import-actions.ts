"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/agenda";
import { parseBankCsv, parseIcs, type DateOrder } from "@/lib/files";
import { guessCategory } from "@/lib/parse";
import { zonedToUtc } from "@/lib/time";

export type ImportState = { error?: string; message?: string; at?: number };

const MAX_BYTES = 4 * 1024 * 1024;

function files(form: FormData, field: string) {
  return form.getAll(field).filter((f): f is File => f instanceof File && f.size > 0);
}

async function insertChunks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: string,
  rows: Record<string, unknown>[]
) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from(table).insert(rows.slice(i, i + 500));
    if (error) return error.message;
  }
  return null;
}

export async function importBankCsv(_prev: ImportState, form: FormData): Promise<ImportState> {
  const [file] = files(form, "file");
  if (!file) return { error: "Choose a CSV file." };
  if (file.size > MAX_BYTES) return { error: "File is larger than 4 MB." };
  const orderRaw = String(form.get("date_order") ?? "ymd");
  const order: DateOrder = orderRaw === "mdy" || orderRaw === "dmy" ? orderRaw : "ymd";
  const accountId = String(form.get("account_id") ?? "") || null;

  const { rows, skipped, error } = parseBankCsv(await file.text(), order);
  if (error) return { error };
  if (!rows.length) return { error: "No valid rows found. Check the date format option." };

  const supabase = await createClient();
  const { timezone } = await getSettings(supabase);
  const { data: cats } = await supabase.from("categories").select("id,name,kind").is("deleted_at", null);
  const categories = (cats ?? []) as { id: string; name: string; kind: string }[];

  const records = rows.map((r) => {
    const type = r.amount < 0 ? "expense" : "income";
    const guess = guessCategory(r.description, categories.filter((c) => c.kind === type).map((c) => c.name));
    return {
      type,
      amount: Math.abs(r.amount),
      description: r.description || null,
      occurred_at: zonedToUtc(r.date, "12:00", timezone).toISOString(),
      account_id: accountId,
      category_id: guess ? categories.find((c) => c.kind === type && c.name === guess)?.id ?? null : null,
      source: "import",
    };
  });
  const err = await insertChunks(supabase, "transactions", records);
  if (err) return { error: err };
  revalidatePath("/finance");
  revalidatePath("/");
  return { message: `Imported ${records.length} transactions${skipped ? ` (${skipped} rows skipped)` : ""}.`, at: Date.now() };
}

export async function importCalendar(_prev: ImportState, form: FormData): Promise<ImportState> {
  const list = files(form, "file");
  if (!list.length) return { error: "Choose an .ics file." };
  const includeAllDay = form.get("all_day") === "on";

  const supabase = await createClient();
  const { timezone } = await getSettings(supabase);
  const { data: existing } = await supabase.from("events").select("title,start_time").eq("source", "import").is("deleted_at", null);
  const seen = new Set(((existing ?? []) as { title: string; start_time: string }[]).map((e) => `${e.title}|${new Date(e.start_time).toISOString()}`));

  const records: Record<string, unknown>[] = [];
  let skipped = 0;
  let recurring = 0;
  for (const f of list) {
    if (f.size > MAX_BYTES) return { error: `${f.name} is larger than 4 MB.` };
    for (const ev of parseIcs(await f.text())) {
      if (ev.recurring) recurring++;
      let start: Date;
      let end: Date;
      if (!ev.start.time) {
        if (!includeAllDay) { skipped++; continue; }
        start = zonedToUtc(ev.start.date, "00:00", timezone);
        end = zonedToUtc(ev.start.date, "23:59", timezone);
      } else {
        const toDate = (p: NonNullable<typeof ev.end>) =>
          p.utc ? new Date(`${p.date}T${p.time}:00Z`) : zonedToUtc(p.date, p.time ?? "00:00", p.tzid ?? timezone);
        start = toDate(ev.start);
        end = ev.end?.time ? toDate(ev.end) : new Date(start.getTime() + 3600 * 1000);
      }
      if (!(end > start) || Number.isNaN(start.getTime())) { skipped++; continue; }
      const key = `${ev.title}|${start.toISOString()}`;
      if (seen.has(key)) { skipped++; continue; }
      seen.add(key);
      records.push({ title: ev.title.slice(0, 300), start_time: start.toISOString(), end_time: end.toISOString(), source: "import" });
    }
  }
  if (!records.length) return { error: `Nothing new to import${skipped ? ` (${skipped} skipped)` : ""}.` };
  const err = await insertChunks(supabase, "events", records);
  if (err) return { error: err };
  revalidatePath("/events");
  revalidatePath("/");
  return {
    message: `Imported ${records.length} events${skipped ? `, ${skipped} skipped (all-day, duplicates or invalid)` : ""}${
      recurring ? `. ${recurring} repeating events were imported once — recreate them as time blocks.` : "."
    }`,
    at: Date.now(),
  };
}

export async function importNotes(_prev: ImportState, form: FormData): Promise<ImportState> {
  const list = files(form, "files");
  if (!list.length) return { error: "Choose one or more .md or .txt files." };
  const records: Record<string, unknown>[] = [];
  for (const f of list) {
    if (f.size > MAX_BYTES) return { error: `${f.name} is larger than 4 MB.` };
    let content = (await f.text()).replace(/^﻿/, "");
    let title = f.name.replace(/\.(md|markdown|txt)$/i, "");
    const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
    if (fm) {
      const t = /^title:\s*"?(.*?)"?\s*$/m.exec(fm[1]);
      if (t?.[1]) title = t[1];
      content = content.slice(fm[0].length);
    }
    records.push({ title: title.slice(0, 200), content, source: "import" });
  }
  const supabase = await createClient();
  const err = await insertChunks(supabase, "notes", records);
  if (err) return { error: err };
  revalidatePath("/notes");
  return { message: `Imported ${records.length} notes.`, at: Date.now() };
}
