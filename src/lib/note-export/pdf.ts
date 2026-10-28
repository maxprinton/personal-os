// Notes as PDF, drawn by hand (no library): Helvetica + Courier, A4, real line wrapping, lists with
// checkboxes, tables, quotes, code, toggles, highlight and clickable links. Runs in the browser.
import { noteBlocks, noteMeta, noteTitle, safeHref, type Block, type ExportNote, type Run } from "./model";

// Glyph widths (1/1000 em) of WinAnsi codes 32–255
const HELV =
  "278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,761,556,0,222,556,333,1000,556,556,333,1000,667,333,1000,0,611,0,0,222,222,333,333,350,556,1000,333,1000,500,333,944,0,500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500"
    .split(",")
    .map(Number);
const HELV_B =
  "278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,761,556,0,278,556,500,1000,556,556,333,1000,667,333,1000,0,611,0,0,278,278,500,500,350,556,1000,333,1000,556,333,944,0,500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556"
    .split(",")
    .map(Number);

// Characters of the 0x80–0x9F block of WinAnsi, and look-alikes for common symbols it doesn't have
const WIN: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c,
  "Ž": 0x8e, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b,
  "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
};
const SUBST: Record<string, string> = {
  "→": "->", "←": "<-", "⇒": "=>", "↔": "<->", "≤": "<=", "≥": ">=", "≠": "!=", "≈": "~", "−": "-", "‐": "-", "‑": "-", "′": "'", "″": '"',
  "✓": "v", "✔": "v", "✗": "x", "✘": "x", "★": "*", "☆": "*", "☐": "[ ]", "☑": "[x]", "▸": ">", "▪": "•", "◦": "•", "●": "•",
  " ": " ", " ": " ", " ": " ", " ": " ", "​": "", "­": "",
};
const isEmoji = (cp: number) =>
  cp >= 0x1f000 || (cp >= 0x2600 && cp <= 0x27bf) || (cp >= 0x2b00 && cp <= 0x2bff) || (cp >= 0xfe00 && cp <= 0xfe0f) || cp === 0x200d || (cp >= 0x2190 && cp <= 0x21ff && cp !== 0x2192);

/** Text → one byte per character in WinAnsi (accents and ñ work; emoji are left out). */
function winAnsi(text: string): string {
  let out = "";
  for (const ch of text.normalize("NFC")) {
    const cp = ch.codePointAt(0)!;
    if (cp === 9) out += "    ";
    else if ((cp >= 32 && cp < 127) || (cp >= 160 && cp <= 255)) out += ch;
    else if (WIN[ch]) out += String.fromCharCode(WIN[ch]);
    else if (SUBST[ch] !== undefined) out += winAnsi(SUBST[ch]);
    else if (cp < 32 || (cp >= 127 && cp < 160) || isEmoji(cp)) continue;
    else {
      const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
      out += base && base !== ch && [...base].every((c) => c.charCodeAt(0) < 256) ? base : "?";
    }
  }
  return out;
}

type Font = "F1" | "F2" | "F3" | "F4" | "F5";
function measure(s: string, font: Font, size: number) {
  if (font === "F5") return s.length * 0.6 * size;
  const table = font === "F2" || font === "F4" ? HELV_B : HELV;
  let w = 0;
  for (let k = 0; k < s.length; k++) {
    const c = s.charCodeAt(k);
    w += (c >= 32 && c <= 255 ? table[c - 32] : 556) || 556;
  }
  return (w / 1000) * size;
}
const fontOf = (r: Run): Font => (r.code ? "F5" : r.b && r.i ? "F4" : r.b ? "F2" : r.i ? "F3" : "F1");

const num = (v: number) => (Math.round(v * 100) / 100).toString();
const pdfEsc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
/** A string for the PDF itself (already one byte per character). */
const pdfText = (s: string) => `(${pdfEsc(winAnsi(s))})`;

type Piece = { s: string; font: Font; size: number; w: number; run: Run };
type Line = { pieces: Piece[]; width: number };

