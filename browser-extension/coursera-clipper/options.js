// Options: connection + one template per kind of note (reading / transcript). A template = title pattern, tags,
// property values (Type, Status, Area… read from YOUR notes database) and whether to put the lesson link in a URL property.
const $ = (s, r = document) => r.querySelector(s);
const KINDS = [
  { id: "reading", box: "#tplReading", title: "{title}" },
  { id: "transcript", box: "#tplTranscript", title: "Transcript · {title}" },
];
let meta = null;
let store = {};

const el = (html) => {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstChild;
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

async function init() {
  store = await chrome.storage.local.get(["appUrl", "key", "templates", "meta"]);
  $("#appUrl").value = store.appUrl || "";
  $("#key").value = store.key || "";
  meta = store.meta || null;
  if (meta) fillTagList();
  render();
  if (store.appUrl && store.key && !meta) refreshMeta();
}

function fillTagList() {
  $("#tagList").innerHTML = ((meta && meta.tags) || []).map((t) => `<option value="${esc(t)}">`).join("");
}

async function refreshMeta() {
  const r = await chrome.runtime.sendMessage({ type: "meta" });
  if (r && r.properties) {
    meta = { properties: r.properties, tags: r.tags || [] };
    await chrome.storage.local.set({ meta });
    fillTagList();
    render();
    return true;
  }
  return r && r.error ? r.error : "Couldn't read your properties.";
}

$("#saveConn").onclick = async () => {
  const msg = $("#connMsg");
  const appUrl = $("#appUrl").value.trim().replace(/\/+$/, "");
  const key = $("#key").value.trim();
  let origin;
  try {
    origin = new URL(appUrl).origin;
  } catch {
    msg.className = "err";
    msg.textContent = " That address isn't valid.";
    return;
  }
  try {
    const granted = await chrome.permissions.request({ origins: [origin + "/*"] });
    if (!granted) throw new Error("denied");
  } catch {
    msg.className = "err";
    msg.textContent = " The extension needs permission to talk to that address.";
    return;
  }
  await chrome.storage.local.set({ appUrl, key });
  msg.className = "hint";
  msg.textContent = " Checking…";
  const res = await refreshMeta();
  if (res === true) {
    msg.className = "ok";
    msg.textContent = " Connected. Your tags and properties are loaded below.";
  } else {
    msg.className = "err";
    msg.textContent = " " + res;
  }
};

function render() {
  const saved = store.templates || {};
  for (const k of KINDS) {
    const t = Object.assign({ title: k.title, tags: [], props: {}, saveLink: true, linkProp: "source" }, saved[k.id] || {});
    const box = $(k.box + " .tpl");
    box.innerHTML = "";
    box.append(el(`<div><label>Title pattern <span class="hint">({title} = the lesson's title)</span></label><input type="text" data-f="title" value="${esc(t.title)}"></div>`));
    box.append(el(`<div><label>Tags <span class="hint">(comma separated; the keyword from the panel is added automatically)</span></label><input type="text" data-f="tags" list="tagList" value="${esc((t.tags || []).join(", "))}"></div>`));
    const grid = el(`<div class="grid"></div>`);
    const props = (meta && meta.properties) || [];
    for (const p of props) {
      if (p.type === "url") continue; // handled below with the lesson link
      const v = t.props[p.key];
      let field;
      if (p.type === "select" || p.type === "status") {
        field = `<select data-p="${esc(p.key)}"><option value="">—</option>${p.options.map((o) => `<option value="${esc(o.id)}"${v === o.id ? " selected" : ""}>${esc(o.name)}</option>`).join("")}</select>`;
      } else if (p.type === "multi_select") {
        const cur = Array.isArray(v) ? v : [];
        field = `<select multiple data-p="${esc(p.key)}">${p.options.map((o) => `<option value="${esc(o.id)}"${cur.includes(o.id) ? " selected" : ""}>${esc(o.name)}</option>`).join("")}</select>`;
      } else if (p.type === "checkbox") {
        field = `<div class="inline"><input type="checkbox" data-p="${esc(p.key)}"${v === true ? " checked" : ""}></div>`;
      } else if (p.type === "date") {
        field = `<input type="date" data-p="${esc(p.key)}" value="${esc(v || "")}">`;
      } else {
        field = `<input type="text" data-p="${esc(p.key)}" value="${esc(v ?? "")}">`;
      }
      grid.append(el(`<div><label>${esc(p.name)}</label>${field}</div>`));
    }
    box.append(grid);
    if (!meta) box.append(el(`<p class="hint">Save the connection above to load your properties (Type, Status, Area…).</p>`));
    const urls = props.filter((p) => p.type === "url");
    if (urls.length) {
      box.append(
        el(`<div class="inline"><input type="checkbox" id="${k.id}-link" data-f="saveLink"${t.saveLink ? " checked" : ""}><label for="${k.id}-link">Save the lesson link in</label>
        <select data-f="linkProp" style="width:auto">${urls.map((u) => `<option value="${esc(u.key)}"${t.linkProp === u.key ? " selected" : ""}>${esc(u.name)}</option>`).join("")}</select></div>`)
      );
    }
  }
}

function readTemplate(k) {
  const box = $(k.box + " .tpl");
  const t = { title: $('[data-f="title"]', box).value.trim() || k.title, tags: [], props: {}, saveLink: false, linkProp: "" };
  t.tags = $('[data-f="tags"]', box).value.split(",").map((x) => x.trim().replace(/^#/, "")).filter(Boolean);
  for (const f of box.querySelectorAll("[data-p]")) {
    const key = f.dataset.p;
    if (f.tagName === "SELECT" && f.multiple) {
      const vals = Array.from(f.selectedOptions).map((o) => o.value);
      if (vals.length) t.props[key] = vals;
    } else if (f.type === "checkbox") {
      if (f.checked) t.props[key] = true;
    } else if (f.value) {
      t.props[key] = f.value;
    }
  }
  const link = $('[data-f="saveLink"]', box);
  const lp = $('[data-f="linkProp"]', box);
  if (link && lp) {
    t.saveLink = link.checked;
    t.linkProp = lp.value;
  }
  return t;
}

$("#saveTpl").onclick = async () => {
  const templates = {};
  for (const k of KINDS) templates[k.id] = readTemplate(k);
  store.templates = templates;
  await chrome.storage.local.set({ templates });
  $("#tplMsg").className = "ok";
  $("#tplMsg").textContent = " Saved.";
  setTimeout(() => ($("#tplMsg").textContent = ""), 2000);
};

$("#copyTpl").onclick = () => {
  const r = readTemplate(KINDS[0]);
  const transcriptTitle = readTemplate(KINDS[1]).title;
  store.templates = Object.assign({}, store.templates, { reading: r, transcript: Object.assign({}, r, { title: transcriptTitle }) });
  render();
};

init();
