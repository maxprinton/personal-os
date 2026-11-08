// Portfolio publishing — the warnings a publish can show. One entry per kind of problem: how bad it is and how it reads.
// error = blocks publishing · warning = needs a confirm · info = just FYI.

export type Level = "error" | "warning" | "info";
export type Warning = { code: string; level: Level; message: string; count: number; detail?: string[] };

const s = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const WARN_DEFS: Record<string, { level: Level; text: (n: number) => string }> = {
  // — blocks —
  empty_title: { level: "error", text: () => "The page has no title." },
  empty_body: { level: "error", text: () => "The page has no content." },
  bad_slug: { level: "error", text: () => "The address (slug) is not valid. Use lowercase letters, numbers and hyphens." },
  no_note: { level: "error", text: () => "There is no note linked to this page." },
  note_trashed: { level: "error", text: () => "The linked note is in the trash." },
  duplicate_slug: { level: "error", text: () => "Another page in this language already uses this address." },
  blob_upload: { level: "error", text: (n) => `${n} ${s(n, "image is", "images are")} still uploading or unsaved. Wait for it to finish, then try again.` },
  media_too_big: { level: "error", text: (n) => `${n} ${s(n, "file is", "files are")} over the size limit (10 MB, or 25 MB for audio and ZIP).` },
  media_failed: { level: "error", text: (n) => `${n} ${s(n, "file", "files")} could not be copied to the public site.` },
  media_unsafe: { level: "error", text: (n) => `${n} ${s(n, "file was", "files were")} blocked because ${s(n, "it contains", "they contain")} scripts, macros or outside links.` },
  media_type: { level: "error", text: (n) => `${n} ${s(n, "file has", "files have")} a type the public site does not accept.` },
  video_file: { level: "error", text: (n) => `${n} uploaded ${s(n, "video", "videos")} can't be published. Upload to YouTube and embed the link instead.` },
  // — needs a confirm —
  unchecked_todo: { level: "warning", text: (n) => `${n} unchecked to-do ${s(n, "item", "items")} will show as an open list.` },
  private_link: { level: "warning", text: (n) => `${n} ${s(n, "link", "links")} to private notes became plain text.` },
  subpage: { level: "warning", text: (n) => `${n} sub-page ${s(n, "block was", "blocks were")} removed.` },
  button: { level: "warning", text: (n) => `${n} ${s(n, "button was", "buttons were")} removed.` },
  unsupported_block: { level: "warning", text: (n) => `${n} ${s(n, "block", "blocks")} the site can't show ${s(n, "was", "were")} removed.` },
  iframe_blocked: { level: "warning", text: (n) => `${n} ${s(n, "embed", "embeds")} from a site that isn't allowed ${s(n, "was", "were")} removed.` },
  os_link: { level: "warning", text: (n) => `${n} ${s(n, "link", "links")} to your private OS ${s(n, "was", "were")} removed.` },
  bad_link: { level: "warning", text: (n) => `${n} ${s(n, "link", "links")} with an unsafe or invalid address became plain text.` },
  raw_html: { level: "warning", text: (n) => `${n} ${s(n, "piece", "pieces")} of raw HTML ${s(n, "is", "are")} shown as plain text.` },
  data_url: { level: "warning", text: (n) => `${n} embedded ${s(n, "image", "images")} (data:) removed. Upload the image instead.` },
  external_image: { level: "warning", text: (n) => `${n} ${s(n, "image", "images")} from other sites ${s(n, "is", "are")} loaded from there, not copied.` },
  math_error: { level: "warning", text: (n) => `${n} ${s(n, "equation", "equations")} could not be drawn and ${s(n, "shows", "show")} as code.` },
  nesting_limit: { level: "warning", text: () => "Some blocks are nested too deep and were flattened." },
  never_public: { level: "warning", text: (n) => `${n} ${s(n, "match", "matches")} for words you marked as never public.` },
  metadata_kept: { level: "warning", text: (n) => `${n} ${s(n, "file may", "files may")} still carry author, camera or location info (Office, audio and AVIF files are copied as they are).` },
  archive_unchecked: { level: "warning", text: (n) => `${n} ZIP ${s(n, "file is", "files are")} published without checking what is inside.` },
  // — FYI —
  locked_removed: { level: "info", text: (n) => `${n} 🔒 ${s(n, "block was", "blocks were")} removed on purpose.` },
  media_copied: { level: "info", text: (n) => `${n} ${s(n, "file was", "files were")} copied to the public site.` },
};

const RANK: Record<Level, number> = { error: 0, warning: 1, info: 2 };

/** Collects warnings by kind (count + up to 5 examples). */
export class Warnings {
  private map = new Map<string, { count: number; detail: string[] }>();

  add(code: string, detail?: string, n = 1) {
    const cur = this.map.get(code) ?? { count: 0, detail: [] };
    cur.count += n;
    if (detail && cur.detail.length < 5 && !cur.detail.includes(detail)) cur.detail.push(detail);
    this.map.set(code, cur);
  }

  count(code: string) {
    return this.map.get(code)?.count ?? 0;
  }

  list(): Warning[] {
    return [...this.map.entries()]
      .map(([code, v]) => {
        const def = WARN_DEFS[code] ?? { level: "warning" as Level, text: () => code };
        return { code, level: def.level, message: def.text(v.count), count: v.count, ...(v.detail.length ? { detail: v.detail } : {}) } as Warning;
      })
      .sort((a, b) => RANK[a.level] - RANK[b.level]);
  }
}

export const hasErrors = (w: Warning[]) => w.some((x) => x.level === "error");
export const needsConfirm = (w: Warning[]) => w.some((x) => x.level === "warning");