/** Wraps styled text into lines that fit in `width` points. */
function layout(runs: Run[], width: number, size: number, base: Partial<Run> = {}): Line[] {
  const lines: Line[] = [];
  let cur: Piece[] = [];
  let curW = 0;
  const flush = () => {
    while (cur.length && /^ +$/.test(cur[cur.length - 1].s)) curW -= cur.pop()!.w;
    const last = cur[cur.length - 1];
    if (last) {
      const t = last.s.replace(/ +$/, "");
      if (t !== last.s) {
        const w = measure(t, last.font, last.size);
        curW -= last.w - w;
        last.s = t;
        last.w = w;
      }
    }
    lines.push({ pieces: cur, width: curW });
    cur = [];
    curW = 0;
  };
  const add = (s: string, run: Run, font: Font, sz: number, w: number) => {
    const last = cur[cur.length - 1];
    if (last && last.run === run) {
      last.s += s;
      last.w += w;
    } else cur.push({ s, font, size: sz, w, run });
    curW += w;
  };
  for (const r0 of runs) {
    const run: Run = { ...base, ...r0 };
    const font = fontOf(run);
    const sz = run.code ? size * 0.92 : size;
    run.text.split("\n").forEach((part, pi) => {
      if (pi > 0) flush();
      for (const word of winAnsi(part).match(/ +|[^ ]+/g) ?? []) {
        const w = measure(word, font, sz);
        if (word[0] === " ") {
          if (cur.length) add(word, run, font, sz, w);
          continue;
        }
        if (curW + w > width && cur.length) flush();
        if (w <= width) {
          add(word, run, font, sz, w);
          continue;
        }
        let chunk = ""; // a word longer than the line: cut it
        for (const c of word) {
          if (chunk && curW + measure(chunk + c, font, sz) > width) {
            add(chunk, run, font, sz, measure(chunk, font, sz));
            flush();
            chunk = c;
          } else chunk += c;
        }
        if (chunk) add(chunk, run, font, sz, measure(chunk, font, sz));
      }
    });
  }
  if (cur.length || !lines.length) flush();
  return lines;
}

// Page: A4 in points
const PW = 595.28;
const PH = 841.89;
const MX = 56;
const MT = 62;
const MB = 62;
const CW = PW - 2 * MX;
const TEXT = "0.12 0.13 0.17";
const GRAY = "0.42 0.45 0.5";
const LIGHT = "0.62 0.65 0.7";
const LINK = "0.31 0.27 0.9";
const ACCENT = "0.31 0.27 0.9";
const BODY = 10.5;

type Page = { ops: string[]; links: { rect: number[]; href: string }[] };

class PdfDoc {
  pages: Page[] = [];
  y = PH - MT;
  constructor() {
    this.newPage();
  }
  get page() {
    return this.pages[this.pages.length - 1];
  }
  get atTop() {
    return this.y >= PH - MT - 0.5;
  }
  newPage() {
    this.pages.push({ ops: [], links: [] });
    this.y = PH - MT;
  }
  need(h: number) {
    if (this.y - h < MB && !this.atTop) this.newPage();
  }
  op(s: string) {
    this.page.ops.push(s);
  }
  fill(x: number, y: number, w: number, h: number, color: string) {
    this.op(`${color} rg ${num(x)} ${num(y)} ${num(w)} ${num(h)} re f`);
  }
  stroke(x1: number, y1: number, x2: number, y2: number, color: string, width = 0.6) {
    this.op(`${color} RG ${num(width)} w ${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S`);
  }
  box(x: number, y: number, w: number, h: number, color: string, width = 0.6) {
    this.op(`${color} RG ${num(width)} w ${num(x)} ${num(y)} ${num(w)} ${num(h)} re S`);
  }
  /** Raw text that is already WinAnsi. */
  text(s: string, x: number, y: number, font: Font, size: number, color = TEXT) {
    if (s) this.op(`BT /${font} ${num(size)} Tf ${color} rg ${num(x)} ${num(y)} Td (${pdfEsc(s)}) Tj ET`);
  }

