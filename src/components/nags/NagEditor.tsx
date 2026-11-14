"use client";

import { useRef, useState } from "react";
import { phoneMayBeLate, type NagChannel, type NagKind, type PhoneStyle } from "@/lib/nags/rules";
import type { NagDraft } from "@/lib/nags/db";

type Row = NagDraft & { key: number };
type Unit = "minutes" | "hours" | "days";
const UNIT_MIN: Record<Unit, number> = { minutes: 1, hours: 60, days: 1440 };

function split(minutes: number): { amount: number; unit: Unit } {
  if (minutes >= 1440 && minutes % 1440 === 0) return { amount: minutes / 1440, unit: "days" };
  if (minutes >= 60 && minutes % 60 === 0) return { amount: minutes / 60, unit: "hours" };
  return { amount: minutes, unit: "minutes" };
}

const field = "rounded-md border border-edge bg-surface px-2 py-1 text-sm";

/** The list of nags. Keeps its own copy and reports every change (without the internal keys). */
export default function NagEditor({ initial, onChange, disabled }: { initial: NagDraft[]; onChange: (list: NagDraft[]) => void; disabled?: boolean }) {
  const counter = useRef(0);
  const [rows, setRows] = useState<Row[]>(() => initial.map((n) => ({ ...n, key: counter.current++ })));

  function commit(next: Row[]) {
    setRows(next);
    onChange(next.map(({ key: _k, ...n }) => n));
  }
  const add = (kind: NagKind) =>
    commit([...rows, { key: counter.current++, kind, offsetMinutes: kind === "before" ? 60 : 0, channel: "telegram", phoneStyle: "alarm" }]);
  const patch = (key: number, p: Partial<NagDraft>) => commit(rows.map((r) => (r.key === key ? { ...r, ...p } : r)));

  return (
    <div className="space-y-2">
      {rows.length === 0 && <p className="text-xs text-muted">No nags.</p>}
      {rows.map((r) => (
        <NagRow key={r.key} row={r} disabled={disabled} onPatch={(p) => patch(r.key, p)} onRemove={() => commit(rows.filter((x) => x.key !== r.key))} />
      ))}
      {!disabled && (
        <div className="flex flex-wrap gap-2 text-xs">
          <button type="button" onClick={() => add("before")} className="rounded-md border border-edge px-2 py-1 hover:bg-subtle">+ Before</button>
          <button type="button" onClick={() => add("start")} className="rounded-md border border-edge px-2 py-1 hover:bg-subtle">+ At the start</button>
          <button type="button" onClick={() => add("mid")} className="rounded-md border border-edge px-2 py-1 hover:bg-subtle">+ Halfway</button>
        </div>
      )}
    </div>
  );
}

function NagRow({ row, onPatch, onRemove, disabled }: { row: Row; onPatch: (p: Partial<NagDraft>) => void; onRemove: () => void; disabled?: boolean }) {
  const first = split(row.offsetMinutes);
  const [amount, setAmount] = useState(String(first.amount));
  const [unit, setUnit] = useState<Unit>(first.unit);
  const setOffset = (a: string, u: Unit) => {
    setAmount(a);
    setUnit(u);
    const n = Math.round(Number(a));
    onPatch({ offsetMinutes: Number.isFinite(n) && n > 0 ? n * UNIT_MIN[u] : 0 });
  };
  const late = phoneMayBeLate(row);
  return (
    <div className="space-y-1 rounded-md bg-subtle p-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {row.kind === "before" ? (
          <>
            <input type="number" min={1} disabled={disabled} value={amount} onChange={(e) => setOffset(e.target.value, unit)} className={`${field} w-20`} aria-label="How long before" />
            <select disabled={disabled} value={unit} onChange={(e) => setOffset(amount, e.target.value as Unit)} className={field} aria-label="Unit">
              <option value="minutes">minutes</option>
              <option value="hours">hours</option>
              <option value="days">days</option>
            </select>
            <span>before</span>
          </>
        ) : (
          <span>{row.kind === "start" ? "At the start" : "Halfway through"}</span>
        )}
        <select disabled={disabled} value={row.channel} onChange={(e) => onPatch({ channel: e.target.value as NagChannel })} className={field} aria-label="Where">
          <option value="telegram">Telegram</option>
          <option value="phone">Phone alarm</option>
          <option value="both">Telegram + phone</option>
        </select>
        {row.channel !== "telegram" && (
          <select disabled={disabled} value={row.phoneStyle} onChange={(e) => onPatch({ phoneStyle: e.target.value as PhoneStyle })} className={field} aria-label="Phone sound">
            <option value="alarm">Full alarm</option>
            <option value="notify">Quiet banner</option>
          </select>
        )}
        {!disabled && (
          <button type="button" onClick={onRemove} aria-label="Remove this nag" className="ml-auto px-1 text-faint hover:text-danger">×</button>
        )}
      </div>
      {row.kind === "before" && row.offsetMinutes < 1 && <p className="text-xs text-danger">Enter a number above 0.</p>}
      {late && <p className="text-xs text-muted">The phone only checks for new alarms at :05 and :45 each hour, so this one may arrive up to about 40 minutes late.</p>}
    </div>
  );
}
