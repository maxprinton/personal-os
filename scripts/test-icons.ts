// BL-107: the idea button and the Ask button must not look the same.
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => { cond ? pass++ : (fail++, console.error("FAIL", name)); };
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

const icon = src("components/ui/Icon.tsx");
const path = (n: string) => icon.match(new RegExp(`\\n\\s+${n}: "([^"]+)"`))?.[1];

ok("bulb icon exists", !!path("bulb"));
ok("spark icon still exists", !!path("spark"));
ok("bulb and spark are different drawings", path("bulb") !== path("spark"));
ok("idea button uses bulb", /<Icon name="bulb"/.test(src("components/backlog/IdeaQuickButton.tsx")));
ok("idea button no longer uses spark", !/<Icon name="spark"/.test(src("components/backlog/IdeaQuickButton.tsx")));
ok("Ask button keeps spark", /<Icon name="spark"/.test(src("components/ask/AskPanelButton.tsx")));
ok("tooltips unchanged", /title="Save an idea to the Backlog"/.test(src("components/backlog/IdeaQuickButton.tsx")) && /title="Ask your notes \(@os\)"/.test(src("components/ask/AskPanelButton.tsx")));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
