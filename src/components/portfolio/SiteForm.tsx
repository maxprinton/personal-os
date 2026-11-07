"use client";
import { saveSiteAction } from "@/app/portfolio-actions";
import type { SiteSettings } from "@/lib/portfolio/site";
import { ActForm, BOX, BTN_PRIMARY, INPUT, LABEL } from "./ui";

export default function SiteForm({ site }: { site: SiteSettings }) {
  return (
    <ActForm action={saveSiteAction} className="space-y-4">
      {(pending) => (
        <>
          <div className={`${BOX} grid grid-cols-1 gap-3 sm:grid-cols-2`}>
            <p className="col-span-full text-sm font-semibold">Identity</p>
            <label className={`${LABEL} sm:col-span-2`}>
              Name shown on the site
              <input name="name" required defaultValue={site.name} maxLength={80} className={INPUT} />
            </label>
            <label className={LABEL}>
              Tagline (English)
              <input name="tagline_en" defaultValue={site.tagline.en ?? ""} maxLength={160} className={INPUT} />
            </label>
            <label className={LABEL}>
              Tagline (Español)
              <input name="tagline_es" defaultValue={site.tagline.es ?? ""} maxLength={160} className={INPUT} />
            </label>
            <label className={`${LABEL} sm:col-span-2`}>
              Links (one per line: Label | https://…)
              <textarea name="links" rows={3} defaultValue={site.links.map((l) => `${l.label} | ${l.url}`).join("\n")} className={INPUT} />
            </label>
          </div>

          <div className={`${BOX} grid grid-cols-1 gap-3 sm:grid-cols-2`}>
            <p className="col-span-full text-sm font-semibold">Languages</p>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="lang_en" defaultChecked={site.langs.includes("en")} /> English
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="lang_es" defaultChecked={site.langs.includes("es")} /> Español
            </label>
            <label className={LABEL}>
              Default language
              <select name="default_lang" defaultValue={site.default_lang} className={INPUT}>
                <option value="en">English</option>
                <option value="es">Español</option>
              </select>
            </label>
          </div>

          <div className={`${BOX} space-y-3`}>
            <p className="text-sm font-semibold">Site features</p>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="contact_enabled" defaultChecked={site.contact_enabled} /> Contact form
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="analytics_enabled" defaultChecked={site.analytics_enabled} /> Visitor analytics (no cookies)
            </label>
          </div>

          <div className={`${BOX} space-y-2`}>
            <p className="text-sm font-semibold">Never-public words</p>
            <p className="text-xs text-muted">Names, places or clients that must not appear on the site. A page containing one gets a warning when you publish. Never shown to visitors.</p>
            <textarea name="blocked_words" rows={3} defaultValue={site.blocked_words.join("\n")} placeholder="One per line or separated by commas" className={INPUT} />
          </div>

          <button type="submit" disabled={pending} className={BTN_PRIMARY}>
            {pending ? "Saving…" : "Save settings"}
          </button>
        </>
      )}
    </ActForm>
  );
}
