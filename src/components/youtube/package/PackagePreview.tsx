"use client";
// Package · Realistic preview: the thumbnail + title as YouTube shows them — Home (big), Sidebar (small) and
// Search — in light and dark, and "in the crowd" next to the saved references' thumbnails (contrast test).
import { useMemo, useState } from "react";
import { fmtViews } from "@/lib/youtube/scoring";
import { previewTitle } from "@/lib/youtube/package";
import type { YtPair, YtVariant } from "@/lib/youtube/types";
import type { CrowdItem } from "@/components/youtube/package/PackageEditor";
import { BOX, Chip } from "@/components/youtube/idea/ui";

type Shown = { title: string; thumb: YtVariant | null };
type View = "home" | "sidebar" | "search" | "crowd";
const VIEWS: { id: View; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "sidebar", label: "Sidebar" },
  { id: "search", label: "Search" },
  { id: "crowd", label: "In the crowd" },
];

// Fixed YouTube-like colors (not app tokens): the preview must look the same whatever the app theme is.
const THEMES = {
  light: { bg: "#ffffff", fg: "#0f0f0f", muted: "#606060", ph: "#e5e5e5" },
  dark: { bg: "#0f0f0f", fg: "#f1f1f1", muted: "#aaaaaa", ph: "#272727" },
} as const;
type Theme = (typeof THEMES)[keyof typeof THEMES];

function ago(iso: string | null) {
  if (!iso) return "";
  const d = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  if (d < 1) return "today";
  if (d < 30) return `${Math.floor(d)} days ago`;
  if (d < 365) return `${Math.floor(d / 30)} months ago`;
  return `${Math.floor(d / 365)} years ago`;
}

function Thumb({ thumb, theme, className }: { thumb: YtVariant | null; theme: Theme; className: string }) {
  if (thumb?.image_url)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={thumb.image_url} alt="" className={`${className} object-cover`} />;
  return (
    <div className={`${className} grid place-items-center overflow-hidden p-1 text-center`} style={{ background: theme.ph, color: theme.muted }}>
      <span className="line-clamp-3 text-[10px] font-bold [text-transform:uppercase] leading-tight">{thumb?.thumb_text || thumb?.value || "No thumbnail yet"}</span>
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  return <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#c00] text-sm font-semibold text-white">{(name[0] ?? "Y").toUpperCase()}</span>;
}

function HomeCard({ title, channel, meta, thumb, image, theme, mine }: { title: string; channel: string; meta: string; thumb?: YtVariant | null; image?: string; theme: Theme; mine?: boolean }) {
  return (
    <div className={`w-full space-y-2 ${mine ? "rounded-xl outline outline-2 outline-offset-4 outline-[#3ea6ff]" : ""}`}>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="aspect-video w-full rounded-xl object-cover" loading="lazy" />
      ) : (
        <Thumb thumb={thumb ?? null} theme={theme} className="aspect-video w-full rounded-xl" />
      )}
      <div className="flex gap-2">
        <Avatar name={channel} />
        <div className="min-w-0">
          <p className="line-clamp-2 text-[14px] font-semibold leading-5" style={{ color: theme.fg }}>{title}</p>
          <p className="text-[12px]" style={{ color: theme.muted }}>{channel}</p>
          <p className="text-[12px]" style={{ color: theme.muted }}>{meta}</p>
        </div>
      </div>
    </div>
  );
}

function Frame({ theme, label, children }: { theme: Theme; label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 flex-1 space-y-1">
      <p className="text-[11px] text-faint">{label}</p>
      <div className="rounded-lg border border-line p-3" style={{ background: theme.bg, fontFamily: "Roboto, Arial, sans-serif" }}>
        {children}
      </div>
    </div>
  );
}

