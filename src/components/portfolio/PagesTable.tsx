// Table of slots with the status of each language.
import Link from "next/link";
import { StatusBadge } from "@/components/portfolio/ui";
import { BASE, LANGS } from "@/lib/portfolio/constants";
import type { SlotView } from "@/lib/portfolio/types";
import { KIND_LABEL } from "@/lib/portfolio/slots";

export default function PagesTable({ slots }: { slots: SlotView[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[34rem] text-left text-sm">
        <thead className="bg-subtle text-xs text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">Slot</th>
            <th className="px-3 py-2 font-medium">English</th>
            <th className="px-3 py-2 font-medium">Español</th>
          </tr>
        </thead>
        <tbody>
          {slots.map((s) => (
            <tr key={s.id} className="border-t border-line">
              <td className="px-3 py-2">
                <Link href={`${BASE}/pages/${s.id}`} className="font-medium hover:underline">
                  {s.kind === s.key ? KIND_LABEL[s.kind] : s.key}
                </Link>
                <span className="ml-2 text-xs text-muted">
                  {s.kind === s.key ? "" : KIND_LABEL[s.kind]}
                  {s.featured ? " · featured" : ""}
                  {s.archived ? " · archived" : ""}
                </span>
              </td>
              {LANGS.map((lang) => (
                <td key={lang} className="px-3 py-2">
                  <StatusBadge status={s.pages[lang].status} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

