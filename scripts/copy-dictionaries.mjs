// Copies the Hunspell dictionaries (Spanish of Mexico, English of the US) from node_modules to
// public/dict/, where the writing checker's worker downloads them (once; the browser caches them).
// Runs before "npm run dev" and "npm run build". Missing packages = a warning, never a failed build:
// the checker then works with its rules only and the browser's own spell check stays on.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const out = join("public", "dict");
mkdirSync(out, { recursive: true });
for (const [pkg, name] of [
  ["dictionary-es-mx", "es-MX"],
  ["dictionary-en", "en-US"],
]) {
  const dir = join("node_modules", pkg);
  if (!existsSync(dir)) {
    console.warn(`[dictionaries] ${pkg} is not installed (run INSTALAR-CORRECTOR.cmd). Spelling uses the rules only.`);
    continue;
  }
  const files = readdirSync(dir);
  const aff = files.find((f) => f.endsWith(".aff"));
  const dic = files.find((f) => f.endsWith(".dic"));
  if (!aff || !dic) {
    console.warn(`[dictionaries] ${pkg} has no .aff/.dic files.`);
    continue;
  }
  copyFileSync(join(dir, aff), join(out, `${name}.aff`));
  copyFileSync(join(dir, dic), join(out, `${name}.dic`));
  console.log(`[dictionaries] ${name} ready`);
}
