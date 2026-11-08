// Tests of src/lib/youtube/patterns.ts (what saved outlier titles have in common). Run: npm run test:youtube-patterns
import { MIN_PATTERN_TITLES, patternPrompt, titlePatterns } from "@/lib/youtube/patterns";
import { WATCH_CHECK_DAYS } from "@/lib/youtube/constants";

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; console.log(`✗ ${name}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
}

const refs = [
  { title: "How I built my own app in 30 days" },
  { title: "How I quit Notion for good" },
  { title: "I tried 5 productivity apps for a year" },
  { title: "Why your to-do list fails" },
];
const p = titlePatterns(refs);
eq("n", p.n, 4);
eq("number pattern", p.lines.includes("2 of 4 titles contain a number"), true);
eq("how pattern", p.lines.includes('2 of 4 titles start with "How"'), true);
eq("first person", p.lines.includes('4 of 4 titles speak in the first person ("I", "my")') || p.lines.some((l) => l.includes("first person")), true);
eq("opens with how", p.lines.includes('2 of 4 titles open with "how"'), true);
eq("length line exists", p.lines.some((l) => l.startsWith("typical length:")), true);
eq("too few titles → nothing", titlePatterns(refs.slice(0, MIN_PATTERN_TITLES - 1)).lines, []);
eq("empty prompt when too few", patternPrompt([{ title: "a" }]), "");
eq("prompt has header", patternPrompt(refs).startsWith("What the outlier titles have in common"), true);
eq("blank titles ignored", titlePatterns([{ title: " " }, { title: "" }, { title: "x" }]).n, 1);
eq("no pattern under 40%", titlePatterns([{ title: "Alpha beta" }, { title: "Gamma delta" }, { title: "Epsilon zeta" }, { title: "Eta 5" }, { title: "Theta iota" }]).lines.some((l) => l.includes("contain a number")), false);
eq("watchlist checked daily", WATCH_CHECK_DAYS, 1);

console.log(`\nyoutube-patterns: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
