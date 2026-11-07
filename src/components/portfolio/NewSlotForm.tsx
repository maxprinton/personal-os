"use client";
import { createSlotAction } from "@/app/portfolio-actions";
import { isSingleton, KIND_LABEL } from "@/lib/portfolio/slots";
import { KINDS, type SlotKind } from "@/lib/portfolio/constants";
import { useState } from "react";
import { ActForm, BTN_PRIMARY, INPUT, LABEL } from "./ui";

/** Create a slot. Singleton kinds (Home, About, Now, Uses) that already exist are not offered. */
export default function NewSlotForm({ existing }: { existing: SlotKind[] }) {
  const options = KINDS.filter((k) => !(isSingleton(k) && existing.includes(k)));
  const [kind, setKind] = useState<SlotKind>(options.includes("project") ? "project" : options[0] ?? "project");
  return (
    <ActForm action={createSlotAction} className="flex flex-wrap items-end gap-3" saved="">
      {(pending) => (
        <>
          <label className={LABEL}>
            Kind
            <select name="kind" value={kind} onChange={(e) => setKind(e.target.value as SlotKind)} className={INPUT}>
              {options.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          {!isSingleton(kind) && (
            <label className={`${LABEL} min-w-[12rem] flex-1`}>
              Name (becomes the URL name)
              <input name="name" required maxLength={60} placeholder="personal-os" className={INPUT} />
            </label>
          )}
          <button type="submit" disabled={pending} className={BTN_PRIMARY}>
            {pending ? "Creating…" : "Create slot"}
          </button>
        </>
      )}
    </ActForm>
  );
}
