// "Why did the bot do that?" for read-only commands: finds the library feature whose words the message matches.
import { FEATURES, baseWords } from "@/lib/bot/registry";
import { commandArg, isOneOf, norm } from "@/lib/bot/text";

export function featureForCommand(text: string): { id: string; title: string } | null {
  for (const f of FEATURES) {
    const words = baseWords(f);
    if (!words.length) continue;
    const hit = f.takesArg ? commandArg(text, words.map((w) => norm(w))) !== null : isOneOf(text, words) || words.some((w) => norm(w) === norm(text));
    if (hit) return { id: f.id, title: f.title };
  }
  return null;
}
