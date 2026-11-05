"use client";
// Package · Thumbnail concepts (up to 3) with the 3 C's (contents, composition, contrast), the curiosity-gap
// type, scroll stoppers (warning past 3), short text and an image (upload → small WebP in note-files, or a link).
// Also the final tests checklist (Clarity, Contrast, Glance, Bonus = 3 variations) per concept.
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addVariant, archiveVariant, updateVariant, type VariantPatch } from "@/app/youtube-actions/package";
import { uploadNoteFile } from "@/lib/note-files";
import { COMPOSITIONS, CONTRAST_KINDS, GAP_TYPES, MAX_THUMBNAILS, SCROLL_STOPPERS, THUMB_TESTS } from "@/lib/youtube/constants";
import { fitInside, thumbTestsPassed, thumbWarnings } from "@/lib/youtube/package";
import type { ThumbTests, YtPair, YtVariant, YtVideo } from "@/lib/youtube/types";
import { AutoField, BOX, BTN, BTN_SM, Chip, LABEL, Msg, Warn } from "@/components/youtube/idea/ui";

export default function ThumbsBox({ video, thumbs }: { video: YtVideo; thumbs: YtVariant[] }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const add = () =>
    start(async () => {
      setErr(null);
      const r = await addVariant(video.id, "thumbnail", "");
      if (r.error) setErr(r.error);
      else router.refresh();
    });
  return (
    <div className={BOX}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">
          Thumbnail concepts <span className="font-normal text-muted">({thumbs.length}/{MAX_THUMBNAILS})</span>
        </h3>
        <button type="button" className={BTN} disabled={pending || thumbs.length >= MAX_THUMBNAILS} onClick={add}>
          + Concept
        </button>
      </div>
      {thumbs.length === 0 && <p className="text-xs text-muted">Sketch up to 3 concepts. Each one: a curiosity-gap type, a focal point, a composition, contrast and at most 2–3 scroll stoppers.</p>}
      <div className="space-y-4">
        {thumbs.map((t, i) => (
          <Concept key={t.id} t={t} n={i + 1} />
        ))}
      </div>
      <Msg error={err} />
    </div>
  );
}

