"use client";
// Needs & Wants list on the Finance page (BL-116). Needed is bought first, Wanted when needs are covered.
// Bought opens the pre-filled transaction form (like Pay on a scheduled payment); undo removes that transaction.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addPurchaseItem,
  buyPurchaseItem,
  editPurchaseItem,
  removePurchaseItem,
  reorderPurchaseItem,
  switchPurchaseKind,
  undoPurchaseBought,
  type PurchaseResult,
} from "@/app/purchase-actions";
import { KIND_LABEL, boughtOf, listOf, totals, type PurchaseItem, type PurchaseKind } from "@/lib/purchases/rules";

type Opt = { id: string; name: string };
const input = "rounded-md border border-line-strong px-3 py-2 text-sm";
const small = "rounded-md border border-edge px-2.5 py-1.5 text-xs transition-colors hover:bg-subtle disabled:opacity-40";
const usd = (n: number) => `$${n.toFixed(2)}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  function run(fn: () => Promise<PurchaseResult>, after?: () => void) {
    start(async () => {
      const r = await fn();
      setMsg(r.error ?? null);
      if (!r.error) {
        after?.();
        router.refresh();
      }
    });
  }
  return { run, pending, msg, setMsg };
}

export default function PurchasesSection({
  items,
  missing,
  error,
  categories,
  accounts,
  today,
}: {
  items: PurchaseItem[];
  missing: boolean;
  error: string | null;
  categories: Opt[];
  accounts: Opt[];
  today: string;
}) {
  return (
    <section className="space-y-3" aria-labelledby="nw-title">
      <div>
        <h2 id="nw-title" className="section-title">Needs &amp; Wants</h2>
        <p className="text-xs text-muted">
          Needs first, wants when the needs are covered. Nothing is blocked. <b>Bought</b> opens the transaction already filled in; you
          check it and save. Undo puts the item back and removes that transaction. From Telegram: <code>need: sandals 25</code> ·{" "}
          <code>want: headphones 80</code>.
        </p>
      </div>
      {missing || error ? (
        <p className="rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm text-warning">{error}</p>
      ) : (
        <>
          <AddRow />
          {(["need", "want"] as const).map((k) => (
            <KindList key={k} kind={k} list={listOf(items, k)} categories={categories} accounts={accounts} today={today} />
          ))}
          <BoughtList list={boughtOf(items)} />
        </>
      )}
    </section>
  );
}

function AddRow() {
  const { run, pending, msg } = useAct();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [kind, setKind] = useState<PurchaseKind>("want");
  return (
    <form
      className="space-y-2 rounded-lg border border-line bg-surface p-3 shadow-card"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => addPurchaseItem({ name, price, kind }), () => {
          setName("");
          setPrice("");
        });
      }}
    >
      <div className="flex gap-2" role="radiogroup" aria-label="Need or want">
        {(["need", "want"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => setKind(k)}
            className={`rounded-md border px-3 py-1 text-sm ${kind === k ? "border-accent bg-accent font-medium text-accent-fg" : "border-edge"}`}
          >
            {k === "need" ? "Need" : "Want"}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="What? (e.g. pants)" aria-label="Item" className={`${input} min-w-0 flex-1`} maxLength={200} />
        <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Price (optional)" aria-label="Price" inputMode="decimal" className={`${input} w-32`} />
        <button disabled={pending || !name.trim()} className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg shadow-sm transition-colors hover:bg-accent-hover disabled:opacity-50">
          {pending ? "Adding…" : "Add"}
        </button>
      </div>
      {msg && <p className="text-sm text-danger">{msg}</p>}
    </form>
  );
}

function KindList({
  kind,
  list,
  categories,
  accounts,
  today,
}: {
  kind: PurchaseKind;
  list: PurchaseItem[];
  categories: Opt[];
  accounts: Opt[];
  today: string;
}) {
  const t = totals(list);
  const { run, msg } = useAct();
  const [dragId, setDragId] = useState<string | null>(null);
  return (
    <div className="space-y-1.5">
      <p className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">
          {KIND_LABEL[kind]} <span className="font-normal text-muted">· {t.count}</span>
        </span>
        <span className="text-xs text-muted tabular-nums">
          {usd(t.sum)}
          {t.noPrice ? ` + ${t.noPrice} without a price` : ""}
        </span>
      </p>
      {list.length === 0 ? (
        <p className="text-xs text-faint">{kind === "need" ? "Nothing you need right now." : "Nothing you want right now."}</p>
      ) : (
        <ol className="card divide-y divide-line overflow-hidden">
          {list.map((item, i) => (
            <li
              key={item.id}
              draggable
              onDragStart={() => setDragId(item.id)}
              onDragOver={(e) => dragId && dragId !== item.id && e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId && dragId !== item.id) run(() => reorderPurchaseItem({ id: dragId, targetId: item.id }));
                setDragId(null);
              }}
              onDragEnd={() => setDragId(null)}
              className={dragId === item.id ? "opacity-50" : ""}
            >
              <Row item={item} first={i === 0} last={i === list.length - 1} categories={categories} accounts={accounts} today={today} />
            </li>
          ))}
        </ol>
      )}
      {msg && <p className="text-sm text-danger">{msg}</p>}
    </div>
  );
}

function Row({
  item,
  first,
  last,
  categories,
  accounts,
  today,
}: {
  item: PurchaseItem;
  first: boolean;
  last: boolean;
  categories: Opt[];
  accounts: Opt[];
  today: string;
}) {
  const { run, pending, msg } = useAct();
  const [mode, setMode] = useState<null | "buy" | "edit" | "more">(null);
  const other = item.kind === "need" ? "Wanted" : "Needed";
  return (
    <div className="space-y-2 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="hidden cursor-grab text-faint sm:inline" aria-hidden title="Drag to reorder">⋮⋮</span>
        <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
        <span className="text-sm tabular-nums text-muted">{item.price !== null ? usd(item.price) : "no price"}</span>
        <span className="flex items-center gap-1">
          <button type="button" className={small} disabled={first || pending} onClick={() => run(() => reorderPurchaseItem({ id: item.id, dir: "up" }))} aria-label={`Move ${item.name} up`}>↑</button>
          <button type="button" className={small} disabled={last || pending} onClick={() => run(() => reorderPurchaseItem({ id: item.id, dir: "down" }))} aria-label={`Move ${item.name} down`}>↓</button>
          <button type="button" className={`${small} font-medium`} onClick={() => setMode(mode === "buy" ? null : "buy")}>Bought</button>
          <button type="button" className={small} onClick={() => setMode(mode === "more" ? null : "more")} aria-label={`More for ${item.name}`} aria-expanded={mode === "more"}>⋯</button>
        </span>
      </div>
      {mode === "more" && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={small} onClick={() => setMode("edit")}>Edit name or price</button>
          <button type="button" className={small} disabled={pending} onClick={() => run(() => switchPurchaseKind({ id: item.id }), () => setMode(null))}>Move to {other}</button>
          <button type="button" className={`${small} text-danger`} disabled={pending} onClick={() => run(() => removePurchaseItem({ id: item.id }))}>Remove from the list</button>
        </div>
      )}
      {mode === "edit" && <EditForm item={item} onDone={() => setMode(null)} />}
      {mode === "buy" && <BuyForm item={item} categories={categories} accounts={accounts} today={today} onDone={() => setMode(null)} />}
      {msg && <p className="text-sm text-danger">{msg}</p>}
    </div>
  );
}

function EditForm({ item, onDone }: { item: PurchaseItem; onDone: () => void }) {
  const { run, pending, msg } = useAct();
  const [name, setName] = useState(item.name);
  const [price, setPrice] = useState(item.price !== null ? item.price.toFixed(2) : "");
  return (
    <form
      className="flex flex-wrap gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => editPurchaseItem({ id: item.id, name, price }), onDone);
      }}
    >
      <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" className={`${input} min-w-0 flex-1`} maxLength={200} />
      <input value={price} onChange={(e) => setPrice(e.target.value)} aria-label="Price" placeholder="Price (optional)" inputMode="decimal" className={`${input} w-32`} />
      <button disabled={pending} className={small}>Save</button>
      <button type="button" className={small} onClick={onDone}>Cancel</button>
      {msg && <p className="w-full text-sm text-danger">{msg}</p>}
    </form>
  );
}

/** The pre-filled transaction: you check it and save. Nothing is saved until you tap Save. */
function BuyForm({
  item,
  categories,
  accounts,
  today,
  onDone,
}: {
  item: PurchaseItem;
  categories: Opt[];
  accounts: Opt[];
  today: string;
  onDone: () => void;
}) {
  const { run, pending, msg } = useAct();
  const [amount, setAmount] = useState(item.price !== null ? item.price.toFixed(2) : "");
  const [account, setAccount] = useState(accounts[0]?.id ?? "");
  const [category, setCategory] = useState("");
  const [date, setDate] = useState(today);
  const [description, setDescription] = useState(item.name);
  return (
    <form
      className="space-y-2 rounded-md border border-success/30 bg-success-soft p-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => buyPurchaseItem({ id: item.id, amount, accountId: account, categoryId: category, date, description }), onDone);
      }}
    >
      <p className="text-xs text-muted">Check the expense and save it. Change the amount if you paid a different price.</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <input value={amount} onChange={(e) => setAmount(e.target.value)} required inputMode="decimal" placeholder="Amount paid" aria-label="Amount paid" className={input} autoFocus />
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category" className={input}>
          <option value="">No category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select value={account} onChange={(e) => setAccount(e.target.value)} aria-label="Account" className={input}>
          <option value="">Unassigned</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} aria-label="Date" className={input} />
        <input value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Description" className={`${input} col-span-2 sm:col-span-3`} />
        <span className="flex gap-2">
          <button disabled={pending} className="flex-1 rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg shadow-sm hover:bg-accent-hover disabled:opacity-50">
            {pending ? "Saving…" : "Save"}
          </button>
          <button type="button" className={small} onClick={onDone}>Cancel</button>
        </span>
      </div>
      {msg && <p className="text-sm text-danger">{msg}</p>}
    </form>
  );
}

function BoughtList({ list }: { list: PurchaseItem[] }) {
  const { run, pending, msg } = useAct();
  if (list.length === 0) return null;
  return (
    <details className="group">
      <summary className="cursor-pointer text-sm font-medium">
        Bought <span className="font-normal text-muted">· {list.length}</span>
      </summary>
      <ul className="card mt-1.5 divide-y divide-line overflow-hidden">
        {list.slice(0, 50).map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
            <span className="w-14 shrink-0 text-xs text-muted">{i.txn ? day(i.txn.occurred_at) : i.bought_at ? day(i.bought_at) : ""}</span>
            <span className="min-w-0 flex-1 truncate">
              {i.name} <span className="text-xs text-faint">· {KIND_LABEL[i.kind]}</span>
            </span>
            <span className="tabular-nums text-muted">{i.txn ? usd(i.txn.amount) : "transaction removed"}</span>
            <button type="button" className={small} disabled={pending} onClick={() => run(() => undoPurchaseBought({ id: i.id }))} title="Puts it back on its list and removes the transaction">
              Undo
            </button>
          </li>
        ))}
      </ul>
      {msg && <p className="mt-1 text-sm text-danger">{msg}</p>}
    </details>
  );
}
