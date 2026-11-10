"use client";
// Template Manager add-on, phase 2 — every working copy, by project.
import Link from "next/link";
import { useMemo, useState } from "react";
import Icon from "@/components/ui/Icon";
import { BASE } from "@/lib/file-templates/constants";
import { fileUrl, fold, sortVersions } from "@/lib/file-templates/query";
import type { TmCopy } from "@/lib/file-templates/types";
import { BTN_SMALL, INPUT, SELECT } from "./ui";

const STATUS: Record<TmCopy["status"], string> = { active: "In progress", done: "Done", archived: "Archived" };

export default function CopiesList({ copies }: { copies: TmCopy[] }) {
  const [q, setQ] = useState("");
  const [project, setProject] = useState("all");
  const [status, setStatus] = useState<"open" | TmCopy["status"] | "all">("open");
  const projects = useMemo(() => [...new Set(copies.map((c) => c.project).filter((p): p is string => !!p))].sort((a, b) => a.localeCompare(b)), [copies]);

  const shown = copies.filter((c) => {
    if (project !== "all" && (c.project ?? "") !== (project === "none" ? "" : project)) return false;
    if (status === "open" ? c.status === "archived" : status !== "all" && c.status !== status) return false;
    const words = fold(q).split(/\s+/).filter(Boolean);
    const hay = fold([c.title, c.project, c.notes, c.tm_templates?.code, c.tm_templates?.name, c.tm_templates?.name_es].filter(Boolean).join(" "));
    return words.every((w) => hay.includes(w));
  });

  if (!copies.length) {
    return (
      <p className="rounded-lg border border-dashed border-line p-6 text-sm text-muted">
        No working copies yet. Open any template in the <Link href={BASE} className="text-accent hover:underline">Library</Link> and press <b>Make a working copy</b>: you get a copy for your project, and every time you upload it back it becomes a new version.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <Icon name="search" size={16} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search copies, projects or templates…" className={`${INPUT} pl-8`} aria-label="Search working copies" />
        </div>
        <select value={project} onChange={(e) => setProject(e.target.value)} className={SELECT} aria-label="Project">
          <option value="all">All projects</option>
          {projects.map((p) => <option key={p} value={p}>{p}</option>)}
          <option value="none">No project</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={SELECT} aria-label="Status">
          <option value="open">In progress and done</option>
          <option value="active">In progress</option>
          <option value="done">Done</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </select>
      </div>
      <p className="text-sm text-muted">{shown.length} of {copies.length} working copies</p>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-subtle text-left text-xs text-muted">
            <tr><th className="p-2">Working copy</th><th className="p-2">Project</th><th className="p-2">Template</th><th className="p-2">Latest</th><th className="p-2">Status</th><th className="p-2" /></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {shown.map((c) => {
              const latest = sortVersions(c.tm_files ?? [])[0];
              return (
                <tr key={c.id} className="align-top hover:bg-subtle/50">
                  <td className="p-2"><Link href={`${BASE}/copies/${c.id}`} className="font-medium hover:underline">{c.title}</Link></td>
                  <td className="p-2 text-muted">{c.project ?? "—"}</td>
                  <td className="p-2">
                    {c.tm_templates ? (
                      <Link href={`${BASE}/${c.tm_templates.id}`} className="text-muted hover:text-fg hover:underline">
                        {c.tm_templates.code && <span className="mr-1 font-mono text-xs">{c.tm_templates.code}</span>}{c.tm_templates.name}
                      </Link>
                    ) : "—"}
                  </td>
                  <td className="whitespace-nowrap p-2 text-muted">{latest ? `v${latest.version} · ${latest.created_at.slice(0, 10)}` : "—"}</td>
                  <td className="p-2"><span className={`rounded-full border px-2 py-0.5 text-xs ${c.status === "done" ? "border-success text-success" : c.status === "archived" ? "border-line text-muted" : "border-accent text-accent"}`}>{STATUS[c.status]}</span></td>
                  <td className="p-2 text-right">{latest && <a href={fileUrl(latest.storage_path, true)} className={BTN_SMALL}><Icon name="import" size={13} /> Download</a>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
