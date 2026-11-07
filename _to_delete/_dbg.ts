import { cleanLangs } from "@/lib/portfolio/slots";
console.log(JSON.stringify(cleanLangs({ en: { slug: " x ", summary: "", junk: "no" }, fr: { slug: "y" } })));