  drawLine(line: Line, x: number, baseline: number, color = TEXT) {
    let cx = x;
    for (const p of line.pieces) {
      const r = p.run;
      if (r.hl) this.fill(cx, baseline - p.size * 0.28, p.w, p.size * 1.18, "1 0.9 0.5");
      if (r.code) this.fill(cx - 1.5, baseline - p.size * 0.3, p.w + 3, p.size * 1.2, "0.94 0.94 0.96");
      const href = safeHref(r.href);
      const c = href ? LINK : r.s ? LIGHT : color;
      this.text(p.s, cx, baseline, p.font, p.size, c);
      if (r.u || href) this.stroke(cx, baseline - 1.4, cx + p.w, baseline - 1.4, c, 0.5);
      if (r.s) this.stroke(cx, baseline + p.size * 0.3, cx + p.w, baseline + p.size * 0.3, c, 0.6);
      if (href) this.page.links.push({ rect: [cx, baseline - p.size * 0.3, cx + p.w, baseline + p.size * 0.95], href });
      cx += p.w;
    }
  }

  /** A wrapped paragraph; onFirst gets the baseline of its first line (for bullets and checkboxes). */
  para(
    runs: Run[],
    x: number,
    w: number,
    o: { size?: number; lead?: number; color?: string; base?: Partial<Run>; after?: number; onFirst?: (baseline: number) => void } = {},
  ) {
    const size = o.size ?? BODY;
    const lead = o.lead ?? size * 1.45;
    layout(runs, w, size, o.base).forEach((ln, k) => {
      this.need(lead);
      this.y -= lead;
      const baseline = this.y + lead * 0.27;
      if (k === 0) o.onFirst?.(baseline);
      this.drawLine(ln, x, baseline, o.color);
    });
    this.y -= o.after ?? 0;
  }

  /** A vertical bar from one point to another, across pages if needed. */
  vbar(x: number, fromPage: number, fromY: number, color: string, width: number) {
    const toPage = this.pages.length - 1;
    for (let p = fromPage; p <= toPage; p++) {
      const top = p === fromPage ? fromY : PH - MT;
      const bottom = p === toPage ? this.y : MB;
      if (top > bottom) this.pages[p].ops.push(`${color} RG ${num(width)} w ${num(x)} ${num(top)} m ${num(x)} ${num(bottom)} l S`);
    }
  }

  checkbox(x: number, baseline: number, checked: boolean) {
    const s = 8.4;
    const y = baseline - 1;
    if (checked) {
      this.op(`${ACCENT} rg ${num(x)} ${num(y)} ${num(s)} ${num(s)} re f`);
      this.op(`1 1 1 RG 1.2 w 1 J 1 j ${num(x + 1.9)} ${num(y + 4.3)} m ${num(x + 3.6)} ${num(y + 2.4)} l ${num(x + 6.6)} ${num(y + 6.2)} l S`);
    } else this.box(x, y, s, s, "0.55 0.58 0.64", 0.8);
  }

  blocks(list: Block[], x: number, w: number, depth = 0, color?: string) {
    for (const b of list) this.block(b, x, w, depth, color);
  }