function toggle(list: string[], id: string) {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function Concept({ t, n }: { t: YtVariant; n: number }) {
  const router = useRouter();
  const [gap, setGap] = useState<string | null>(t.gap_type);
  const [comp, setComp] = useState<string | null>(t.composition);
  const [contrast, setContrast] = useState<string[]>(t.contrast ?? []);
  const [stoppers, setStoppers] = useState<string[]>(t.stoppers ?? []);
  const [text, setText] = useState(t.thumb_text ?? "");
  const [focal, setFocal] = useState(t.focal ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = async (patch: VariantPatch) => {
    const r = await updateVariant(t.id, patch);
    if (r.error) setErr(r.error);
    else {
      setErr(null);
      router.refresh();
    }
    return r.error ?? null;
  };
  const warns = thumbWarnings({ stoppers, thumb_text: text, focal, gap_type: gap });
  return (
    <div className="space-y-3 rounded-md border border-line p-3">
      <div className="flex items-start gap-2">
        <span className="mt-1.5 text-xs font-semibold text-faint">#{n}</span>
        <div className="flex-1">
          <AutoField value={t.value} maxLength={120} label={`Concept ${n} name`} placeholder="Short name of the concept" onSave={(v) => save({ value: v })} />
        </div>
        <button
          type="button"
          className={`${BTN_SM} mt-1`}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await archiveVariant(t.id);
              if (r.error) setErr(r.error);
              else router.refresh();
            })
          }
        >
          Remove
        </button>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_16rem]">
        <div className="space-y-3">
          <div className="space-y-1">
            <p className="text-xs text-muted">Curiosity-gap type</p>
            <div className="flex flex-wrap gap-1.5">
              {GAP_TYPES.map((g) => (
                <Chip
                  key={g.id}
                  on={gap === g.id}
                  title={g.hint}
                  onClick={() => {
                    const v = gap === g.id ? null : g.id;
                    setGap(v);
                    void save({ gap_type: v });
                  }}
                >
                  {g.label}
                </Chip>
              ))}
            </div>
            {gap && <p className="text-[11px] text-faint">{GAP_TYPES.find((g) => g.id === gap)?.hint}</p>}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={LABEL} onInput={(e) => setFocal((e.target as HTMLInputElement).value)}>
              Focal point (main character)
              <AutoField value={t.focal ?? ""} maxLength={500} label="Focal point" onSave={(v) => save({ focal: v })} />
            </label>
            <label className={LABEL}>
              Supporting elements (help open the gap)
              <AutoField value={t.supporting ?? ""} maxLength={500} label="Supporting elements" onSave={(v) => save({ supporting: v })} />
            </label>
          </div>
          <div className="flex flex-wrap gap-4">
            <div className="space-y-1">
              <p className="text-xs text-muted">Composition</p>
              <div className="flex flex-wrap gap-1.5">
                {COMPOSITIONS.map((c) => (
                  <Chip
                    key={c}
                    on={comp === c}
                    onClick={() => {
                      const v = comp === c ? null : c;
                      setComp(v);
                      void save({ composition: v });
                    }}
                  >
                    {c}
                  </Chip>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted">Contrast</p>
              <div className="flex flex-wrap gap-1.5">
                {CONTRAST_KINDS.map((c) => (
                  <Chip
                    key={c.id}
                    on={contrast.includes(c.id)}
                    title={c.hint}
                    onClick={() => {
                      const v = toggle(contrast, c.id);
                      setContrast(v);
                      void save({ contrast: v });
                    }}
                  >
                    {c.label}
                  </Chip>
                ))}
              </div>
            </div>
          </div>
          <p className="text-[11px] text-faint">Direct the eye with lines, red arrows, scale differences, blur and depth.</p>
          <div className="space-y-1">
            <p className="text-xs text-muted">Scroll stoppers ({stoppers.length}) — use few</p>
            <div className="flex flex-wrap gap-1.5">
              {SCROLL_STOPPERS.map((s) => (
                <Chip
                  key={s.id}
                  on={stoppers.includes(s.id)}
                  onClick={() => {
                    const v = toggle(stoppers, s.id);
                    setStoppers(v);
                    void save({ stoppers: v });
                  }}
                >
                  {s.label}
                </Chip>
              ))}
            </div>
          </div>
          <label className={LABEL} onInput={(e) => setText((e.target as HTMLInputElement).value)}>
            Text on the thumbnail (1–4 words, must not repeat the title)
            <AutoField value={t.thumb_text ?? ""} maxLength={80} label="Text on the thumbnail" onSave={(v) => save({ thumb_text: v })} />
          </label>
          <div className="space-y-0.5">
            {warns.map((w) => (
              <Warn key={w.text} level={w.level}>
                {w.text}
              </Warn>
            ))}
          </div>
        </div>
        <ThumbImage t={t} onSave={save} />
      </div>
      <Msg error={err} />
    </div>
  );
}

/** Shrinks a picture to at most 1280×720 and turns it into WebP (small file for the note-files bucket). */
async function toSmallWebp(file: File): Promise<File> {
  const bmp = await createImageBitmap(file);
  const size = fitInside(bmp.width, bmp.height, 1280, 720);
  const canvas = document.createElement("canvas");
  canvas.width = size.w;
  canvas.height = size.h;
  canvas.getContext("2d")?.drawImage(bmp, 0, 0, size.w, size.h);
  bmp.close?.();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.82));
  if (!blob) return file;
  const base = (file.name || "thumbnail").replace(/\.[^.]+$/, "");
  return new File([blob], `${base}.webp`, { type: "image/webp" });
}

