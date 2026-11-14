"use client";

import Link from "next/link";
import type { BacklogActionResult } from "@/app/backlog-actions";
import MoveMenu from "@/components/backlog/MoveMenu";
import { TYPE_EMOJI, TYPE_LABEL, daysSince, rankScore, type BacklogItem } from "@/lib/backlog/board";
import type { Caps } from "@/lib/backlog/rules";

const chip = "rounded-full bg-subtle px-2 py-0.5 text-xs text-muted";

/** One backlog item in the list: code, title, size, area, how long it has been there, and the Move menu. */
export default function ItemRow({
  item,
  items,
  caps,
  nowIso,
  onResult,
  showScore = false,
}: {
  item: BacklogItem;
  items: BacklogItem[];
  caps: Caps;
  nowIso: string;
  onResult: (r: BacklogActionResult) => void;
  showScore?: boolean;
}) {
  const days = daysSince(item.status_changed_at, new Date(nowIso));
  const score = rankScore(item);
  return (
    <li className="flex items-start gap-3 rounded-xl border border-line bg-surface p-3 transition-colors hover:border-edge">
      <span className="text-lg leading-6" title={TYPE_LABEL[item.type]} aria-label={TYPE_LABEL[item.type]}>
        {TYPE_EMOJI[item.type]}
      </span>
      <div className="min-w-0 flex-1">
        <Link href={`/backlog/${item.number}`} className="font-medium hover:underline">
          <span className="text-muted">BL-{item.number}</span> {item.title}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {item.size && <span className={chip}>{item.size}</span>}
          {item.area && <span className={chip}>{item.area}</span>}
          {item.reopened_count > 0 && <span className={chip}>reopened {item.reopened_count}×</span>}
          {(showScore || score !== null) && score !== null && <span className={chip}>value {item.value} / effort {item.effort}</span>}
          <span className="text-xs text-faint">
            {days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"}`} in {item.status}
          </span>
        </div>
        {item.status === "parked" && item.parked_reason && <p className="mt-1 text-xs text-muted">Why: {item.parked_reason}</p>}
      </div>
      <MoveMenu item={item} items={items} caps={caps} onResult={onResult} />
    </li>
  );
}
