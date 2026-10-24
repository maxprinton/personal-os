import { createClient } from "@/lib/supabase/server";
import { createZip, type ZipEntry } from "@/lib/zip";
import { toCsv } from "@/lib/files";

export const dynamic = "force-dynamic";

// The "Escape Hatch": every table as CSV + notes as readable Markdown files, in one ZIP.
const TABLES = [
  "tasks",
  "events",
  "time_blocks",
  "block_types",
  "block_slots",
  "block_occurrences",
  "event_types",
  "habits",
  "habit_checks",
  "activity_logs",
  "metric_definitions",
  "daily_metrics",
  "transactions",
  "categories",
  "accounts",
  "budgets",
  "balance_snapshots",
  "tags",
  "entity_tags",
  "entity_relations",
  "system_insights",
  "bot_messages",
  "user_settings",
];

function slug(s: string) {
  return (
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9 _-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60) || "untitled"
  );
}

async function fetchAll(supabase: Awaited<ReturnType<typeof createClient>>, table: string) {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select("*").range(from, from + 999);
    if (error || !data?.length) break;
    rows.push(...(data as Record<string, unknown>[]));
    if (data.length < 1000) break;
  }
  return rows;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const entries: ZipEntry[] = [];
  for (const table of TABLES) {
    const rows = await fetchAll(supabase, table);
    entries.push({ name: `data/${table}.csv`, content: toCsv(rows) });
  }

  // Notes as Markdown, with tags in front matter
  const notes = (await fetchAll(supabase, "notes")).filter((n) => !n.deleted_at);
  const tags = await fetchAll(supabase, "tags");
  const tagName = new Map(tags.map((t) => [t.id as string, t.name as string]));
  const noteTags = new Map<string, string[]>();
  for (const et of await fetchAll(supabase, "entity_tags")) {
    if (et.entity_type !== "note" || et.deleted_at) continue;
    const list = noteTags.get(et.entity_id as string) ?? [];
    const name = tagName.get(et.tag_id as string);
    if (name) list.push(name);
    noteTags.set(et.entity_id as string, list);
  }
  const used = new Set<string>();
  for (const n of notes) {
    let name = slug(String(n.title ?? ""));
    while (used.has(name)) name = `${name}-${String(n.id).slice(0, 4)}`;
    used.add(name);
    const front = [
      "---",
      `title: ${JSON.stringify(n.title ?? "")}`,
      `created: ${n.created_at}`,
      `updated: ${n.updated_at}`,
      `tags: [${(noteTags.get(n.id as string) ?? []).map((t) => JSON.stringify(t)).join(", ")}]`,
      "---",
      "",
    ].join("\n");
    entries.push({ name: `notes/${name}.md`, content: front + String(n.content ?? "") });
  }
  entries.push({ name: "data/notes.csv", content: toCsv(await fetchAll(supabase, "notes")) });

  const today = new Date().toISOString().slice(0, 10);
  entries.unshift({
    name: "README.txt",
    content: [
      `Personal OS export — ${today}`,
      "",
      "notes/   one Markdown file per note (open with any editor, Obsidian, Notion import…)",
      "data/    every table as CSV (open with Excel / Google Sheets).",
      "Rows with a deleted_at value were deleted in the app (soft delete) and are kept here for completeness.",
    ].join("\r\n"),
  });

  const zip = createZip(entries);
  return new Response(new Blob([zip as BlobPart], { type: "application/zip" }), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="personal-os-export-${today}.zip"`,
      "cache-control": "no-store",
    },
  });
}
