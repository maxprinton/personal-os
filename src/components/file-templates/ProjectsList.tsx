"use client";
// Template Manager add-on, phase 3 — the list of project profiles, "My details" and a box to start a new profile.
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ensureProjectAction, saveProjectAction } from "@/app/file-template-project-actions";
import { BASE } from "@/lib/file-templates/constants";
import { fold } from "@/lib/file-templates/query";
import { BOX, BTN_PRIMARY, BTN_SMALL, INPUT } from "./ui";

export type ProjectRow = {
  id: string;
  name: string;
  code: string | null;
  archived: boolean;
  updated_at: string;
  fill: { core: number; coreTotal: number; lists: number };
  copies: number;
  outdated: number;
  goal: string;
};

export default function ProjectsList({ rows, hasDefaults, unlinked }: { rows: ProjectRow[]; hasDefaults: boolean; unlinked: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  const create = (n: string) =>
    start(async () => {
      const r = await ensureProjectAction(n);
      if (!r.ok) return setMsg({ text: r.error, bad: true });
      router.push(`${BASE}/projects/${r.id}`);
    });

  const words = fold(q).split(/\s+/).filter(Boolean);
  const shown = rows.filter((r) => (showArchived || !r.archived) && words.every((w) => fold(`${r.name} ${r.code ?? ""} ${r.goal}`).includes(w)));
  const archived = rows.filter((r) => r.archived).length;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-[1fr_20rem]">
        <form
          className={`${BOX} space-y-2`}
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create(name);
          }}
        >
          <h3 className="text-sm font-semibold">New project profile</h3>
          <p className="text-xs text-muted">Type the project&apos;s name. It starts with your details (organization, you as project manager…); add the rest once and every template you copy for it comes out filled.</p>
          <div className="flex gap-2">
            <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} placeholder="Campus Wi-Fi upgrade" aria-label="Project name" />
            <button className={BTN_PRIMARY} disabled={pending || !name.trim()}>{pending ? "Creating…" : "Create"}</button>
          </div>
        </form>
        <Link href={`${BASE}/projects/me`} className={`${BOX} block space-y-1 hover:border-accent`}>
          <h3 className="text-sm font-semibold">My details →</h3>
          <p className="text-xs text-muted">{hasDefaults ? "Your organization, name and usual approach: copied into every new profile." : "Not set yet. Add your organization and name once; every new profile starts with them."}</p>
        </Link>
      </div>

      {msg && <p role="status" className={`rounded-md border px-3 py-2 text-sm ${msg.bad ? "border-danger bg-danger-soft text-danger" : "border-line bg-subtle"}`}>{msg.text}</p>}

      {unlinked.length > 0 && (
        <div className="space-y-2 rounded-lg border border-line bg-subtle p-3 text-sm">
          <p>Projects from your earlier working copies, without a profile yet:</p>
          <div className="flex flex-wrap gap-2">
            {unlinked.map((n) => <button key={n} type="button" className={BTN_SMALL} disabled={pending} onClick={() => create(n)}>+ {n}</button>)}
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line p-6 text-sm text-muted">No project profiles yet. Create one above, or type a new project name when you make a working copy: the profile is created for you.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input className={`${INPUT} max-w-sm`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects…" aria-label="Search projects" />
            {archived > 0 && (
              <label className="flex items-center gap-1.5 text-xs text-muted">
                <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived ({archived})
              </label>
            )}
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((r) => (
              <li key={r.id} className={`${BOX} flex flex-col gap-2 ${r.archived ? "opacity-60" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <Link href={`${BASE}/projects/${r.id}`} className="font-medium hover:underline">
                    {r.code && <span className="mr-1.5 font-mono text-xs text-muted">{r.code}</span>}
                    {r.name}
                  </Link>
                  {r.outdated > 0 && <span className="whitespace-nowrap rounded-full border border-warning px-2 py-0.5 text-xs text-warning">{r.outdated} out of date</span>}
                </div>
                {r.goal && <p className="line-clamp-2 text-xs text-muted">{r.goal}</p>}
                <div className="mt-auto space-y-1">
                  <div className="h-1.5 overflow-hidden rounded-full bg-subtle" aria-hidden>
                    <div className="h-full bg-accent" style={{ width: `${Math.round((r.fill.core / r.fill.coreTotal) * 100)}%` }} />
                  </div>
                  <p className="text-xs text-muted">
                    {r.fill.core} of {r.fill.coreTotal} core details · {r.fill.lists} plan lists · {r.copies} cop{r.copies === 1 ? "y" : "ies"}
                  </p>
                  <div className="flex gap-2">
                    <Link href={`${BASE}/projects/${r.id}`} className={BTN_SMALL}>Open</Link>
                    <button type="button" className={`${BTN_SMALL} text-muted`} disabled={pending} onClick={() => start(async () => {
                      const res = await saveProjectAction(r.id, { archived: !r.archived });
                      if (!res.ok) setMsg({ text: res.error, bad: true });
                      else router.refresh();
                    })}>{r.archived ? "Unarchive" : "Archive"}</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
