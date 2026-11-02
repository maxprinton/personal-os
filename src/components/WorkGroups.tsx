"use client";

import { useActionState } from "react";
import { renameTeacher, saveGroupTeacher } from "@/app/work-actions";
import type { ActionState } from "@/app/actions";

const INPUT = "rounded-md border border-line-strong px-2 py-1.5 text-sm";
const GHOST = "rounded-md border border-line-strong px-2.5 py-1 text-xs font-medium transition-colors hover:bg-subtle disabled:opacity-50";

export type GroupRow = { code: string; teacher: string; saved: boolean; classes: number };
export type TeacherRow = { name: string; classes: number; groups: number };

function GroupLine({ g }: { g: GroupRow }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveGroupTeacher, {});
  return (
    <li className="space-y-1 px-3 py-2">
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="code" value={g.code} />
        <span className="w-24 shrink-0 text-sm font-medium">{g.code}</span>
        <input
          name="teacher"
          list="work-people"
          defaultValue={g.teacher}
          placeholder="Teacher"
          autoComplete="off"
          className={`${INPUT} min-w-0 flex-1 basis-40 py-1 text-fg`}
        />
        <button disabled={pending} className={GHOST}>
          {pending ? "…" : "Save"}
        </button>
        <span className="text-xs text-faint">
          {g.classes} {g.classes === 1 ? "class" : "classes"}
          {g.saved ? " · set by you" : g.teacher ? " · from the last class" : ""}
        </span>
      </form>
      {state.error && <p className="text-xs text-danger">{state.error}</p>}
      {state.ok && state.info && <p className="text-xs text-success">{state.info}</p>}
    </li>
  );
}

function NewGroup() {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveGroupTeacher, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 px-3 py-2">
      <input name="code" placeholder="New class code (B2-9)" required autoComplete="off" className={`${INPUT} w-44 py-1`} />
      <input name="teacher" list="work-people" placeholder="Teacher" required autoComplete="off" className={`${INPUT} min-w-0 flex-1 basis-40 py-1`} />
      <button disabled={pending} className={GHOST}>
        {pending ? "…" : "Add"}
      </button>
      {state.error && <span className="basis-full text-xs text-danger">{state.error}</span>}
      {state.ok && state.info && <span className="basis-full text-xs text-success">{state.info}</span>}
    </form>
  );
}

function TeacherLine({ t }: { t: TeacherRow }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(renameTeacher, {});
  return (
    <li className="space-y-1 px-3 py-2">
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="from" value={t.name} />
        <input name="to" defaultValue={t.name} aria-label={`Rename ${t.name}`} autoComplete="off" className={`${INPUT} min-w-0 flex-1 basis-40 py-1 text-fg`} />
        <button disabled={pending} className={GHOST}>
          {pending ? "…" : "Rename"}
        </button>
        <span className="text-xs text-faint">
          {t.classes} {t.classes === 1 ? "class" : "classes"} · {t.groups} {t.groups === 1 ? "code" : "codes"}
        </span>
      </form>
      {state.error && <p className="text-xs text-danger">{state.error}</p>}
      {state.ok && state.info && <p className="text-xs text-success">{state.info}</p>}
    </li>
  );
}

/** Who each class code belongs to now, and the list of teachers (rename to fix a typo everywhere). */
export default function WorkGroups({ groups, teachers, people }: { groups: GroupRow[]; teachers: TeacherRow[]; people: string[] }) {
  return (
    <div className="space-y-4">
      <datalist id="work-people">
        {people.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <div className="space-y-1">
        <h3 className="text-sm font-medium">Class codes → teacher</h3>
        <p className="text-xs text-muted">
          When you add a class, its teacher is filled in from here. Codes get reused: change the teacher and new classes use the new one, while the classes you
          already saved keep theirs (select them in the list to change them in bulk).
        </p>
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface shadow-card">
          {groups.length === 0 && <li className="px-3 py-2 text-sm text-muted">No classes yet.</li>}
          {groups.map((g) => (
            <GroupLine key={g.code} g={g} />
          ))}
          <li>
            <NewGroup />
          </li>
        </ul>
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-medium">Teachers</h3>
        <p className="text-xs text-muted">New teachers appear here as soon as you type their name on a class. Rename one to fix its spelling in every class.</p>
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface shadow-card">
          {teachers.length === 0 && <li className="px-3 py-2 text-sm text-muted">No teachers yet.</li>}
          {teachers.map((t) => (
            <TeacherLine key={t.name} t={t} />
          ))}
        </ul>
      </div>
    </div>
  );
}
