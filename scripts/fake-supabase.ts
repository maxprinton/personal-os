// A small in-memory stand-in for the Supabase client, for tests: select / insert / update / delete with
// eq, is, in, not, order, limit, single, maybeSingle, count head. Nothing is sent anywhere.
export type Row = Record<string, unknown>;
let idc = 0;
export function fakeDb(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    const rows = (tables[table] ??= []);
    const filters: ((r: Row) => boolean)[] = [];
    let patch: Row | null = null;
    let ins: Row[] | null = null;
    let del = false;
    let head = false;
    let ord: { col: string; asc: boolean } | null = null;
    let lim = Infinity;
    let off = 0;
    const run = () => {
      if (ins) {
        const made = ins.map((r) => ({ id: `id${++idc}`, created_at: new Date(1e12 + idc * 1000).toISOString(), updated_at: "", ...r }));
        rows.push(...made);
        return { data: made.map((r) => ({ ...r })), error: null as null | { message: string } };
      }
      let hit = rows.filter((r) => filters.every((f) => f(r)));
      if (patch) {
        for (const r of hit) Object.assign(r, patch);
        return { data: null, error: null };
      }
      if (del) {
        for (const r of hit) rows.splice(rows.indexOf(r), 1);
        return { data: null, error: null };
      }
      if (ord) {
        const { col, asc } = ord;
        hit = [...hit].sort((a, b) => ((a[col] as number) > (b[col] as number) ? 1 : (a[col] as number) < (b[col] as number) ? -1 : 0) * (asc ? 1 : -1));
      }
      const total = hit.length;
      hit = hit.slice(off, off + lim);
      return { data: head ? null : hit.map((r) => JSON.parse(JSON.stringify(r)) as Row), error: null, count: total };
    };
    const q: Record<string, unknown> = {
      select: (_c?: string, o?: { head?: boolean }) => ((head = !!o?.head), q),
      insert: (r: Row | Row[]) => ((ins = Array.isArray(r) ? r : [r]), q),
      update: (p: Row) => ((patch = p), q),
      delete: () => ((del = true), q),
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
      is: (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) === v), q),
      gte: (k: string, v: unknown) => (filters.push((r) => String(r[k] ?? "") >= String(v)), q),
      lte: (k: string, v: unknown) => (filters.push((r) => String(r[k] ?? "") <= String(v)), q),
      gt: (k: string, v: unknown) => (filters.push((r) => String(r[k] ?? "") > String(v)), q),
      neq: (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) !== v), q),
      range: (a: number, b: number) => ((off = a), (lim = b - a + 1), q),
      lt: (k: string, v: unknown) => (filters.push((r) => String(r[k] ?? "") < String(v)), q),
      in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), q),
      not: (k: string, _op: string, v: unknown) => (filters.push((r) => (r[k] ?? null) !== v), q),
      order: (col: string, o?: { ascending?: boolean }) => ((ord = { col, asc: o?.ascending !== false }), q),
      limit: (n: number) => ((lim = n), q),
      maybeSingle: async () => ({ data: run().data?.[0] ?? null, error: null }),
      single: async () => {
        const r = run();
        return { data: r.data?.[0] ?? null, error: r.data?.[0] ? null : { message: "no row" } };
      },
      then: (res: (x: unknown) => void) => res(run()),
    };
    return q;
  };
  return { from } as never;
}
