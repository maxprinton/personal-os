// The "/" menu of Telegram must list every command the bot understands (so a new feature cannot be missing).
import { BOT_COMMANDS } from "@/lib/bot/commands";
import { FEATURES, baseWords } from "@/lib/bot/registry";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => { cond ? pass++ : (fail++, console.error("FAIL", name)); };
const names = new Set(BOT_COMMANDS.map((c) => c.command));

// Telegram's own rules
ok("at most 100 commands", BOT_COMMANDS.length <= 100);
ok("command format a-z 0-9 _ (1-32)", BOT_COMMANDS.every((c) => /^[a-z0-9_]{1,32}$/.test(c.command)));
ok("description 3-256 characters", BOT_COMMANDS.every((c) => c.description.length >= 3 && c.description.length <= 256));
ok("no repeated command", names.size === BOT_COMMANDS.length);

// Every feature that answers to slash words has at least one of them in the menu
const slash = (w: string) => w.startsWith("/") && /^\/[a-z0-9_]+$/.test(w);
const missing = FEATURES.filter((f) => {
  const words = baseWords(f).filter(slash);
  return words.length > 0 && !words.some((w) => names.has(w.slice(1)));
}).map((f) => f.id);
ok(`every feature with a command is in the menu (missing: ${missing.join(", ") || "none"})`, missing.length === 0);

// Commands that are written by hand in the registry examples or how-to lines
for (const c of ["need", "want", "idea", "bug", "mood", "energy", "bed", "woke", "highlight", "os", "ai"]) ok(`/${c} is in the menu`, names.has(c));
// The newer features the user could not find
for (const c of ["recurring", "summary", "backlog", "ideas", "portfolio", "inbox", "checkin", "review"]) ok(`/${c} is in the menu`, names.has(c));
// The simple rule that failed before: every canonical command of a feature is in the menu
const noCanon = FEATURES.filter((f) => f.canonical?.startsWith("/") && !names.has(f.canonical.slice(1)) && !["help"].includes(f.id)).map((f) => f.id);
ok(`every canonical command is in the menu (missing: ${noCanon.join(", ") || "none"})`, noCanon.length === 0);
// The automatic messages of the bot are described in the catalog
ok("event nags are in the automatic messages", FEATURES.some((f) => f.id === "event-nags" && f.group === "auto"));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