  block(b: Block, x: number, w: number, depth: number, color?: string) {
    switch (b.t) {
      case "h": {
        const size = [16.5, 14, 12.2][b.level - 1] ?? 11.2;
        this.need(size * 4.2); // keep the heading with what follows
        if (!this.atTop) this.y -= size * 0.75;
        this.para(b.runs, x, w, { size, lead: size * 1.3, base: { b: true }, color, after: 3 });
        return;
      }
      case "p":
        this.para(b.runs, x, w, { color, after: 5.5 });
        return;
      case "list": {
        let n = b.start;
        const lead = BODY * 1.45;
        for (const it of b.items) {
          const tx = x + 17;
          const label = `${n}.`;
          const draw = (bl: number) => {
            if (it.checked !== null) this.checkbox(x + 2, bl, it.checked);
            else if (b.ordered) this.text(winAnsi(label), tx - 4.5 - measure(label, "F1", BODY), bl, "F1", BODY, GRAY);
            else this.text(depth % 2 ? "\x96" : "\x95", x + 5, bl, "F1", BODY, GRAY);
          };
          if (it.runs.length)
            this.para(it.runs, tx, w - 17, { onFirst: draw, color: it.checked ? LIGHT : color, base: it.checked ? { s: true } : {}, after: 1.5 });
          else {
            this.need(lead);
            draw(this.y - lead + lead * 0.27);
            if (!it.blocks.length) this.y -= lead;
          }
          if (it.blocks.length) this.blocks(it.blocks, tx, w - 17, depth + 1, color);
          n++;
        }
        this.y -= depth ? 0 : 4;
        return;
      }
      case "quote": {
        const page = this.pages.length - 1;
        const top = this.y - 2;
        this.blocks(b.blocks, x + 14, w - 14, depth, GRAY);
        this.vbar(x + 3, page, top, "0.78 0.8 0.99", 2.4);
        this.y -= 4;
        return;
      }
      case "code": {
        const size = 9;
        const lead = 12.6;
        const max = Math.max(10, Math.floor((w - 16) / (size * 0.6)));
        const lines: string[] = [];
        for (const raw of b.text.replace(/\t/g, "    ").split("\n")) {
          const enc = winAnsi(raw);
          if (!enc) lines.push("");
          for (let k = 0; k < enc.length; k += max) lines.push(enc.slice(k, k + max));
        }
        const bg = "0.955 0.957 0.965";
        this.need(lead + 12);
        this.fill(x, this.y - 6, w, 6, bg);
        this.y -= 6;
        for (const l of lines) {
          this.need(lead);
          if (this.atTop) {
            this.fill(x, this.y - 4, w, 4, bg);
            this.y -= 4;
          }
          this.fill(x, this.y - lead, w, lead, bg);
          this.y -= lead;
          this.text(l, x + 8, this.y + 3.6, "F5", size, "0.2 0.22 0.28");
        }
        this.fill(x, this.y - 6, w, 6, bg);
        this.y -= 14;
        return;
      }
      case "hr":
        this.need(16);
        this.y -= 8;
        this.stroke(x, this.y, x + w, this.y, "0.85 0.86 0.89", 0.8);
        this.y -= 10;
        return;
      case "table":
        this.table(b, x, w);
        return;
      case "details": {
        this.para(b.summary, x + 14, w - 14, {
          base: { b: true },
          color,
          after: 2,
          onFirst: (bl) => this.op(`${GRAY} rg ${num(x + 2)} ${num(bl + 0.5)} m ${num(x + 2)} ${num(bl + 7.5)} l ${num(x + 8)} ${num(bl + 4)} l f`),
        });
        this.blocks(b.blocks, x + 14, w - 14, depth, color);
        this.y -= 2;
        return;
      }
    }
  }

  table(b: Extract<Block, { t: "table" }>, x: number, w: number) {
    const size = 9.5;
    const pad = 5;
    const lead = size * 1.38;
    const cols = Math.max(b.head.length, ...b.rows.map((r) => r.length));
    if (!cols) return;
    const natural = Array.from({ length: cols }, (_, i) =>
      Math.min(w, Math.max(30, ...[b.head, ...b.rows].map((r) => (r[i] ? layout(r[i], 1e6, size, r === b.head ? { b: true } : {})[0]?.width ?? 0 : 0) + 2 * pad))),
    );
    const total = natural.reduce((a, v) => a + v, 0);
    let widths = natural.map((v) => Math.max(36, (v / total) * w));
    const sum = widths.reduce((a, v) => a + v, 0);
    widths = widths.map((v) => (v / sum) * w);

    const row = (cells: Run[][], header: boolean) => {
      const laid = widths.map((cw, i) => layout(cells[i] ?? [], cw - 2 * pad, size, header ? { b: true } : {}));
      const h = Math.max(...laid.map((l) => l.length)) * lead + 2 * pad;
      if (this.y - h < MB && !this.atTop) {
        this.newPage();
        if (!header && b.head.length) row(b.head, true); // repeat the header on the new page
      }
      const top = this.y;
      if (header) this.fill(x, top - h, w, h, "0.95 0.95 0.97");
      let cx = x;
      laid.forEach((lines, i) => {
        lines.forEach((ln, k) => {
          const free = widths[i] - 2 * pad - ln.width;
          const off = b.align[i] === "center" ? free / 2 : b.align[i] === "right" ? free : 0;
          this.drawLine(ln, cx + pad + off, top - pad - (k + 1) * lead + lead * 0.27);
        });
        this.box(cx, top - h, widths[i], h, "0.82 0.83 0.86", 0.6);
        cx += widths[i];
      });
      this.y = top - h;
    };
    this.need(lead * 2 + 4 * pad);
    if (b.head.length) row(b.head, true);
    for (const r of b.rows) row(r, false);
    this.y -= 9;
  }

