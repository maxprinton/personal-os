// Lets `node scripts/test-bot.ts` load the app's TypeScript files: "@/x" → src/x.ts (and ./x → ./x.ts).
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(
  "data:text/javascript," +
    encodeURIComponent(`
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const SRC = ${JSON.stringify(pathToFileURL(process.cwd() + "/src/").href)};
export async function resolve(spec, ctx, next) {
  let target = spec.startsWith("@/") ? new URL(spec.slice(2), SRC).href : spec;
  if ((target.startsWith("file:") || target.startsWith(".")) && !/\\.[cm]?[jt]s$/.test(target)) {
    const base = target.startsWith(".") ? new URL(target, ctx.parentURL).href : target;
    for (const ext of [".ts", ".tsx", "/index.ts"]) {
      if (existsSync(fileURLToPath(base + ext))) return next(base + ext, ctx);
    }
  }
  return next(target, ctx);
}`),
  pathToFileURL("./")
);
