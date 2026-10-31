// Fits an AI picture to the places it is shown, so no cover ever needs repositioning.
// Measured from the CSS (see ACTIVAR-PORTADAS-IA.md): the page cover is a band about 5:1 on a computer (1.5:1 on a phone),
// the gallery cards are 1.5:1 to 2.5:1 at heights of 96 / 140 / 200 px. One picture can't be cut for all of those,
// so instead it is "contained": the picture shows whole, centered, as big as the frame allows, and the rest of the frame
// is filled with the picture's own background color (kept in the cover link as "#bg=f3ebdd", see coverStyle in covers.ts).
// That only looks right if the picture melts into its background, so here the picture is
//   1) cut tight around what is drawn (+ a margin), so the subject is as large as possible in every frame,
//   2) faded to transparent at its borders, so no seam shows against the frame's color.
// The math is plain functions (tested in scripts/test-cover-art.ts); only fitCover() uses sharp (loaded when needed).

export type Rgb = [number, number, number];
export type Box = { x0: number; y0: number; x1: number; y1: number }; // x1 / y1 exclusive
export type Rect = { left: number; top: number; width: number; height: number };

export const hexOf = (c: Rgb) => c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");

/** Margin around the drawn part, as a share of its height (each side). */
export const FIT_PAD = 0.2;
/** The cut is never smaller than this share of the picture's height (keeps it sharp when enlarged). */
export const FIT_MIN = 0.45;
/** A pixel counts as "drawn" when it differs from the background by more than this (0-255). */
export const FIT_THRESHOLD = 34;
export const FIT_MAX_SIDE = 1400;

/** The background color: the median of the pixels along the border (RGB, 3 bytes per pixel). */
export function ringColor(px: Uint8Array, w: number, h: number): Rgb {
  const ring = Math.max(2, Math.round(Math.min(w, h) * 0.02));
  const ch: number[][] = [[], [], []];
  for (let y = 0; y < h; y++) {
    const edgeRow = y < ring || y >= h - ring;
    for (let x = 0; x < w; x++) {
      if (!edgeRow && x >= ring && x < w - ring) {
        x = w - ring - 1; // jump over the inside
        continue;
      }
      const i = (y * w + x) * 3;
      ch[0].push(px[i]);
      ch[1].push(px[i + 1]);
      ch[2].push(px[i + 2]);
    }
  }
  const med = (a: number[]) => (a.sort((p, q) => p - q), a[a.length >> 1] ?? 255);
  return [med(ch[0]), med(ch[1]), med(ch[2])];
}

/** The box that holds everything drawn, or null when the picture has no clear subject on a flat background. */
export function findSubject(px: Uint8Array, w: number, h: number, bg: Rgb, threshold = FIT_THRESHOLD): Box | null {
  const rows = new Uint32Array(h);
  const cols = new Uint32Array(w);
  let drawn = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      if (Math.max(Math.abs(px[i] - bg[0]), Math.abs(px[i + 1] - bg[1]), Math.abs(px[i + 2] - bg[2])) > threshold) {
        rows[y]++;
        cols[x]++;
        drawn++;
      }
    }
  }
  if (!drawn || drawn / (w * h) > 0.6) return null; // nothing drawn, or the background isn't flat
  const minRow = Math.max(2, Math.round(w * 0.012)); // specks and noise don't count
  const minCol = Math.max(2, Math.round(h * 0.012));
  let y0 = 0;
  let y1 = h;
  let x0 = 0;
  let x1 = w;
  while (y0 < h && rows[y0] < minRow) y0++;
  while (y1 > y0 && rows[y1 - 1] < minRow) y1--;
  while (x0 < w && cols[x0] < minCol) x0++;
  while (x1 > x0 && cols[x1 - 1] < minCol) x1--;
  if (x1 - x0 < 2 || y1 - y0 < 2) return null;
  if ((x1 - x0) / w > 0.94 && (y1 - y0) / h > 0.94) return null; // fills the whole picture: nothing to cut
  return { x0, y0, x1, y1 };
}

