// Languages and the fixed texts of the site (page texts come from the notes you publish).
export const LANGS = ["en", "es"] as const;
export type Lang = (typeof LANGS)[number];
export const isLang = (v: string): v is Lang => (LANGS as readonly string[]).includes(v);
export const LANG_NAME: Record<Lang, string> = { en: "English", es: "Español" };
export const OTHER: Record<Lang, Lang> = { en: "es", es: "en" };

export type Dict = {
  skip: string;
  nav: Record<"home" | "about" | "projects" | "writing" | "uses" | "now" | "videos" | "contact", string>;
  now: string;
  seeNow: string;
  allProjects: string;
  featured: string;
  noProjects: string;
  onThisPage: string;
  readMin: (n: number) => string;
  language: string;
  notTranslated: string;
  status: Record<"idea" | "in_progress" | "shipped" | "paused", string>;
  stack: string;
  links: string;
  years: (from?: number, to?: number | null) => string;
  notFoundTitle: string;
  notFoundText: string;
  backHome: string;
  footer: string;
  noArticles: string;
  publishedOn: (date: string) => string;
  rss: string;
  writingIntro: string;
  contact: {
    intro: string;
    name: string;
    nameHint: string;
    email: string;
    message: string;
    send: string;
    sending: string;
    sent: string;
    sentText: string;
    another: string;
    errors: Record<"required" | "invalid" | "short" | "long", string>;
    failed: string;
    tooMany: string;
    verify: string;
    unavailable: string;
    privacy: string;
  };
  videos: {
    intro: string;
    latest: string;
    all: string;
    none: string;
    play: (title: string) => string;
    watch: string;
  };
  search: {
    label: string;
    placeholder: string;
    button: string;
    title: string;
    results: (n: number, q: string) => string;
    none: (q: string) => string;
    hint: string;
    tooShort: string;
    kinds: Record<"home" | "about" | "now" | "uses" | "project" | "article", string>;
  };
};

