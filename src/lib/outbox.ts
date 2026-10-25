// Offline outbox: captures are stored in IndexedDB when there is no connection
// and sent to /api/capture as soon as the device is back online.

export type OutboxItem = { id: string; text: string; createdAt: string; accountId?: string | null };

const DB = "personal-os";
const STORE = "outbox";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function addToOutbox(text: string, accountId: string | null = null) {
  const item: OutboxItem = { id: crypto.randomUUID(), text, createdAt: new Date().toISOString(), accountId };
  await tx("readwrite", (s) => s.put(item));
  window.dispatchEvent(new Event("outbox-changed"));
  return item;
}

export function listOutbox() {
  return tx<OutboxItem[]>("readonly", (s) => s.getAll() as IDBRequest<OutboxItem[]>);
}

async function remove(id: string) {
  await tx("readwrite", (s) => s.delete(id));
}

let flushing = false;

/** Sends queued items. Returns how many were synced. */
export async function flushOutbox(): Promise<number> {
  if (flushing || !navigator.onLine) return 0;
  flushing = true;
  let sent = 0;
  try {
    const items = (await listOutbox()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const item of items) {
      const res = await fetch("/api/capture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: item.text, accountId: item.accountId ?? null }),
      }).catch(() => null);
      if (!res) break; // still offline
      if (res.ok || res.status === 400) {
        await remove(item.id); // 400 = invalid text, drop it instead of retrying forever
        sent++;
      } else break;
    }
  } finally {
    flushing = false;
    window.dispatchEvent(new Event("outbox-changed"));
  }
  return sent;
}
