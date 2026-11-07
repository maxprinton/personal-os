"use client";
// Slot details: key, project metadata and per-language URL name and texts. Plus feature / archive / delete.
import { deleteSlotAction, saveSlotAction, slotFlagAction } from "@/app/portfolio-actions";
import { LANGS, LANG_LABEL } from "@/lib/portfolio/constants";
import { isSingleton, pathFor, slugFor } from "@/lib/portfolio/slots";
import type { SlotView } from "@/lib/portfolio/types";
import { ActForm, BOX, BTN_DANGER, BTN_PLAIN, BTN_PRIMARY, INPUT, LABEL } from "./ui";

export default function SlotEditor({ slot, everPublished }: { slot: SlotView; everPublished: boolean }) {
  const isProject = slot.kind === "project";
  const m = slot.meta;
  return (
    <div className="space-y-4">
      <ActForm action={saveSlotAction} className="space-y-4">
        {(pending) => (
          <>
            <input type="hidden" name="id" value={slot.id} />
            {!isSingleton(slot.kind) && (
              <div className={BOX}>
                <label className={LABEL}>
                  Name (internal key)
                  <input name="key" defaultValue={slot.key} maxLength={60} className={INPUT} />
                </label>
                <p className="mt-1 text-xs text-muted">
                  {everPublished ? "This slot was published: if you rename it, the old address keeps redirecting to the new one." : "You can rename it freely until the first publish."}
                </p>
              </div>
            )}

            {isProject && (
              <div className={`${BOX} grid grid-cols-1 gap-3 sm:grid-cols-2`}>
                <p className="col-span-full text-sm font-semibold">Project details</p>
                <label className={LABEL}>
                  Status
                  <select name="status" defaultValue={m.status ?? ""} className={INPUT}>
                    <option value="">—</option>
                    <option value="idea">Idea</option>
                    <option value="in_progress">In progress</option>
                    <option value="shipped">Shipped</option>
                    <option value="paused">Paused</option>
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className={LABEL}>
                    From (year)
                    <input name="year_from" inputMode="numeric" defaultValue={m.year_from ?? ""} placeholder="2025" className={INPUT} />
                  </label>
                  <label className={LABEL}>
                    To (empty = ongoing)
                    <input name="year_to" inputMode="numeric" defaultValue={m.year_to ?? ""} className={INPUT} />
                  </label>
                </div>
                <label className={`${LABEL} sm:col-span-2`}>
                  Stack (comma separated)
                  <input name="stack" defaultValue={(m.stack ?? []).join(", ")} placeholder="Next.js, Supabase" className={INPUT} />
                </label>
                <label className={`${LABEL} sm:col-span-2`}>
                  Links (one per line: Label | https://…)
                  <textarea name="links" rows={3} defaultValue={(m.links ?? []).map((l) => `${l.label} | ${l.url}`).join("\n")} className={INPUT} />
                </label>
                <label className={`${LABEL} sm:col-span-2`}>
                  Related YouTube video (address or id, optional)
                  <input name="video" defaultValue={m.video ?? ""} className={INPUT} />
                </label>
              </div>
            )}

            {LANGS.map((lang) => {
              const l = slot.langs?.[lang] ?? {};
              return (
                <div key={lang} className={`${BOX} grid grid-cols-1 gap-3 sm:grid-cols-2`}>
                  <p className="col-span-full text-sm font-semibold">{LANG_LABEL[lang]} texts</p>
                  {!isSingleton(slot.kind) && (
                    <label className={LABEL}>
                      URL name (slug)
                      <input name={`${lang}_slug`} defaultValue={l.slug ?? ""} placeholder={slugFor({ ...slot, langs: {} }, lang)} className={INPUT} />
                      <span className="block text-[11px] text-faint">{pathFor(slot, lang)}</span>
                    </label>
                  )}
                  {isProject && (
                    <label className={LABEL}>
                      Your role
                      <input name={`${lang}_role`} defaultValue={l.role ?? ""} className={INPUT} />
                    </label>
                  )}
                  <label className={`${LABEL} sm:col-span-2`}>
                    One-line summary (lists and sharing)
                    <input name={`${lang}_summary`} defaultValue={l.summary ?? ""} maxLength={400} className={INPUT} />
                  </label>
                  <label className={LABEL}>
                    Search-engine title (optional)
                    <input name={`${lang}_seo_title`} defaultValue={l.seo_title ?? ""} maxLength={120} className={INPUT} />
                  </label>
                  <label className={LABEL}>
                    Search-engine description (optional)
                    <input name={`${lang}_seo_desc`} defaultValue={l.seo_desc ?? ""} maxLength={400} className={INPUT} />
                  </label>
                </div>
              );
            })}
            <button type="submit" disabled={pending} className={BTN_PRIMARY}>
              {pending ? "Saving…" : "Save details"}
            </button>
          </>
        )}
      </ActForm>

      <div className={`${BOX} flex flex-wrap items-center gap-2`}>
        {slot.kind !== "home" && slot.kind !== "about" && slot.kind !== "now" && slot.kind !== "uses" && (
          <ActForm action={slotFlagAction} saved="">
            {(pending) => (
              <>
                <input type="hidden" name="id" value={slot.id} />
                <input type="hidden" name="field" value="featured" />
                <input type="hidden" name="value" value={String(!slot.featured)} />
                <button type="submit" disabled={pending} className={BTN_PLAIN}>
                  {slot.featured ? "Remove from featured" : "Feature on the home page"}
                </button>
              </>
            )}
          </ActForm>
        )}
        <ActForm action={slotFlagAction} saved="">
          {(pending) => (
            <>
              <input type="hidden" name="id" value={slot.id} />
              <input type="hidden" name="field" value="archived" />
              <input type="hidden" name="value" value={String(!slot.archived)} />
              <button type="submit" disabled={pending} className={BTN_PLAIN}>
                {slot.archived ? "Restore" : "Archive"}
              </button>
            </>
          )}
        </ActForm>
        {!everPublished && (
          <ActForm action={deleteSlotAction} saved="" confirm="Delete this slot? Linked notes stay in Notes as normal notes.">
            {(pending) => (
              <>
                <input type="hidden" name="id" value={slot.id} />
                <button type="submit" disabled={pending} className={BTN_DANGER}>
                  Delete slot
                </button>
              </>
            )}
          </ActForm>
        )}
      </div>
    </div>
  );
}