  /** Title, meta line and content of one note (each note starts on its own page). */
  note(n: ExportNote) {
    if (!this.atTop) this.newPage();
    this.para([{ text: noteTitle(n) }], MX, CW, { size: 21, lead: 26, base: { b: true }, after: 2 });
    const meta = noteMeta(n);
    if (meta) this.para([{ text: meta }], MX, CW, { size: 9, color: GRAY, after: 2 });
    this.y -= 6;
    this.stroke(MX, this.y, MX + CW, this.y, "0.88 0.89 0.92", 0.8);
    this.y -= 12;
    const blocks = noteBlocks(n);
    if (!blocks.length) this.para([{ text: "Empty note", i: true }], MX, CW, { color: LIGHT });
    this.blocks(blocks, MX, CW);
  }

  /** The finished file. */
  build(footer: string): Uint8Array {
    const objs: string[] = [];
    const add = (o: string) => objs.push(o); // object number = position + 1
    const d = new Date();
    const p2 = (v: number) => String(v).padStart(2, "0");
    const stamp = `D:${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
    add("<< /Type /Catalog /Pages 2 0 R >>");
    add(""); // page tree, filled below
    add(`<< /Title ${pdfText(footer)} /Producer (Personal OS) /CreationDate (${stamp}) >>`);
    const fonts = ["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique", "Courier"];
    fonts.forEach((f) => add(`<< /Type /Font /Subtype /Type1 /BaseFont /${f} /Encoding /WinAnsiEncoding >>`));
    const fontRes = fonts.map((_, i) => `/F${i + 1} ${i + 4} 0 R`).join(" ");
    const kids: number[] = [];
    const short = footer.length > 70 ? `${footer.slice(0, 69)}…` : footer;
    this.pages.forEach((pg, i) => {
      const label = `${i + 1} / ${this.pages.length}`;
      const foot =
        `BT /F1 8 Tf ${LIGHT} rg ${num(MX)} 30 Td ${pdfText(short)} Tj ET\n` +
        `BT /F1 8 Tf ${LIGHT} rg ${num(PW - MX - measure(label, "F1", 8))} 30 Td ${pdfText(label)} Tj ET`;
      const stream = `${pg.ops.join("\n")}\n${foot}`;
      add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      const contentNo = objs.length;
      const annots = pg.links.map((l) => {
        let uri = l.href;
        try {
          uri = encodeURI(decodeURI(l.href));
        } catch {
          uri = encodeURI(l.href);
        }
        add(`<< /Type /Annot /Subtype /Link /Rect [${l.rect.map(num).join(" ")}] /Border [0 0 0] /A << /S /URI /URI (${pdfEsc(uri)}) >> >>`);
        return objs.length;
      });
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(PW)} ${num(PH)}] /Resources << /Font << ${fontRes} >> >> /Contents ${contentNo} 0 R` +
          `${annots.length ? ` /Annots [${annots.map((a) => `${a} 0 R`).join(" ")}]` : ""} >>`,
      );
      kids.push(objs.length);
    });
    objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;

    let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
    const offsets: number[] = [];
    objs.forEach((o, i) => {
      offsets.push(out.length);
      out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    // Every character is one byte (0–255), so lengths and offsets above are exact
    const bytes = new Uint8Array(out.length);
    for (let k = 0; k < out.length; k++) bytes[k] = out.charCodeAt(k) & 0xff;
    return bytes;
  }
}

export function notesPdf(notes: ExportNote[]): Uint8Array {
  const doc = new PdfDoc();
  for (const n of notes) doc.note(n);
  return doc.build(notes.length === 1 ? noteTitle(notes[0]) : `Personal OS · ${notes.length} notes`);
}
