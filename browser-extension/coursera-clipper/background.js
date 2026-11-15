// Personal OS Clipper: talks to your app. The key never reaches the Coursera page (only this worker sends it).
async function settings() {
  return chrome.storage.local.get(["appUrl", "key"]);
}

async function api(path, init) {
  const { appUrl, key } = await settings();
  if (!appUrl || !key) return { error: "Open the extension options and add the app address and key." };
  let res;
  try {
    res = await fetch(appUrl.replace(/\/+$/, "") + path, {
      ...init,
      headers: { authorization: "Bearer " + key, "content-type": "application/json" },
    });
  } catch {
    return { error: "Couldn't reach your app. Check the address and that the extension has permission for it (Options → Save connection)." };
  }
  let body = {};
  try {
    body = await res.json();
  } catch {
    /* no JSON */
  }
  return { status: res.status, ...body };
}

async function handle(msg) {
  if (msg.type === "clip") return api("/api/clip", { method: "POST", body: JSON.stringify(msg.payload) });
  if (msg.type === "meta") return api("/api/clip/meta", { method: "GET" });
  if (msg.type === "open") {
    const { appUrl } = await settings();
    if (appUrl) await chrome.tabs.create({ url: appUrl.replace(/\/+$/, "") + "/notes/" + msg.id });
    return { ok: true };
  }
  if (msg.type === "options") {
    await chrome.runtime.openOptionsPage();
    return { ok: true };
  }
  return { error: "Unknown request" };
}

chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  handle(msg)
    .then(send)
    .catch((e) => send({ error: String((e && e.message) || e) }));
  return true;
});

async function togglePanel() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id != null) chrome.tabs.sendMessage(tab.id, { type: "toggle-panel" }).catch(() => {});
}
chrome.commands.onCommand.addListener((cmd) => cmd === "save-lesson" && togglePanel());
chrome.action.onClicked.addListener(() => togglePanel());
