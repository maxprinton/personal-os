"use client";

// BL-122: the four charts of Finance → Charts, drawn as plain SVG (no chart library).
// Tap (or hover/Enter) a bar or day: the numbers show under the chart with a "See movements" link.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  compareSameDay, movementsHref, seriesValue,
  type CategorySeries, type CumulativeLine, type MonthBucket,
} from "@/lib/finance-charts";

const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const signedUsd = (n: number) => `${n < 0 ? "−" : "+"}${usd(Math.abs(n))}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthShort = (m: string, withYear: boolean) => `${MONTHS[Number(m.slice(5, 7)) - 1]}${withYear ? ` ’${m.slice(2, 4)}` : ""}`;
const monthLong = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

const ADJ_COLOR = "#94a3b8"; // the color of the "Adjustment" category
const CAT_COLORS = ["var(--b-blue)", "var(--b-coral)", "var(--b-magenta)", "var(--b-green)", "var(--b-amber)", "#8b6fd6"];
const ELSE_COLOR = "#c8a27a";
const MUTED = "var(--muted)";

type Seg = { id: string; value: number; color: string; label: string; href?: string; share?: string };
type Bar = { segs: Seg[]; top?: string };
type Group = { label: string; title: string; bars: Bar[]; footer?: string };
type Pick = { title: string; lines: string[]; links: { text: string; href: string }[]; id: string };

/** Round axis: about 4 steps of 1, 2, 5 or 10 × a power of ten, with the top at or above the biggest value. */
function niceScale(v: number) {
  if (v <= 0) return { max: 4, ticks: [0, 1, 2, 3, 4] };
  const raw = v / 4;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / p;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  const count = Math.ceil(v / step - 1e-9);
  return { max: count * step, ticks: Array.from({ length: count + 1 }, (_, i) => Number((i * step).toFixed(2))) };
}
const tickLabel = (t: number) => (t >= 1000 ? `$${Number((t / 1000).toFixed(2))}k` : `$${t}`);

/** Wide charts scroll sideways inside their card on a phone; they start at the newest months. */
function ScrollBox({ children, hint }: { children: React.ReactNode; hint?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);
  return (
    <>
      <div ref={ref} className="overflow-x-auto">{children}</div>
      {hint && <p className="text-xs text-faint sm:hidden">Swipe sideways to see earlier months.</p>}
    </>
  );
}

function Details({ pick, hint }: { pick: Pick | null; hint: string }) {
  if (!pick) return <p className="min-h-10 text-xs text-faint">{hint}</p>;
  return (
    <div className="min-h-10 rounded-lg bg-subtle px-3 py-2 text-sm" aria-live="polite">
      <p className="font-medium">{pick.title}</p>
      {pick.lines.map((l) => (
        <p key={l} className="text-muted tabular-nums">{l}</p>
      ))}
      <div className="mt-1 flex flex-wrap gap-x-4">
        {pick.links.map((l) => (
          <Link key={l.href} href={l.href} className="text-accent hover:underline">{l.text}</Link>
        ))}
      </div>
    </div>
  );
}

function BarChart({ groups, onPick, pickedId, label }: { groups: Group[]; onPick: (p: Pick) => void; pickedId: string | null; label: string }) {
  const perGroup = Math.max(1, ...groups.map((g) => g.bars.length));
  const W = Math.max(640, groups.length * (perGroup > 1 ? 72 : 52) + 60);
  const H = 260;
  const left = 52, right = 8, top = 16, bottom = 46;
  const pw = W - left - right, ph = H - top - bottom;
  const { max, ticks } = niceScale(Math.max(0, ...groups.flatMap((g) => g.bars.map((b) => b.segs.reduce((s, x) => s + x.value, 0)))));
  const groupW = pw / Math.max(1, groups.length);
  const barW = Math.min(40, (groupW * 0.78) / perGroup);
  const y = (v: number) => top + ph - (v / max) * ph;

  return (
    <ScrollBox hint={groups.length > 3}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ minWidth: Math.min(W, 640) }} className="h-auto w-full" role="img" aria-label={label}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={W - right} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
            <text x={left - 6} y={y(t) + 3} textAnchor="end" fontSize={10} style={{ fill: MUTED }}>{tickLabel(t)}</text>
          </g>
        ))}
        {groups.map((g, gi) => {
          const clusterW = g.bars.length * barW + (g.bars.length - 1) * 4;
          const x0 = left + gi * groupW + (groupW - clusterW) / 2;
          return (
            <g key={g.label + gi}>
              {g.bars.map((b, bi) => {
                const bx = x0 + bi * (barW + 4);
                let acc = 0;
                const total = b.segs.reduce((s, x) => s + x.value, 0);
                return (
                  <g key={bi}>
                    {b.segs.map((s) => {
                      if (s.value <= 0) return null;
                      const h = Math.max(2, (s.value / max) * ph);
                      const yy = top + ph - (acc / max) * ph - h;
                      acc += s.value;
                      const id = `${gi}:${bi}:${s.id}`;
                      const chosen = pickedId === id;
                      return (
                        <rect
                          key={s.id}
                          x={bx}
                          y={yy}
                          width={barW}
                          height={h}
                          rx={2}
                          fill={s.color}
                          stroke={chosen ? "var(--fg)" : "var(--surface)"}
                          strokeWidth={chosen ? 2 : 1}
                          tabIndex={0}
                          role="button"
                          aria-label={`${g.title}, ${s.label}, ${usd(s.value)}`}
                          className="cursor-pointer outline-none focus-visible:stroke-[var(--fg)]"
                          onClick={() => onPick({ id, title: `${g.title} · ${s.label}`, lines: [`${usd(s.value)}${s.share ? ` · ${s.share}` : ""}`], links: s.href ? [{ text: "See movements →", href: s.href }] : [] })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              (e.currentTarget as SVGRectElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
                            }
                          }}
                        >
                          <title>{`${s.label}: ${usd(s.value)}`}</title>
                        </rect>
                      );
                    })}
                    {total > 0 && groupW > 44 && (
                      <text x={bx + barW / 2} y={y(total) - 4} textAnchor="middle" fontSize={9} style={{ fill: MUTED }}>{b.top ?? usd(total).replace(".00", "")}</text>
                    )}
                  </g>
                );
              })}
              <text x={left + gi * groupW + groupW / 2} y={top + ph + 14} textAnchor="middle" fontSize={11} style={{ fill: "var(--fg)" }}>{g.label}</text>
              {g.footer && <text x={left + gi * groupW + groupW / 2} y={top + ph + 28} textAnchor="middle" fontSize={10} style={{ fill: MUTED }}>{g.footer}</text>}
            </g>
          );
        })}
      </svg>
    </ScrollBox>
  );
}

function Legend({ items }: { items: { color: string; name: string; value?: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((i) => (
        <li key={i.name} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} aria-hidden />
          {i.name} {i.value && <span className="tabular-nums">{i.value}</span>}
        </li>
      ))}
    </ul>
  );
}

function Card({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="card space-y-3 p-4">
      <div>
        <h2 className="section-title">{title}</h2>
        <p className="text-xs text-muted">{note}</p>
      </div>
      {children}
    </section>
  );
}

// ───────────── A. Cumulative spend

function CumulativeChart({ a, b }: { a: CumulativeLine; b: CumulativeLine }) {
  const [pick, setPick] = useState<Pick | null>(null);
  const W = 480, H = 260, left = 46, right = 10, top = 14, bottom = 28;
  const pw = W - left - right, ph = H - top - bottom;
  const nDays = Math.max(a.days.length, b.days.length);
  const { max, ticks } = niceScale(Math.max(a.total, b.total, ...a.days.map((v) => v ?? 0), ...b.days.map((v) => v ?? 0)));
  const x = (day: number) => left + ((day - 1) / Math.max(1, nDays - 1)) * pw;
  const y = (v: number) => top + ph - (v / max) * ph;
  const path = (l: CumulativeLine) => l.days.map((v, i) => (v === null ? "" : `${i === 0 || l.days[i - 1] === null ? "M" : "L"}${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`)).join(" ");
  const cmp = compareSameDay(a, b);
  const xTicks = [1, 5, 10, 15, 20, 25, nDays].filter((d, i, arr) => d <= nDays && arr.indexOf(d) === i);
  const dayDate = (m: string, d: number) => `${m}-${String(d).padStart(2, "0")}`;

  const pickDay = (d: number) => {
    const av = a.days[d - 1];
    const bv = b.days[d - 1] ?? null;
    setPick({
      id: `day${d}`,
      title: `Day ${d}`,
      lines: [`${monthLong(a.month)}: ${av === null || av === undefined ? "not yet" : usd(av)}`, `${monthLong(b.month)}: ${bv === null ? (d > b.days.length ? "no such day" : "not yet") : usd(bv)}`],
      links: [
        ...(av !== null && av !== undefined ? [{ text: `${monthShort(a.month, false)} movements →`, href: movementsHref({ from: `${a.month}-01`, to: dayDate(a.month, d), type: "expense" as const, adj: "exclude" as const }) }] : []),
        ...(bv !== null ? [{ text: `${monthShort(b.month, false)} movements →`, href: movementsHref({ from: `${b.month}-01`, to: dayDate(b.month, d), type: "expense" as const, adj: "exclude" as const }) }] : []),
      ],
    });
  };

  return (
    <Card title="Spending so far, month vs month" note="Real spending added up day by day. Balance adjustments are not included.">
      <p className="text-sm">
        On day {cmp.day}: <b className="tabular-nums">{usd(cmp.a)}</b> in {monthLong(a.month)} vs <b className="tabular-nums">{usd(cmp.b)}</b> in {monthLong(b.month)}{" "}
        <span className={cmp.diff > 0 ? "text-danger" : cmp.diff < 0 ? "text-success" : "text-muted"}>({cmp.diff === 0 ? "same" : signedUsd(cmp.diff)})</span>
      </p>
      <div>
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Cumulative spending, ${monthLong(a.month)} against ${monthLong(b.month)}`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={W - right} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
              <text x={left - 6} y={y(t) + 3} textAnchor="end" fontSize={10} style={{ fill: MUTED }}>{tickLabel(t)}</text>
            </g>
          ))}
          {xTicks.map((d) => (
            <text key={d} x={x(d)} y={H - 10} textAnchor="middle" fontSize={10} style={{ fill: MUTED }}>{d}</text>
          ))}
          <path d={path(b)} fill="none" stroke="var(--b-coral)" strokeWidth={2} strokeDasharray="5 4" />
          <path d={path(a)} fill="none" stroke="var(--b-blue)" strokeWidth={2.5} />
          {a.throughDay >= 1 && <circle cx={x(a.throughDay)} cy={y(a.total)} r={4} fill="var(--b-blue)" />}
          {Array.from({ length: nDays }, (_, i) => i + 1).map((d) => {
            const step = pw / Math.max(1, nDays - 1);
            return (
              <rect
                key={d}
                x={x(d) - step / 2}
                y={top}
                width={step}
                height={ph}
                fill={pick?.id === `day${d}` ? "var(--accent-soft)" : "transparent"}
                fillOpacity={pick?.id === `day${d}` ? 0.6 : 1}
                tabIndex={0}
                role="button"
                aria-label={`Day ${d}`}
                className="cursor-pointer outline-none"
                onClick={() => pickDay(d)}
                onMouseEnter={() => pickDay(d)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    pickDay(d);
                  }
                }}
              />
            );
          })}
        </svg>
      </div>
      <Legend items={[{ color: "var(--b-blue)", name: monthLong(a.month), value: usd(a.total) }, { color: "var(--b-coral)", name: monthLong(b.month), value: usd(b.total) }]} />
      {(a.adjLeftOut > 0 || b.adjLeftOut > 0) && (
        <p className="text-xs text-faint">
          Left out (balance adjustments): {a.adjLeftOut > 0 && `${monthShort(a.month, false)} ${usd(a.adjLeftOut)}`}{a.adjLeftOut > 0 && b.adjLeftOut > 0 && " · "}{b.adjLeftOut > 0 && `${monthShort(b.month, false)} ${usd(b.adjLeftOut)}`}
        </p>
      )}
      <Details pick={pick} hint="Tap a day to see both months on that day." />
    </Card>
  );
}