function Render({ view, s, theme, channel, crowd }: { view: View; s: Shown; theme: Theme; channel: string; crowd: CrowdItem[] }) {
  const meta = "12K views · 2 days ago";
  if (view === "home")
    return (
      <div className="max-w-[360px]">
        <HomeCard title={s.title} channel={channel} meta={meta} thumb={s.thumb} theme={theme} />
      </div>
    );
  if (view === "sidebar")
    return (
      <div className="flex max-w-[402px] gap-2">
        <Thumb thumb={s.thumb} theme={theme} className="h-[94px] w-[168px] shrink-0 rounded-lg" />
        <div className="min-w-0">
          <p className="line-clamp-2 text-[14px] font-semibold leading-5" style={{ color: theme.fg }}>{previewTitle(s.title, 70)}</p>
          <p className="text-[12px]" style={{ color: theme.muted }}>{channel}</p>
          <p className="text-[12px]" style={{ color: theme.muted }}>{meta}</p>
        </div>
      </div>
    );
  if (view === "search")
    return (
      <div className="flex flex-col gap-3 sm:flex-row">
        <Thumb thumb={s.thumb} theme={theme} className="aspect-video w-full shrink-0 rounded-xl sm:w-[300px]" />
        <div className="min-w-0 space-y-1">
          <p className="line-clamp-2 text-[17px] leading-6" style={{ color: theme.fg }}>{s.title}</p>
          <p className="text-[12px]" style={{ color: theme.muted }}>{meta}</p>
          <p className="flex items-center gap-2 text-[12px]" style={{ color: theme.muted }}>
            <span className="grid h-6 w-6 place-items-center rounded-full bg-[#c00] text-[10px] text-white">{(channel[0] ?? "Y").toUpperCase()}</span>
            {channel}
          </p>
        </div>
      </div>
    );
  // crowd: yours in the 2nd slot among the references
  const others = crowd.slice(0, 5);
  const cells: React.ReactNode[] = others.map((c) => (
    <HomeCard key={c.id} title={c.title} channel={c.channel || "Channel"} meta={`${c.views != null ? `${fmtViews(c.views)} views` : ""}${c.published_at ? ` · ${ago(c.published_at)}` : ""}`} image={c.image} theme={theme} />
  ));
  cells.splice(Math.min(1, cells.length), 0, <HomeCard key="mine" title={s.title} channel={channel} meta={meta} thumb={s.thumb} theme={theme} mine />);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-x-3 gap-y-5 md:grid-cols-3">{cells}</div>
      {others.length === 0 && <p className="text-[12px]" style={{ color: theme.muted }}>Save outlier references in Idea → Topic to see yours next to them.</p>}
    </div>
  );
}

export default function PackagePreview({ titles, thumbs, pairs, crowd, channel }: { titles: YtVariant[]; thumbs: YtVariant[]; pairs: YtPair[]; crowd: CrowdItem[]; channel: string }) {
  const options = useMemo(() => {
    const out: { key: string; label: string; s: Shown }[] = pairs
      .filter((p) => p.title_id || p.thumbnail_id)
      .map((p) => ({
        key: p.id,
        label: `Pair ${p.label}${p.is_primary ? " (primary)" : ""}`,
        s: { title: titles.find((t) => t.id === p.title_id)?.value ?? "Untitled", thumb: thumbs.find((t) => t.id === p.thumbnail_id) ?? null },
      }));
    if (!out.length && (titles.length || thumbs.length)) out.push({ key: "first", label: "Title 1 + concept 1", s: { title: titles[0]?.value ?? "Untitled", thumb: thumbs[0] ?? null } });
    return out;
  }, [pairs, titles, thumbs]);
  const primary = pairs.find((p) => p.is_primary)?.id;
  const [pick, setPick] = useState<string | null>(null);
  const [view, setView] = useState<View>("home");
  const cur = options.find((o) => o.key === pick) ?? options.find((o) => o.key === primary) ?? options[0];
  return (
    <div className={BOX}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Preview</h3>
        {options.length > 1 && (
          <select className="rounded-md border border-line-strong bg-surface px-2 py-1 text-sm text-fg" value={cur?.key} onChange={(e) => setPick(e.target.value)} aria-label="Pair to preview">
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </div>
      {!cur ? (
        <p className="text-xs text-muted">Write a title and a thumbnail concept to see the preview.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {VIEWS.map((v) => (
              <Chip key={v.id} on={view === v.id} onClick={() => setView(v.id)}>
                {v.label}
              </Chip>
            ))}
          </div>
          <div className="flex flex-col gap-3 xl:flex-row">
            <Frame theme={THEMES.light} label="Light">
              <Render view={view} s={cur.s} theme={THEMES.light} channel={channel} crowd={crowd} />
            </Frame>
            <Frame theme={THEMES.dark} label="Dark">
              <Render view={view} s={cur.s} theme={THEMES.dark} channel={channel} crowd={crowd} />
            </Frame>
          </div>
          {view === "sidebar" && <p className="text-[11px] text-faint">Clarity test: can you read every word and spot every element at this size?</p>}
          {view === "crowd" && <p className="text-[11px] text-faint">Contrast test: does yours (blue outline) stand out and break the pattern?</p>}
        </>
      )}
    </div>
  );
}
