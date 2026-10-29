"use client";

// Notion's emoji picker: search, categories, 🔀 random, Remove, and (for page icons) Upload / Link.
import { useMemo, useRef, useState } from "react";
import { allEmoji, EMOJI_CATEGORIES, randomEmoji, searchEmoji } from "@/lib/editor/emoji";

const RECENT = "pos-emoji-recent";
function recent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT) ?? "[]") as string[];
  } catch {
    return [];
  }
}
function remember(e: string) {
  try {
    localStorage.setItem(RECENT, JSON.stringify([e, ...recent().filter((x) => x !== e)].slice(0, 16)));
  } catch {}
}

export default function EmojiPicker({
  onPick,
  onRemove,
  onUpload,
  allowLink,
}: {
  onPick: (emojiOrUrl: string) => void;
  onRemove?: () => void;
  /** Page icons can also be an uploaded image. */
  onUpload?: (file: File) => Promise<string | null>;
  allowLink?: boolean;
}) {
  const [tab, setTab] = useState<"emoji" | "upload" | "link">("emoji");
  const [q, setQ] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const results = useMemo(() => (q.trim() ? searchEmoji(q, 200) : null), [q]);
  const pick = (e: string) => {
    remember(e);
    onPick(e);
  };
  const recents = recent();

  return (
    <div className="n-emoji">
      <div className="n-emoji-tabs">
        <button type="button" className={tab === "emoji" ? "is-on" : ""} onClick={() => setTab("emoji")}>Emoji</button>
        {onUpload && <button type="button" className={tab === "upload" ? "is-on" : ""} onClick={() => setTab("upload")}>Upload</button>}
        {allowLink && <button type="button" className={tab === "link" ? "is-on" : ""} onClick={() => setTab("link")}>Link</button>}
        <span className="flex-1" />
        {onRemove && (
          <button type="button" className="n-emoji-remove" onClick={onRemove}>
            Remove
          </button>
        )}
      </div>
      {tab === "emoji" && (
        <>
          <div className="flex gap-1.5 p-2">
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" className="n-input flex-1" onKeyDown={(e) => e.key === "Enter" && results?.[0] && pick(results[0].char)} />
            <button type="button" title="Random" className="n-icon-btn" onClick={() => pick(randomEmoji())}>
              🔀
            </button>
          </div>
          <div className="n-emoji-grid-wrap">
            {results ? (
              <>
                {results.length === 0 && <p className="px-3 py-2 text-sm text-faint">No results</p>}
                <Grid items={results.map((e) => ({ char: e.char, name: e.name }))} onPick={pick} />
              </>
            ) : (
              <>
                {recents.length > 0 && (
                  <>
                    <p className="n-menu-label">Recent</p>
                    <Grid items={recents.map((c) => ({ char: c, name: c }))} onPick={pick} />
                  </>
                )}
                {EMOJI_CATEGORIES.map((c) => (
                  <div key={c.key}>
                    <p className="n-menu-label">{c.label}</p>
                    <Grid items={allEmoji().filter((e) => e.cat === c.key)} onPick={pick} />
                  </div>
                ))}
              </>
            )}
          </div>
        </>
      )}
      {tab === "upload" && onUpload && (
        <div className="space-y-2 p-3">
          <button type="button" disabled={busy} onClick={() => file.current?.click()} className="n-btn w-full">
            {busy ? "Uploading…" : "Upload an image"}
          </button>
          <p className="text-xs text-faint">Recommended size is 280 × 280 pixels.</p>
          <input
            ref={file}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setBusy(true);
              const url = await onUpload(f);
              setBusy(false);
              if (url) onPick(url);
            }}
          />
        </div>
      )}
      {tab === "link" && (
        <form
          className="space-y-2 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (/^https?:\/\//.test(link.trim())) onPick(link.trim());
          }}
        >
          <input autoFocus value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste link to an image…" className="n-input w-full" />
          <button className="n-btn n-btn-primary w-full">Submit</button>
        </form>
      )}
    </div>
  );
}

function Grid({ items, onPick }: { items: { char: string; name: string }[]; onPick: (c: string) => void }) {
  return (
    <div className="n-emoji-grid">
      {items.map((e, i) => (
        <button key={`${e.char}-${i}`} type="button" title={e.name} onClick={() => onPick(e.char)}>
          {e.char}
        </button>
      ))}
    </div>
  );
}
