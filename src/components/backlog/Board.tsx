"use client";

import Link from "next/link";
import { useState } from "react";
import { moveItemAction, placeItemAction, type BacklogActionResult } from "@/app/backlog-actions";
import Modal from "@/components/calendar/Modal";
import MoveMenu, { MoveForm } from "@/components/backlog/MoveMenu";
import { BOARD_ORDER, STATUS_HINT, STATUS_LABEL, TYPE_EMOJI, countsFor, groupByStatus, type BacklogItem } from "@/lib/backlog/board";
import { moveOptions, type BacklogStatus, type Caps, type Missing } from "@/lib/backlog/rules";

/**
 * The flow as columns. On a computer you drag a card to another column (or onto another card to reorder it);
 * the same Move menu as the list is on every card, which is what a phone uses. A drop that is not allowed shows the reason.
 */
export default function Board({
  items,
  caps,
  onResult,
  onNotice,
}: {
  items: BacklogItem[];
  caps: Caps;
  onResult: (r: BacklogActionResult) => void;
  onNotice: (text: string, bad?: boolean) => void;
}) {
  const groups = groupByStatus(items);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<BacklogStatus | null>(null);
  const [form, setForm] = useState<{ item: BacklogItem; to: BacklogStatus; missing: Missing[] } | null>(null);

  async function drop(to: BacklogStatus, targetNumber?: number) {
    const number = dragging;
    setDragging(null);
    setOver(null);
    if (number === null) return;
    const item = items.find((i) => i.number === number);
    if (!item) return;
    if (item.status === to) {
      if (targetNumber && targetNumber !== number) {
        const r = await placeItemAction({ number, target: targetNumber, where: "before" });
        if (r.error) onNotice(r.error, true);
        else onResult({ ok: true });
      }
      return;
    }
    const opt = moveOptions(item, countsFor(items, item.id), caps).find((o) => o.to === to);
    if (!opt) return onNotice(`Cannot move from ${item.status} to ${to}.`, true);
    if (!opt.ok) return onNotice(opt.message ?? "Not allowed.", true);
    if (opt.missing.length) return setForm({ item, to, missing: opt.missing });
    onResult(await moveItemAction({ number, to }));
  }

  return (
    <>
      <div className="-mx-4 overflow-x-auto px-4 pb-3 sm:-mx-6 sm:px-6">
        <div className="flex min-w-max gap-3">
          {BOARD_ORDER.map((st) => {
            const list = groups[st];
            const cap = st === "now" ? caps.now : st === "next" ? caps.next : st === "verifying" ? caps.verifying : null;
            const count = st === "now" ? list.filter((i) => i.type !== "bug").length : list.length;
            return (
              <section
                key={st}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(st);
                }}
                onDragLeave={() => setOver((o) => (o === st ? null : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  void drop(st);
                }}
                className={`w-64 shrink-0 rounded-2xl border bg-subtle/60 p-2 transition-colors ${over === st ? "border-accent" : "border-line"}`}
              >
                <header className="px-1 pb-2">
                  <h3 className="flex items-baseline justify-between text-sm font-semibold">
                    {STATUS_LABEL[st]}
                    <span className={`text-xs font-normal ${cap !== null && count >= cap ? "text-warning" : "text-muted"}`}>{cap !== null ? `${count}/${cap}` : list.length}</span>
                  </h3>
                  <p className="text-xs text-faint">{STATUS_HINT[st]}</p>
                </header>
                <ul className="min-h-12 space-y-2">
                  {list.slice(0, st === "done" ? 12 : 100).map((it) => (
                    <li
                      key={it.id}
                      draggable
                      onDragStart={(e) => {
                        setDragging(it.number);
                        e.dataTransfer.setData("text/plain", String(it.number));
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setOver(null);
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void drop(st, it.number);
                      }}
                      className={`cursor-grab rounded-xl border border-line bg-surface p-2 text-sm shadow-card active:cursor-grabbing ${dragging === it.number ? "opacity-50" : ""}`}
                    >
                      <Link href={`/backlog/${it.number}`} className="block hover:underline">
                        {TYPE_EMOJI[it.type]} <span className="text-muted">BL-{it.number}</span> {it.title}
                      </Link>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <span className="text-xs text-faint">{[it.size, it.area].filter(Boolean).join(" · ")}</span>
                        <MoveMenu item={it} items={items} caps={caps} onResult={onResult} />
                      </div>
                    </li>
                  ))}
                  {list.length === 0 && <li className="px-1 py-2 text-xs text-faint">Empty</li>}
                  {st === "done" && list.length > 12 && <li className="px-1 text-xs text-faint">…and {list.length - 12} more in the list view</li>}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
      {form && (
        <Modal title="One more thing" onClose={() => setForm(null)}>
          <MoveForm
            item={form.item}
            to={form.to}
            missing={form.missing}
            onCancel={() => setForm(null)}
            onResult={(r) => {
              setForm(null);
              onResult(r);
            }}
          />
        </Modal>
      )}
    </>
  );
}
