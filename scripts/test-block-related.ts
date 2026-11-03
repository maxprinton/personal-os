// Tests of the "Related notes" of a block (getBlockLinkedNotes in src/lib/block-notes.ts) with a fake database.
// Run: node --no-warnings --experimental-transform-types --import ./scripts/alias-loader.mjs scripts/test-block-related.ts
import assert from "node:assert/strict";
import { getBlockLinkedNotes } from "@/lib/block-notes";

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n  ${e instanceof Error ? e.message.split("\n").join("\n  ") : e}`);
  }
}

type Row = Record<string, unknown>;
/** A tiny stand-in for the Supabase client: eq / is / in / not filters over in-memory tables. */
function fake(tables: Record<string, Row[]>, fail = false) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => ((rows = rows.filter((r) => r[k] === v)), q),
        is: (k: string, v: unknown) => ((rows = rows.filter((r) => (r[k] ?? null) === v)), q),
        in: (k: string, v: unknown[]) => ((rows = rows.filter((r) => v.includes(r[k]))), q),
        then: (ok: (v: unknown) => unknown) => ok(fail ? { data: null, error: { message: "boom" } } : { data: rows, error: null }),
      };
      return q;
    },
  } as never;
}

const U = "u1";
const rel = (source: string, target: string, over: Row = {}): Row => ({ user_id: U, source_type: "note", source_id: source, target_type: "block_type", target_id: target, deleted_at: null, ...over });
const note = (id: string, title: string, over: Row = {}): Row => ({ id, user_id: U, title, page: null, parent_id: null, block_name: null, is_template: false, deleted_at: null, ...over });

await test("lists the normal notes linked to each block, by title", async () => {
  const sb = fake({
    entity_relations: [rel("n2", "gym"), rel("n1", "gym"), rel("n1", "work")],
    notes: [note("n1", "Zeta plan", { page: { icon: "🏋️" } }), note("n2", "Alpha")],
  });
  const out = await getBlockLinkedNotes(sb, U);
  assert.deepEqual(out.gym.map((n) => n.title), ["Alpha", "Zeta plan"]);
  assert.equal(out.gym[1].icon, "🏋️");
  assert.deepEqual(out.work.map((n) => n.id), ["n1"]);
});

await test("block notes, templates, trashed notes, removed links and links to other things are left out", async () => {
  const sb = fake({
    entity_relations: [
      rel("blocknote", "gym"),
      rel("tpl", "gym"),
      rel("trashed", "gym"),
      rel("ok", "gym"),
      rel("removed", "gym", { deleted_at: "2026-11-01" }),
      rel("event-note", "ev1", { target_type: "event" }),
      rel("other-user", "gym", { user_id: "u2" }),
    ],
    notes: [
      note("blocknote", "Gym", { block_name: "Gym" }),
      note("tpl", "Template", { is_template: true }),
      note("trashed", "Gone", { deleted_at: "2026-11-01" }),
      note("ok", "Fine"),
      note("removed", "Unlinked"),
      note("event-note", "About an event"),
      note("other-user", "Not mine", { user_id: "u2" }),
    ],
  });
  const out = await getBlockLinkedNotes(sb, U);
  assert.deepEqual(Object.keys(out), ["gym"]);
  assert.deepEqual(out.gym.map((n) => n.id), ["ok"]);
});

await test("a note linked twice appears once; sub-pages are marked; empty titles become Untitled", async () => {
  const sb = fake({ entity_relations: [rel("a", "gym"), rel("a", "gym"), rel("b", "gym")], notes: [note("a", "  "), note("b", "Kid", { parent_id: "a" })] });
  const out = await getBlockLinkedNotes(sb, U);
  assert.equal(out.gym.length, 2);
  assert.equal(out.gym.find((n) => n.id === "a")?.title, "Untitled");
  assert.equal(out.gym.find((n) => n.id === "b")?.sub, true);
});

await test("nothing linked, or a database error → empty (the calendar still loads)", async () => {
  assert.deepEqual(await getBlockLinkedNotes(fake({}), U), {});
  assert.deepEqual(await getBlockLinkedNotes(fake({ entity_relations: [rel("a", "gym")] }, true), U), {});
});

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
