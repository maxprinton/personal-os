// Runs migration 0061 (twice) plus every scenario in fixtures/backlog-scenarios.json and the extra tests against a
// SCRATCH Postgres. Needs `psql`. Not part of `npm test` (the user's PC has no Postgres); Claude runs it in its own
// workspace after changing the migration or the rules.
// Run: node scripts/test-backlog-sql.mjs "<psql connection args>"   e.g.  "-h /tmp/pgsock -U postgres scratch"
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const conn = (process.argv[2] ?? "").split(" ").filter(Boolean);
if (conn.length === 0) {
  console.error('Usage: node scripts/test-backlog-sql.mjs "<psql connection args>"');
  process.exit(2);
}
const U = "00000000-0000-0000-0000-000000000001";
const spec = JSON.parse(readFileSync(join(here, "fixtures/backlog-scenarios.json"), "utf8"));
const migration = join(here, "../supabase/migrations/0061_backlog.sql");

function psql(args, input) {
  const r = spawnSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", ...conn, ...args], { encoding: "utf8", input });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

let pass = 0;
let fail = 0;
function ok(name, cond, extra = "") {
  if (cond) pass++;
  else {
    fail++;
    console.log(`FAIL ${name}${extra ? `  [${extra}]` : ""}`);
  }
}

// ---- 1. stubs + migration, twice (must be a no-op the second time) ----
let r = psql(["-f", join(here, "fixtures/backlog-stubs.sql")]);
ok("stubs load", r.code === 0, r.err);
r = psql(["-f", migration]);
ok("migration runs", r.code === 0, r.err);
r = psql(["-f", migration]);
ok("migration runs a second time (safe to run twice)", r.code === 0, r.err);

// ---- 2. shared scenarios ----
function filler(status, n) {
  let sql = "";
  for (let i = 0; i < n; i++) {
    sql += `insert into public.backlog_items (user_id, title, status, size, spec_link) values (${q(U)}, ${q(`filler ${status} ${i}`)}, ${q(status)}, 'S', 'x');\n`;
  }
  return sql;
}
function itemInsert(it, status) {
  const cols = ["user_id", "title", "type", "status", "size", "spec_link", "parked_reason"];
  const vals = [q(U), q("subject"), q(it.type ?? "feature"), q(status), it.size ? q(it.size) : "null", it.spec_link ? q(it.spec_link) : "null", it.parked_reason ? q(it.parked_reason) : "null"];
  return `insert into public.backlog_items (${cols.join(", ")}) values (${vals.join(", ")})`;
}
function fillers(counts = {}) {
  return filler("now", counts.now ?? 0) + filler("next", counts.next ?? 0) + filler("verifying", counts.verifying ?? 0);
}
function scenarioSql(s, kind) {
  const tag = `RESULT|${kind}|${s.name}`;
  const setup = `delete from public.backlog_events; delete from public.backlog_items;
set local session_replication_role = replica;
${fillers(s.counts)}`;
  if (kind === "move") {
    return `do $$ declare v_id uuid; v_re int; begin
${setup}
${itemInsert(s.item, s.item.status)} returning id into v_id;
set local session_replication_role = origin;
begin
  update public.backlog_items set status = ${q(s.to)} where id = v_id;
  select reopened_count into v_re from public.backlog_items where id = v_id;
  raise notice '${tag.replace(/'/g, "''")}|ok|%', v_re;
exception when others then
  raise notice '${tag.replace(/'/g, "''")}|error|%', sqlerrm;
end;
end $$;`;
  }
  return `do $$ begin
${setup}
set local session_replication_role = origin;
begin
  ${itemInsert(s.item, s.item.status)};
  raise notice '${tag.replace(/'/g, "''")}|ok|0';
exception when others then
  raise notice '${tag.replace(/'/g, "''")}|error|%', sqlerrm;
end;
end $$;`;
}

const all = [
  ...spec.scenarios.map((s) => ({ s, kind: "move" })),
  ...spec.creates.map((s) => ({ s, kind: "create" })),
];
const dir = mkdtempSync(join(tmpdir(), "backlog-"));
const file = join(dir, "scenarios.sql");
writeFileSync(file, all.map(({ s, kind }) => scenarioSql(s, kind)).join("\n"));
r = psql(["-f", file]);
ok("scenario script runs", r.code === 0, r.err.slice(0, 400));
const results = new Map();
for (const line of r.err.split("\n")) {
  const m = line.match(/RESULT\|(move|create)\|(.*?)\|(ok|error)\|(.*)$/);
  if (m) results.set(`${m[1]}|${m[2]}`, { outcome: m[3], detail: m[4] });
}
for (const { s, kind } of all) {
  const got = results.get(`${kind}|${s.name}`);
  if (!got) {
    ok(s.name, false, "no result");
    continue;
  }
  if (s.ok) {
    ok(s.name, got.outcome === "ok", `${got.outcome}: ${got.detail}`);
    if (s.reopen) ok(`${s.name} (reopened_count = 1)`, got.detail.trim() === "1", got.detail);
  } else {
    ok(s.name, got.outcome === "error" && got.detail.trim() === s.error, `${got.outcome}: ${got.detail}`);
  }
}

// ---- 3. extra tests ----
r = psql(["-f", join(here, "fixtures/backlog-extra-tests.sql")]);
ok("extra tests run", r.code === 0, r.err.slice(0, 600));
const extras = r.err.split("\n").filter((l) => l.includes("EXTRA|"));
ok("all 6 extra blocks passed", extras.length === 6, `${extras.length} passed`);

console.log(`\nbacklog SQL: ${pass} passed, ${fail} failed (${all.length} shared scenarios, ${extras.length} extra blocks)`);
process.exit(fail ? 1 : 0);