// ───────────── B, C, D

export default function FinanceCharts({
  monthly, series, adjIds, multiYear, lineA, lineB,
}: {
  monthly: MonthBucket[];
  series: CategorySeries[];
  /** ids of the Adjustment categories (both kinds) */
  adjIds: string[];
  multiYear: boolean;
  lineA: CumulativeLine;
  lineB: CumulativeLine;
}) {
  const [pickB, setPickB] = useState<Pick | null>(null);
  const [pickC, setPickC] = useState<Pick | null>(null);
  const [pickD, setPickD] = useState<Pick | null>(null);
  const label = (m: MonthBucket) => `${monthShort(m.month, multiYear)}${m.partial ? "*" : ""}`;
  const title = (m: MonthBucket) => `${monthLong(m.month)}${m.partial ? " (part)" : ""}`;
  const hasPartial = monthly.some((m) => m.partial);
  const colorOf = (i: number, s: CategorySeries) => (s.key === "else" ? ELSE_COLOR : CAT_COLORS[i % CAT_COLORS.length]);
  const adjQuery = adjIds.length ? adjIds : [];

  const catGroups: Group[] = monthly.map((m) => {
    const real = series.map((s, i) => ({ s, i, v: seriesValue(m, s) }));
    return {
      label: label(m),
      title: title(m),
      bars: [
        {
          segs: [
            ...real.map(({ s, i, v }) => ({
              id: s.key,
              value: v,
              color: colorOf(i, s),
              label: s.name,
              share: m.expense > 0 ? `${Math.round((v / (m.expense + m.adjExpense)) * 100)}% of the month` : undefined,
              href: movementsHref({ from: m.from, to: m.to, type: "expense", cats: s.ids, adj: "exclude" }),
            })),
            { id: "adj", value: m.adjExpense, color: ADJ_COLOR, label: "Balance adjustments", href: movementsHref({ from: m.from, to: m.to, type: "expense", cats: adjQuery, adj: "only" }) },
          ],
        },
      ],
    };
  });

  const adjGroups: Group[] = monthly.map((m) => ({
    label: label(m),
    title: title(m),
    footer: `net ${signedUsd(m.adjIncome - m.adjExpense)}`,
    bars: [
      { segs: [{ id: "in", value: m.adjIncome, color: "var(--b-green)", label: "Adjustments that added money", href: movementsHref({ from: m.from, to: m.to, type: "income", cats: adjQuery, adj: "only" }) }] },
      { segs: [{ id: "out", value: m.adjExpense, color: "var(--b-coral)", label: "Adjustments that removed money", href: movementsHref({ from: m.from, to: m.to, type: "expense", cats: adjQuery, adj: "only" }) }] },
    ],
  }));

  const ieGroups: Group[] = monthly.map((m) => ({
    label: label(m),
    title: title(m),
    footer: `net ${signedUsd(m.income - m.expense)}`,
    bars: [
      {
        segs: [
          { id: "inc", value: m.income, color: "var(--b-green)", label: "Income", href: movementsHref({ from: m.from, to: m.to, type: "income", adj: "exclude" }) },
          { id: "adjin", value: m.adjIncome, color: ADJ_COLOR, label: "Adjustments that added money", href: movementsHref({ from: m.from, to: m.to, type: "income", cats: adjQuery, adj: "only" }) },
        ],
      },
      {
        segs: [
          { id: "exp", value: m.expense, color: "var(--b-coral)", label: "Expenses", href: movementsHref({ from: m.from, to: m.to, type: "expense", adj: "exclude" }) },
          { id: "adjout", value: m.adjExpense, color: ADJ_COLOR, label: "Adjustments that removed money", href: movementsHref({ from: m.from, to: m.to, type: "expense", cats: adjQuery, adj: "only" }) },
        ],
      },
    ],
  }));

  const empty = monthly.every((m) => m.income + m.expense + m.adjIncome + m.adjExpense === 0);

  return (
    <div className="space-y-6">
      <CumulativeChart a={lineA} b={lineB} />
      {empty ? (
        <section className="card p-4">
          <p className="text-sm text-faint">No spending or income in this range. Pick other dates above.</p>
        </section>
      ) : (
        <>
          <Card title="Where it went, month by month" note="Real expenses by category. The gray part on top is balance adjustments.">
            <BarChart groups={catGroups} onPick={setPickB} pickedId={pickB?.id ?? null} label="Expenses by category and month" />
            <Legend
              items={[
                ...series.map((s, i) => ({ color: colorOf(i, s), name: s.name, value: usd(s.total) })),
                { color: ADJ_COLOR, name: "Balance adjustments", value: usd(monthly.reduce((t, m) => t + m.adjExpense, 0)) },
              ]}
            />
            <Details pick={pickB} hint="Tap a colored part to see its number and the movements behind it." />
          </Card>

          <Card title="Income vs expenses" note="Green is money in, red is money out. Gray on top is balance adjustments. The net is real income minus real expenses.">
            <BarChart groups={ieGroups} onPick={setPickD} pickedId={pickD?.id ?? null} label="Income against expenses by month" />
            <Legend items={[{ color: "var(--b-green)", name: "Income" }, { color: "var(--b-coral)", name: "Expenses" }, { color: ADJ_COLOR, name: "Balance adjustments" }]} />
            <Details pick={pickD} hint="Tap a bar to see its number and the movements behind it." />
          </Card>

          <Card title="Balance adjustments" note="How much your records differed from the real balances. It should shrink as you log more of what happens.">
            <BarChart groups={adjGroups} onPick={setPickC} pickedId={pickC?.id ?? null} label="Balance adjustments by month" />
            <Legend items={[{ color: "var(--b-green)", name: "Added money" }, { color: "var(--b-coral)", name: "Removed money" }]} />
            <Details pick={pickC} hint="Tap a bar to see the adjustments behind it." />
          </Card>
          {hasPartial && <p className="text-xs text-faint">* Partial month: only the days inside your range (or up to today) are counted.</p>}
        </>
      )}
    </div>
  );
}
