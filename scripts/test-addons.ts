// Add-ons registry: favorites (limit, order, unknown ids) and library search.
import { ADDONS, MAX_FAVORITES, cleanFavorites, searchAddons, toggleFavorite, addonById } from "@/lib/addons/registry";

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else {
    fail++;
    console.log(`✗ ${name}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`);
  }
}

eq("teaching exists", addonById("teaching")?.href, "/teaching");
eq("ids unique", new Set(ADDONS.map((a) => a.id)).size, ADDONS.length);
eq("hrefs unique", new Set(ADDONS.map((a) => a.href)).size, ADDONS.length);
eq("clean drops unknown + repeats", cleanFavorites(["x", "teaching", "teaching", 3]), ["teaching"]);
eq("clean non-array", cleanFavorites(null), []);
eq("toggle off", toggleFavorite(["teaching"], "teaching"), []);
eq("toggle on", toggleFavorite([], "teaching"), ["teaching"]);
const full = Array.from({ length: MAX_FAVORITES }, (_, i) => `fake${i}`);
eq("toggle when full returns null", toggleFavorite(full, "teaching"), null);
eq("search name", searchAddons(ADDONS, "teach").map((a) => a.id), ["teaching"]);
eq("search keyword accent-free", searchAddons(ADDONS, "CLÁSES").map((a) => a.id), ["teaching"]);
eq("search keyword 'work' still finds Teaching", searchAddons(ADDONS, "work").map((a) => a.id), ["teaching"]);
eq("search miss", searchAddons(ADDONS, "zzz"), []);
eq("type filter creative", searchAddons(ADDONS, "", "creative").map((a) => a.id), ["youtube", "music-lab", "portfolio"]);
eq("youtube exists", addonById("youtube")?.href, "/youtube");
eq("youtube key y", addonById("youtube")?.key, "y");
eq("search youtube", searchAddons(ADDONS, "guion").map((a) => a.id), ["youtube"]);
eq("music lab exists", addonById("music-lab")?.href, "/music-lab");
eq("search music lab", searchAddons(ADDONS, "música").map((a) => a.id), ["music-lab"]);
eq("keys unique", new Set(ADDONS.filter((a) => a.key).map((a) => a.key)).size, ADDONS.filter((a) => a.key).length);
eq("type filter work", searchAddons(ADDONS, "", "work").length, 1);

console.log(`\nadd-ons: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
