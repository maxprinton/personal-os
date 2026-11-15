// Personal OS Clipper: runs on Coursera lesson pages. Reads the reading and/or the video transcript that is on screen,
// shows a small panel (keyword + what to save) and sends it to your app through the background worker.
(function () {
  if (window.__posClipLoaded) return;
  window.__posClipLoaded = true;
  const Md = self.PosMd;

  // ---------- reading the page ----------
  const READING_SELECTORS = ['[data-testid="cml-viewer"]', ".rc-CML", ".rc-ReadingItem", '[data-testid="reading-item"]', '[class*="cml-"]', ".reading-text", "main article", "main"];
  const TRANSCRIPT_SELECTORS = ['[data-testid="transcript"]', ".rc-Transcript", '[class*="Transcript"]', '[id*="ranscript"]'];
  const PHRASE_SELECTORS = [".rc-Phrase", '[class*="Phrase"]', '[data-testid="transcript-phrase"]', "[data-phrase]", "p", "span"];

  function lessonTitle() {
    const h1 = document.querySelector("h1");
    const t = (h1 && h1.textContent.trim()) || document.title.replace(/\s*[|\-–]\s*Coursera.*$/i, "").trim();
    return t.replace(/\s+/g, " ").trim();
  }

  function pageKind() {
    if (/\/lecture\//.test(location.pathname)) return "video";
    if (/\/(supplement|reading)\//.test(location.pathname)) return "reading";
    return "other";
  }

  function readingElement() {
    for (const sel of READING_SELECTORS) {
      const nodes = Array.from(document.querySelectorAll(sel));
      let best = null;
      for (const n of nodes) {
        if (n.closest("#pos-clip-host") || n.closest("nav, header, footer")) continue;
        const len = n.textContent.trim().length;
        if (len > 200 && (!best || len > best.textContent.trim().length)) best = n;
      }
      if (best) return best;
    }
    return null;
  }

  function transcriptContainer() {
    for (const sel of TRANSCRIPT_SELECTORS) {
      for (const n of document.querySelectorAll(sel)) {
        if (n.closest("#pos-clip-host")) continue;
        if (n.textContent.trim().length > 200) return n;
      }
    }
    return null;
  }

  function transcriptLines(container) {
    for (const sel of PHRASE_SELECTORS) {
      const parts = Array.from(container.querySelectorAll(sel))
        .filter((n) => !n.querySelector(sel) && !n.closest("button"))
        .map((n) => n.textContent.replace(/\s+/g, " ").trim())
        .filter(Boolean);
      // A real transcript has many short phrases; "p"/"span" only count if they really split the text
      if (parts.length >= 5) return parts;
    }
    return [container.textContent.replace(/\s+/g, " ").trim()];
  }

  // On a video page the transcript tab may be closed: click it and wait a moment.
  async function openTranscriptIfNeeded() {
    if (transcriptContainer()) return;
    const tab = Array.from(document.querySelectorAll('button, [role="tab"], a')).find((b) => /^\s*transcript\s*$/i.test(b.textContent || ""));
    if (!tab) return;
    tab.click();
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 250));
      if (transcriptContainer()) return;
    }
  }

  async function scan() {
    const kind = pageKind();
    const title = lessonTitle();
    const out = { title, kind, reading: null, transcript: null };
    const readEl = kind !== "video" ? readingElement() : null;
    if (readEl) {
      const md = Md.htmlToMd(readEl, location.href);
      if (md.length > 40) out.reading = { markdown: md, chars: md.length, images: (md.match(/!\[[^\]]*\]\(/g) || []).length };
    }
    if (kind === "video") {
      await openTranscriptIfNeeded();
      const box = transcriptContainer();
      if (box) {
        const md = Md.transcriptToMd(transcriptLines(box));
        if (md.length > 40) out.transcript = { markdown: md, words: md.split(/\s+/).length };
      }
    }
    return out;
  }

  // ---------- panel ----------
  const host = document.createElement("div");
  host.id = "pos-clip-host";
  host.style.cssText = "position:fixed;z-index:2147483647;right:16px;bottom:16px;font:14px system-ui,sans-serif;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      .fab{all:unset;cursor:pointer;background:#1f2937;color:#fff;border-radius:999px;padding:9px 14px;font-weight:600;box-shadow:0 2px 10px #0004}
      .fab:hover{background:#111827}
      .panel{display:none;width:340px;max-height:80vh;overflow:auto;background:#fff;color:#111827;border:1px solid #d1d5db;border-radius:12px;padding:14px;box-shadow:0 8px 30px #0003;margin-bottom:8px}
      .panel.open{display:block}
      h3{margin:0 0 8px;font-size:15px}
      label{display:block;font-size:12px;color:#4b5563;margin:8px 0 3px}
      input[type=text]{width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #d1d5db;border-radius:6px;font:inherit}
      .row{display:flex;gap:8px;align-items:flex-start;margin:8px 0}
      .row small{display:block;color:#6b7280}
      button.go{all:unset;cursor:pointer;background:#2563eb;color:#fff;border-radius:8px;padding:8px 12px;font-weight:600;margin-top:10px}
      button.go[disabled]{opacity:.5;cursor:default}
      button.link{all:unset;cursor:pointer;color:#2563eb;text-decoration:underline;font-size:13px}
      .msg{margin-top:8px;font-size:13px}
      .err{color:#b91c1c}.ok{color:#047857}
      .x{all:unset;cursor:pointer;float:right;color:#6b7280}
    </style>
    <div class="panel" id="panel"></div>
    <button class="fab" id="fab" title="Alt+Shift+S">Save to Personal OS</button>`;
  document.documentElement.appendChild(host);
  const panel = root.getElementById("panel");
  root.getElementById("fab").addEventListener("click", () => toggle());
  chrome.runtime.onMessage.addListener((m) => m && m.type === "toggle-panel" && toggle());

  const send = (msg) => chrome.runtime.sendMessage(msg);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  let busy = false;

  function toggle() {
    if (panel.classList.contains("open")) panel.classList.remove("open");
    else open();
  }

  async function open() {
    panel.classList.add("open");
    panel.innerHTML = `<h3>Personal OS</h3><div class="msg">Reading the page…</div>`;
    const [{ templates, lastClip, appUrl, key }, found] = await Promise.all([chrome.storage.local.get(["templates", "lastClip", "appUrl", "key"]), scan()]);
    if (!appUrl || !key) {
      panel.innerHTML = `<h3>Personal OS</h3><div class="msg err">Add your app address and key first.</div><button class="go" id="opts">Open options</button>`;
      panel.querySelector("#opts").onclick = () => send({ type: "options" });
      return;
    }
    const tpl = templates || {};
    const prev = lastClip && Date.now() - lastClip.at < 6 * 3600e3 ? lastClip : null;
    const guess = Md.guessKeyword(found.title, prev && prev.title, prev && prev.keyword);
    const rows = [];
    if (found.reading) rows.push(row("reading", "Reading", `${found.reading.chars.toLocaleString()} characters, ${found.reading.images} image(s)`, fillTitle(tpl.reading, found.title, "{title}")));
    if (found.transcript) rows.push(row("transcript", "Video transcript", `${found.transcript.words.toLocaleString()} words`, fillTitle(tpl.transcript, found.title, "Transcript · {title}")));
    panel.innerHTML = `
      <button class="x" id="close" title="Close">✕</button>
      <h3>Save to Personal OS</h3>
      ${rows.length ? rows.join("") : `<div class="msg err">Nothing to save here. Open a reading or a video page${found.kind === "video" ? " (the Transcript tab must have text)" : ""}.</div>`}
      ${rows.length ? `<label>Keyword (becomes the tag that links the notes)</label><input type="text" id="kw" value="${esc(guess)}" placeholder="e.g. roles">` : ""}
      ${rows.length ? `<button class="go" id="save">Save</button>` : ""}
      <div class="msg" id="msg"></div>
      <div style="margin-top:8px"><button class="link" id="opts">Template &amp; connection settings</button></div>`;
    panel.querySelector("#close").onclick = () => panel.classList.remove("open");
    panel.querySelector("#opts").onclick = () => send({ type: "options" });
    if (!rows.length) return;
    const save = panel.querySelector("#save");
    panel.querySelector("#kw").addEventListener("keydown", (e) => e.key === "Enter" && save.click());
    save.onclick = () => saveAll(found, tpl);
  }

  function fillTitle(t, title, fallback) {
    return Md.fillTitle((t && t.title) || fallback, { title });
  }

  function row(kind, label, info, title) {
    return `<div class="row"><input type="checkbox" data-kind="${kind}" checked><div style="flex:1"><b>${label}</b> <small>${esc(info)}</small>
      <input type="text" data-title="${kind}" value="${esc(title)}"></div></div>`;
  }

  async function saveAll(found, tpl, replaceKinds) {
    if (busy) return;
    busy = true;
    const msg = panel.querySelector("#msg");
    const save = panel.querySelector("#save");
    save.disabled = true;
    msg.className = "msg";
    msg.textContent = "Saving…";
    const keyword = panel.querySelector("#kw").value.trim().replace(/^#/, "");
    const results = [];
    for (const kind of ["reading", "transcript"]) {
      if (replaceKinds && !replaceKinds.includes(kind)) continue; // second pass: only the ones that already existed
      const box = panel.querySelector(`input[data-kind="${kind}"]`);
      if (!box || !box.checked || !found[kind]) continue;
      const t = (tpl && tpl[kind]) || {};
      const props = Object.assign({}, t.props || {});
      if (t.saveLink && t.linkProp) props[t.linkProp] = location.href.split("#")[0];
      const title = panel.querySelector(`input[data-title="${kind}"]`).value.trim();
      const tags = [].concat(t.tags || [], keyword ? [keyword] : []);
      const body = found[kind].markdown + (t.saveLink ? `\n\n---\nSource: ${location.href.split("#")[0]}` : "");
      const r = await send({ type: "clip", payload: { title, markdown: body, tags, props, replace: !!(replaceKinds && replaceKinds.includes(kind)) } });
      results.push({ kind, title, r });
    }
    busy = false;
    save.disabled = false;
    const lines = [];
    const dups = [];
    for (const { kind, r } of results) {
      const label = kind === "reading" ? "Reading" : "Transcript";
      if (r && r.status === 409) {
        dups.push(kind);
        lines.push(`<div class="err">${label}: a note with this title already exists.</div>`);
      } else if (r && r.ok) {
        const imgs = r.images && r.images.failed ? ` (${r.images.failed} image(s) couldn't be copied)` : "";
        lines.push(`<div class="ok">${label}: ${r.replaced ? "updated" : "saved"}${imgs}. <button class="link" data-open="${r.id}">Open note</button></div>`);
      } else {
        lines.push(`<div class="err">${label}: ${esc((r && r.error) || "something went wrong")}</div>`);
      }
    }
    msg.innerHTML = lines.join("") + (dups.length ? `<button class="link" id="replace">Replace the existing note${dups.length > 1 ? "s" : ""}</button>` : "");
    msg.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => send({ type: "open", id: b.dataset.open })));
    const rep = msg.querySelector("#replace");
    if (rep) rep.onclick = () => saveAll(found, tpl, dups);
    if (results.some((x) => x.r && x.r.ok)) await chrome.storage.local.set({ lastClip: { title: found.title, keyword, at: Date.now() } });
  }
})();