/** The cut (in the picture's own pixels; may go outside the picture, that part is filled with the background). */
export function frameFor(box: Box, gridW: number, gridH: number, srcW: number, srcH: number): Rect {
  const sx = srcW / gridW;
  const sy = srcH / gridH;
  const bw = (box.x1 - box.x0) * sx;
  const bh = (box.y1 - box.y0) * sy;
  const cx = ((box.x0 + box.x1) / 2) * sx;
  const cy = ((box.y0 + box.y1) / 2) * sy;
  const height = Math.max(bh * (1 + 2 * FIT_PAD), srcH * FIT_MIN);
  const width = Math.max(bw * (1 + 2 * FIT_PAD), height); // never narrower than square
  return { left: Math.round(cx - width / 2), top: Math.round(cy - height / 2), width: Math.round(width), height: Math.round(height) };
}

/** Copies the cut out of an RGB picture; anything outside the picture is the background color. */
export function cropRaw(src: Uint8Array, w: number, h: number, rect: Rect, bg: Rgb): Uint8Array {
  const out = new Uint8Array(rect.width * rect.height * 3);
  for (let i = 0; i < out.length; i += 3) {
    out[i] = bg[0];
    out[i + 1] = bg[1];
    out[i + 2] = bg[2];
  }
  const x0 = Math.max(0, rect.left);
  const x1 = Math.min(w, rect.left + rect.width);
  if (x1 <= x0) return out;
  for (let y = Math.max(0, rect.top); y < Math.min(h, rect.top + rect.height); y++) {
    const from = (y * w + x0) * 3;
    const to = ((y - rect.top) * rect.width + (x0 - rect.left)) * 3;
    out.set(src.subarray(from, from + (x1 - x0) * 3), to);
  }
  return out;
}

/** Opacity (0-255) of every pixel: 255 inside, fading to 0 at the four borders. */
export function featherAlpha(w: number, h: number): Uint8Array {
  const f = Math.max(2, Math.round(Math.min(w, h) * 0.07));
  const ramp = (d: number) => {
    if (d >= f) return 1;
    const t = Math.max(0, d) / f;
    return t * t * (3 - 2 * t);
  };
  const a = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const ry = Math.min(ramp(y), ramp(h - 1 - y));
    for (let x = 0; x < w; x++) a[y * w + x] = Math.round(255 * Math.min(ry, ramp(x), ramp(w - 1 - x)));
  }
  return a;
}

export type Fitted = { bytes: Uint8Array; mime: "image/webp"; bg: string; width: number; height: number; cut: boolean };

/** The whole job: picture bytes in, the fitted picture (WebP with soft borders) and its background color out. Null if it can't be done. */
export async function fitCover(bytes: Uint8Array): Promise<Fitted | null> {
  try {
    const sharp = (await import("sharp")).default;
    const full = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = full.info.width;
    const H = full.info.height;
    const grid = await sharp(bytes).removeAlpha().resize({ width: 256, height: 256, fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
    const gw = grid.info.width;
    const gh = grid.info.height;
    const bg = ringColor(grid.data, gw, gh);
    const box = findSubject(grid.data, gw, gh, bg);
    const rect: Rect = box ? frameFor(box, gw, gh, W, H) : { left: 0, top: 0, width: W, height: H };
    let rgb: Uint8Array = cropRaw(full.data, W, H, rect, bg);
    let w = rect.width;
    let h = rect.height;
    if (Math.max(w, h) > FIT_MAX_SIDE) {
      const k = FIT_MAX_SIDE / Math.max(w, h);
      const small = await sharp(rgb, { raw: { width: w, height: h, channels: 3 } })
        .resize({ width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)), fit: "fill" })
        .raw()
        .toBuffer({ resolveWithObject: true });
      rgb = small.data;
      w = small.info.width;
      h = small.info.height;
    }
    const out = await sharp(rgb, { raw: { width: w, height: h, channels: 3 } })
      .joinChannel(Buffer.from(featherAlpha(w, h)), { raw: { width: w, height: h, channels: 1 } })
      .webp({ quality: 86, alphaQuality: 92 })
      .toBuffer();
    return { bytes: new Uint8Array(out), mime: "image/webp", bg: hexOf(bg), width: w, height: h, cut: !!box };
  } catch (e) {
    console.error("fitCover failed", e);
    return null;
  }
}