export const DICT: Record<Lang, Dict> = {
  en: {
    skip: "Skip to content",
    nav: { home: "Home", about: "About", projects: "Projects", writing: "Writing", uses: "Uses", now: "Now", videos: "Videos", contact: "Contact" },
    now: "Now",
    seeNow: "Read more",
    allProjects: "All projects",
    featured: "Featured projects",
    noProjects: "Nothing here yet.",
    onThisPage: "On this page",
    readMin: (n) => `${n} min read`,
    language: "Language",
    notTranslated: "Not translated yet — go to the home page in",
    status: { idea: "idea", in_progress: "in progress", shipped: "shipped", paused: "paused" },
    stack: "Built with",
    links: "Links",
    years: (a, b) => (a ? (b === null || b === undefined ? `${a} – now` : b === a ? `${a}` : `${a} – ${b}`) : ""),
    notFoundTitle: "Page not found",
    notFoundText: "That page does not exist (or is not published yet).",
    backHome: "Back to the home page",
    footer: "Built from my own notes.",
    noArticles: "Nothing written here yet.",
    publishedOn: (d) => `Published ${d}`,
    rss: "Subscribe by RSS",
    writingIntro: "Notes on what I build and what I learn along the way.",
    contact: {
      intro: "Have a question or an idea? Write to me. I read everything and answer when I can.",
      name: "Name",
      nameHint: "optional",
      email: "Your email",
      message: "Message",
      send: "Send message",
      sending: "Sending…",
      sent: "Message sent",
      sentText: "Thanks. I will write back to the email you gave.",
      another: "Send another message",
      errors: { required: "This field is required.", invalid: "That does not look like an email address.", short: "Please write a little more (at least 10 characters).", long: "That is too long." },
      failed: "The message could not be sent. Please try again in a few minutes.",
      tooMany: "You have sent several messages already. Please try again later.",
      verify: "Please complete the check above.",
      unavailable: "The contact form is not available right now.",
      privacy: "I only use your email to reply. Messages are not shared.",
    },
    videos: {
      intro: "Videos I have finished and published.",
      latest: "Latest video",
      all: "All videos",
      none: "No videos yet.",
      play: (t) => `Play video: ${t}`,
      watch: "Watch on YouTube",
    },
    search: {
      label: "Search the site",
      placeholder: "Search…",
      button: "Search",
      title: "Search",
      results: (n, q) => `${n} ${n === 1 ? "result" : "results"} for “${q}”`,
      none: (q) => `Nothing found for “${q}”. Try fewer or different words.`,
      hint: "Type a word or two to search every page.",
      tooShort: "Type at least two letters.",
      kinds: { home: "Home", about: "About", now: "Now", uses: "Uses", project: "Project", article: "Article" },
    },
  },
  es: {
    skip: "Saltar al contenido",
    nav: { home: "Inicio", about: "Sobre mí", projects: "Proyectos", writing: "Escritos", uses: "Herramientas", now: "Ahora", videos: "Videos", contact: "Contacto" },
    now: "Ahora",
    seeNow: "Leer más",
    allProjects: "Todos los proyectos",
    featured: "Proyectos destacados",
    noProjects: "Todavía no hay nada aquí.",
    onThisPage: "En esta página",
    readMin: (n) => `${n} min de lectura`,
    language: "Idioma",
    notTranslated: "Aún sin traducir — ir al inicio en",
    status: { idea: "idea", in_progress: "en proceso", shipped: "lanzado", paused: "en pausa" },
    stack: "Hecho con",
    links: "Enlaces",
    years: (a, b) => (a ? (b === null || b === undefined ? `${a} – hoy` : b === a ? `${a}` : `${a} – ${b}`) : ""),
    notFoundTitle: "Página no encontrada",
    notFoundText: "Esa página no existe (o todavía no está publicada).",
    backHome: "Volver al inicio",
    footer: "Hecho a partir de mis propias notas.",
    noArticles: "Todavía no hay escritos aquí.",
    publishedOn: (d) => `Publicado el ${d}`,
    rss: "Suscribirse por RSS",
    writingIntro: "Notas sobre lo que construyo y lo que aprendo en el camino.",
    contact: {
      intro: "¿Tienes una pregunta o una idea? Escríbeme. Leo todo y respondo cuando puedo.",
      name: "Nombre",
      nameHint: "opcional",
      email: "Tu correo",
      message: "Mensaje",
      send: "Enviar mensaje",
      sending: "Enviando…",
      sent: "Mensaje enviado",
      sentText: "Gracias. Te responderé al correo que escribiste.",
      another: "Enviar otro mensaje",
      errors: { required: "Este campo es obligatorio.", invalid: "Eso no parece un correo.", short: "Escribe un poco más (al menos 10 caracteres).", long: "Es demasiado largo." },
      failed: "No se pudo enviar el mensaje. Inténtalo de nuevo en unos minutos.",
      tooMany: "Ya enviaste varios mensajes. Inténtalo más tarde.",
      verify: "Completa la verificación de arriba.",
      unavailable: "El formulario de contacto no está disponible por ahora.",
      privacy: "Solo uso tu correo para responderte. Los mensajes no se comparten.",
    },
    videos: {
      intro: "Videos que ya terminé y publiqué.",
      latest: "Último video",
      all: "Todos los videos",
      none: "Todavía no hay videos.",
      play: (t) => `Reproducir video: ${t}`,
      watch: "Ver en YouTube",
    },
    search: {
      label: "Buscar en el sitio",
      placeholder: "Buscar…",
      button: "Buscar",
      title: "Buscar",
      results: (n, q) => `${n} ${n === 1 ? "resultado" : "resultados"} para “${q}”`,
      none: (q) => `No se encontró nada para “${q}”. Prueba con menos palabras o con otras.`,
      hint: "Escribe una o dos palabras para buscar en todas las páginas.",
      tooShort: "Escribe al menos dos letras.",
      kinds: { home: "Inicio", about: "Sobre mí", now: "Ahora", uses: "Herramientas", project: "Proyecto", article: "Escrito" },
    },
  },
};

/** The language to use when a visitor arrives at "/": cookie first, then the browser's language, then the default. */
export function pickLang(cookie: string | undefined, acceptLanguage: string | null, fallback: Lang = "en"): Lang {
  if (cookie && isLang(cookie)) return cookie;
  for (const part of (acceptLanguage ?? "").split(",")) {
    const code = part.trim().slice(0, 2).toLowerCase();
    if (isLang(code)) return code;
  }
  return fallback;
}

/** "/en/about" → { lang: "en", rest: "/about" }; null when the path has no language. */
export function splitPath(pathname: string): { lang: Lang; rest: string } | null {
  const m = /^\/(en|es)(\/.*)?$/.exec(pathname);
  return m ? { lang: m[1] as Lang, rest: m[2] || "/" } : null;
}