function ThumbImage({ t, onSave }: { t: YtVariant; onSave: (p: VariantPatch) => Promise<string | null> }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setErr("Choose an image.");
    setBusy(true);
    setErr(null);
    try {
      const small = await toSmallWebp(file);
      const up = await uploadNoteFile(small);
      if (!up) setErr("Upload failed. Try again.");
      else {
        const e = await onSave({ image_url: up.url });
        if (e) setErr(e);
      }
    } catch {
      setErr("Couldn't read that image.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div className="space-y-2">
      <div
        className="aspect-video w-full overflow-hidden rounded-md border border-dashed border-line-strong bg-subtle"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void upload(e.dataTransfer.files?.[0]);
        }}
      >
        {t.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={t.image_url} alt={`Thumbnail ${t.value}`} className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full place-items-center p-2 text-center text-[11px] text-faint">Drop an image or a sketch here</div>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={BTN_SM} disabled={busy} onClick={() => input.current?.click()}>
          {busy ? "Uploading…" : t.image_url ? "Replace image" : "Upload image"}
        </button>
        {t.image_url && (
          <button type="button" className={BTN_SM} disabled={busy} onClick={() => void onSave({ image_url: null })}>
            Remove image
          </button>
        )}
        <input ref={input} type="file" accept="image/*" hidden onChange={(e) => void upload(e.target.files?.[0])} />
      </div>
      <AutoField value={t.image_url?.startsWith("/api/files/") ? "" : t.image_url ?? ""} placeholder="…or paste an image link (https://)" label="Image link" onSave={(v) => onSave({ image_url: v })} />
      <p className="text-[10px] text-faint">Uploads are shrunk to 1280×720 WebP.</p>
      <Msg error={err} />
    </div>
  );
}

/** Final tests per concept. The package's primary thumbnail must pass Clarity, Contrast and Glance. */
export function FinalTests({ thumbs, pairs }: { thumbs: YtVariant[]; pairs: YtPair[] }) {
  const primaryThumb = pairs.find((p) => p.is_primary)?.thumbnail_id ?? null;
  return (
    <div className={BOX}>
      <h3 className="text-sm font-semibold">Final tests</h3>
      <p className="text-xs text-muted">Use the preview above (sidebar size, next to the crowd). Tick a test when every question is a yes.</p>
      {thumbs.length === 0 && <p className="text-xs text-faint">Add a thumbnail concept first.</p>}
      <div className="grid gap-3 md:grid-cols-3">
        {thumbs.map((t) => (
          <TestCard key={t.id} t={t} variations={thumbs.length} primary={t.id === primaryThumb} />
        ))}
      </div>
    </div>
  );
}

function TestCard({ t, variations, primary }: { t: YtVariant; variations: number; primary: boolean }) {
  const router = useRouter();
  const [tests, setTests] = useState<ThumbTests>(t.tests ?? {});
  const [err, setErr] = useState<string | null>(null);
  const res = thumbTestsPassed(tests, variations);
  const set = async (next: ThumbTests) => {
    setTests(next);
    const r = await updateVariant(t.id, { tests: next });
    if (r.error) setErr(r.error);
    else router.refresh();
    return r.error ?? null;
  };
  return (
    <div className={`space-y-2 rounded-md border p-3 ${primary ? "border-accent" : "border-line"}`}>
      <p className="text-sm font-medium">
        {t.value} {primary && <span className="text-[11px] font-normal text-accent">· primary</span>}
        <span className="ml-1 text-xs text-muted">
          {res.passed}/{res.total}
        </span>
      </p>
      <ul className="space-y-1.5">
        {THUMB_TESTS.map((x) => {
          const auto = x.id === "bonus" && variations >= 3;
          const on = auto || !!tests[x.id];
          return (
            <li key={x.id}>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5" checked={on} disabled={auto} onChange={(e) => void set({ ...tests, [x.id]: e.target.checked })} />
                <span>
                  {x.label}
                  {auto && <span className="text-[11px] text-success"> · 3 variations</span>}
                  <span className="block text-[11px] text-faint">{x.questions.join(" ")}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <AutoField value={t.tests?.notes ?? ""} multiline rows={2} placeholder="Notes (what to fix)" label="Test notes" onSave={(v) => set({ ...tests, notes: v })} />
      <Msg error={err} />
    </div>
  );
}
