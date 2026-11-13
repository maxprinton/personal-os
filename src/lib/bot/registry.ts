// The Telegram bot's feature library: every thing the bot can do, with how it works and examples to practice.
// It lives in the code on purpose: the command words come straight from the bot's own lists (words.ts), and
// scripts/test-telegram.ts fails when a command word exists without a feature here — so adding or editing a bot
// feature means adding or editing its entry in this file, and the Telegram page (catalog + simulator) shows it
// right after the next publish. Pure data: no database, no network (the page and the tests both import it).
import { W } from "@/lib/bot/words";
import { bare, type VocabFeature } from "@/lib/bot/vocab";

export type GroupId = "save" | "see" | "fix" | "ask" | "auto" | "setup";
export const GROUPS: { id: GroupId; label: string; hint: string }[] = [
  { id: "save", label: "Save things", hint: "Type it the way you'd say it" },
  { id: "see", label: "See things", hint: "Commands that show your data" },
  { id: "fix", label: "Fix & undo", hint: "Take it back, or correct it" },
  { id: "ask", label: "Ask & AI", hint: "Questions and the free AI" },
  { id: "auto", label: "Automatic messages", hint: "What the bot sends on its own" },
  { id: "setup", label: "Setup", hint: "Help, buttons and linking" },
];

export type Feature = {
  id: string;
  group: GroupId;
  title: string;
  summary: string;
  /** How it works, one rule per line. */
  how: string[];
  /** Things to try in the simulator. */
  examples: { text: string; note?: string }[];
  /** The bot's own list of words (words.ts) — the catalog shows it live. */
  wordsKey?: keyof typeof W;
  /** Built-in words when the bot reads them somewhere else than words.ts (kept in step by the tests). */
  words?: string[];
  /** The command your own words are rewritten to. Only features with a canonical command can be renamed. */
  canonical?: string;
  /** The command is followed by text ("/search gym"). */
  takesArg?: boolean;
  /** Money or the system itself: you can add words, but the originals stay (and nothing here is switched off). */
  locked?: boolean;
  /** Needs the free AI (voice, photos, questions to your notes): the simulator shows an example instead. */
  ai?: boolean;
  demo?: { input: string; reply: string };
};

export const FEATURES: Feature[] = [
  // ---- Save things -----------------------------------------------------------------------
  {
    id: "expense", group: "save", locked: true, title: "Log an expense",
    summary: "Write what you spent. The bot finds the amount, the description and the category.",
    how: [
      "Start with spent, gasté, a minus sign or a $ amount.",
      "No account in the message? It asks with buttons (after 10 minutes it saves without one).",
      "Dates work: ayer, el viernes (for money, the last Friday).",
      "Amounts with thousands work: 1.500, 1,500, 1.234,56.",
      "It ends with Saved ✓ and an Undo button.",
    ],
    examples: [
      { text: "spent 12 lunch" },
      { text: "gasté 5,50 en uber ayer" },
      { text: "-20 dinner" },
      { text: "$45 groceries" },
      { text: "gasté 1.500 en arriendo", note: "Thousands separators are read correctly." },
    ],
  },
  {
    id: "income", group: "save", locked: true, title: "Log income",
    summary: "Money that comes in: a salary, a client payment.",
    how: ["Start with received, cobré or a plus sign.", "Same account question and Undo as an expense."],
    examples: [{ text: "received 1500 salary" }, { text: "cobré 300" }, { text: "+300 client" }],
  },
  {
    id: "transfer", group: "save", locked: true, title: "Move money between accounts",
    summary: "A transfer is not an expense: it only moves money from one account to another.",
    how: ["Say the amount, the account it leaves and the account it goes to.", "Account names are matched loosely (efectivo, visa, pichincha)."],
    examples: [{ text: "transfer 50 from efectivo to pichincha" }, { text: "transferí 50 de efectivo a visa" }],
  },
  {
    id: "task", group: "save", title: "Add a task",
    summary: "A task with an optional date, home block (@) and tag (#).",
    how: [
      "Start with t: or task: / tarea:.",
      "A date in the text sets the day: viernes, 5 nov, mañana, en 3 días.",
      "@Block puts it in a block, #tag adds a tag.",
      "Add “every 3 days” (or “cada 2 semanas”, “every month”) and it repeats: 3 days after you mark it done, the next one appears.",
      "Any short text without a command also becomes a task for today.",
    ],
    examples: [
      { text: "t: llamar a mamá el viernes" },
      { text: "t: informe @Deep work #trabajo" },
      { text: "tarea: dentista 5 nov" },
      { text: "t: limpiar el baño cada 3 días", note: "Repeats 3 days after you finish it (see /recurring)." },
      { text: "buy milk", note: "No command: a short text becomes a task for today." },
    ],
  },
  {
    id: "note", group: "save", title: "Save a note",
    summary: "The first line is the title, the next lines are the text.",
    how: ["Start with note: or nota:.", "More lines after the first one become the body.", "#tags in the text are added as tags."],
    examples: [{ text: "note: Trip idea\nbook the hostel early #travel" }],
  },
  {
    id: "event", group: "save", title: "Add an event",
    summary: "Something at a date and time: an appointment, a trip.",
    how: ["Start with event:, evento: or cita:.", "No time = all day. A time with no end = 1 hour.", "Ranges work: 2-5 nov, 10:00-11:30."],
    examples: [{ text: "evento: dentista viernes 3pm" }, { text: "event: viaje 2-5 nov" }, { text: "cita: médico mañana 10:00-11:30" }],
  },
  {
    id: "payment-plan", group: "save", locked: true, title: "Schedule a recurring payment or income",
    summary: "Rent, internet, a salary: it creates the payment and all its future dates.",
    how: ["Start with payment: / pago: (money out) or income: / cobro: (money in).", "Say how often: monthly on the 10th, cada mes el 5, cada 15 días.", "Add the account at the end: con pichincha."],
    examples: [{ text: "pago: luz 25 cada mes el 5" }, { text: "payment: internet 32 monthly on the 10th con pichincha" }],
  },
  {
    id: "free-day", group: "save", title: "Mark a free day",
    summary: "A day off: the bot asks what to do with that day's tasks.",
    how: ["Say libre, free day or día libre, with a day or a range.", "Alone it means today."],
    examples: [{ text: "libre mañana" }, { text: "día libre del 2 al 5 de nov viaje" }],
  },
  {
    id: "block-note", group: "save", title: "Add to a block's note",
    summary: "Jot something into the note of the block you're in (or the one you name).",
    how: ["nb: text goes to the block of right now.", "nb Gym: text goes to the block called Gym.", "[] at the start makes a checkbox."],
    examples: [{ text: "nb: repasar el plan" }, { text: "nb Gym: [] foam roller" }],
  },
  {
    id: "habit-create", group: "save", title: "Create a habit",
    summary: "A habit that lives inside one of your blocks.",
    how: ["habit: Name in Block. If the block doesn't exist, it offers your blocks."],
    examples: [{ text: "habit: Stretch in Gym" }, { text: "hábito: Leer en Noche" }],
  },
  {
    id: "habit-mark", group: "save", title: "Mark a habit (or finish a task)",
    summary: "done, hecho or skip + the name. If it isn't a habit, it completes the task with that name.",
    how: ["done stretch / hecho leer / skip meditar mark today's habit.", "listo el informe completes a task; with doubts it shows buttons.", "You can mark yesterday's habits until 3:00 AM."],
    examples: [{ text: "done stretch" }, { text: "skip meditar" }, { text: "listo el informe" }],
  },
  {
    id: "metric", group: "save", title: "Log a metric",
    summary: "Today's number for a metric you track (sleep, water…).",
    how: ["Write the metric's name and a number: sleep 7.5, agua +1.", "It uses your own metric names (see /metrics)."],
    examples: [{ text: "sleep 7.5" }, { text: "agua +1" }],
  },
  {
    id: "set-balance", group: "save", locked: true, title: "Set the real balance of an account",
    summary: "Tell the bot what the account really has; it shows the difference and asks for ✓.",
    how: ["saldo / balance + account + amount.", "The first time for an account is its starting point (no adjustment).", "After that, the difference is saved as a “Balance adjustment” in the Adjustment category."],
    examples: [{ text: "saldo pichincha 1234,50" }, { text: "balance visa -300" }],
  },
  {
    id: "voice-photo", group: "save", ai: true, title: "Voice notes and receipt photos",
    summary: "Send a voice note and it's handled like typed text; send a receipt photo and it saves the expense with the picture.",
    how: ["Needs the free AI (Groq) and counts toward the daily limit.", "Voice notes up to 3 minutes. The bot shows what it heard (🎙) before saving.", "The receipt photo stays with the expense (🧾)."],
    examples: [],
    demo: { input: "🎙 (voice) “spent twelve dollars on lunch”", reply: "🎙 “spent twelve dollars on lunch”\n\nWhich account? (if you don't tap one, in 10 minutes it is saved without an account)" },
  },
  {
    id: "youtube-idea", group: "save", title: "Save a video idea",
    summary: "Drops an idea in the YouTube idea bank (also by voice).",
    how: ["yt: your idea, or yt shorts: for a Short idea."],
    examples: [{ text: "yt: why most to-do lists fail" }],
  },
  {
    id: "teaching-video", group: "save", title: "Mark a class video as posted",
    summary: "Teaching add-on: tells the log that you posted the video for a class.",
    how: ["video <class> <Drive link>."],
    examples: [{ text: "video B2-5 https://drive.google.com/file/d/example" }],
  },

  // ---- See things ------------------------------------------------------------------------
  {
    id: "today", group: "see", title: "Today", canonical: "/today",
    words: ["/hoy", "/today", "/status", "/pendientes", "hoy", "today", "status", "estado", "pendientes", "pending", "que tengo", "que tengo hoy", "que me falta", "que falta", "whats left"],
    summary: "Current block, tasks, habits, payments, what's left and the block notes — with buttons.",
    how: ["Tap ✓ on a task or habit right there; an Undo takes its place.", "Same as the 📅 Today button under the keyboard."],
    examples: [{ text: "/today" }, { text: "que me falta" }],
  },
  {
    id: "now", group: "see", title: "Now", canonical: "/now",
    words: ["/now", "now", "/ahora", "ahora", "que toca ahora", "que toca"],
    summary: "Only the block of right now: its tasks, habits, note and balance, with ✓ for the whole block.",
    how: ["✓ Block marks the block and all its habits; again = reopen."],
    examples: [{ text: "/now" }],
  },
  {
    id: "tomorrow", group: "see", title: "Tomorrow", canonical: "/tomorrow",
    words: ["/tomorrow", "/manana", "tomorrow", "manana", "que tengo manana", "whats tomorrow"],
    summary: "Tomorrow's agenda.", how: ["Same layout as any day."], examples: [{ text: "/tomorrow" }],
  },
  {
    id: "week", group: "see", title: "This week", canonical: "/week",
    words: ["/thisweek", "/week", "week", "semana", "/semana", "/estasemana", "this week", "esta semana", "que tengo esta semana"],
    summary: "The rest of the week, one line per day, with a button per day.", how: ["Tap a day's button to open it."], examples: [{ text: "/week" }],
  },
  {
    id: "nextweek", group: "see", title: "Next week", canonical: "/nextweek",
    words: ["/nextweek", "/proximasemana", "next week", "proxima semana", "la proxima semana", "semana que viene", "la semana que viene"],
    summary: "Next week's agenda.", how: ["One button per day."], examples: [{ text: "/nextweek" }],
  },
  {
    id: "day", group: "see", title: "Any day", canonical: "/day", takesArg: true,
    words: ["/dia", "/day", "dia", "day", "que tengo", "what do i have", "what do i have on", "agenda"],
    summary: "The agenda of a day you name.", how: ["Say the day after the command: viernes, 5, 12/11, 2026-11-05."],
    examples: [{ text: "/day viernes" }, { text: "what do I have on the 5th" }],
  },
  { id: "tasks", group: "see", title: "All open tasks", wordsKey: "tasks", canonical: "/tasks", summary: "Every open task, 8 per page, with buttons.", how: ["✓ done · ⏭ next time its block happens · ⋯ date, block, rename, archive.", "Only the row you tap changes; an Undo appears in its place."], examples: [{ text: "/tasks" }] },
  {
    id: "recurring", group: "see", title: "Recurring tasks", wordsKey: "recurring", canonical: "/recurring",
    summary: "Tasks that come back by themselves after you finish them, with when each is due. ⏸ Pause / ▶ Resume.",
    how: [
      "Create one by adding “every 3 days” to a task: t: clean the bathroom every 3 days.",
      "The interval counts from the day you mark it done: finish it on day 4 and the next one is due 3 days after day 4.",
      "Pausing keeps it in the list; resuming brings its next task back. Edit or stop one in the app (Tasks → Recurring).",
    ],
    examples: [{ text: "/recurring" }, { text: "t: water plants every 2 days" }],
  },
  { id: "archived", group: "see", title: "Archived tasks", wordsKey: "archived", canonical: "/archived", summary: "Archived tasks, with ↩ to bring one back to today.", how: ["Archive from the ⋯ menu of a task."], examples: [{ text: "/archived" }] },
  { id: "payments", group: "see", locked: true, title: "Payments", wordsKey: "payments", canonical: "/payments", summary: "Payments to do now (💳 Pay / Skip) and the next three weeks.", how: ["💳 Pay offers the account you used last time (⭐) and the expected amount, or “Another amount”.", "If it was already paid, it warns you first."], examples: [{ text: "/payments" }] },
  {
    id: "balance", group: "see", locked: true, title: "Balances", canonical: "/balance",
    words: ["/balance", "/balances", "balance", "balances", "/saldo", "/saldos", "saldo", "saldos", "/cuentas", "cuentas", "/accounts", "accounts"],
    summary: "The balance of every account.", how: ["To set the real balance of one account, see “Set the real balance”."], examples: [{ text: "/balance" }],
  },
  { id: "budget", group: "see", locked: true, title: "Budgets", wordsKey: "budget", canonical: "/budget", summary: "Each budget: spent, what's left, a bar, and this month's balance adjustments.", how: [], examples: [{ text: "/budget" }] },
  { id: "movements", group: "see", locked: true, title: "Latest movements", wordsKey: "movements", canonical: "/movements", summary: "The last 10 movements, each with 🗑 delete · 🏦 change account · 🧾 see receipt.", how: [], examples: [{ text: "/movements" }] },
  { id: "unassigned", group: "see", locked: true, title: "Movements without an account", wordsKey: "unassigned", canonical: "/unassigned", summary: "One by one, with the account buttons.", how: [], examples: [{ text: "/unassigned" }] },
  { id: "categorize", group: "see", ai: true, title: "Categorize with AI", wordsKey: "categorize", canonical: "/categorize", summary: "The AI categorizes what has no category (your habits first) and tells you how many are left for you.", how: ["Needs the free AI. In practice the AI is faked and nothing is changed for real."], examples: [{ text: "/categorize" }] },
  { id: "proposals", group: "see", title: "New categories the AI proposes", wordsKey: "proposals", canonical: "/proposals", summary: "✓ Create (it's created and applied) or ✕ Skip (never proposed again).", how: ["Nothing is created until you approve."], examples: [{ text: "/proposals" }] },
  { id: "search", group: "see", title: "Search", canonical: "/search", takesArg: true, words: ["/buscar", "/search", "/find", "buscar", "busca", "search", "find"], summary: "Tasks, notes, events and money that contain a word (no AI).", how: ["Put the word after the command."], examples: [{ text: "/search gym" }] },
  { id: "notes", group: "see", title: "Latest notes", wordsKey: "notes", canonical: "/notes", summary: "Open, ✏️ add text, or 🗑 delete a note.", how: [], examples: [{ text: "/notes" }] },
  { id: "habits", group: "see", title: "Habits and streaks", wordsKey: "habits", canonical: "/habits", summary: "Streak, best streak, % and the last 7 days (✓ done · · skipped · ✗ missed).", how: [], examples: [{ text: "/habits" }] },
  { id: "metrics", group: "see", title: "Metrics", wordsKey: "metrics", canonical: "/metrics", summary: "Today's metrics and the 7-day average.", how: [], examples: [{ text: "/metrics" }] },
  { id: "insights", group: "see", title: "Insights", wordsKey: "insights", canonical: "/insights", summary: "Unread insights, ✓ mark read, 🔄 generate now.", how: [], examples: [{ text: "/insights" }] },
  { id: "settings", group: "see", title: "Reminder settings", wordsKey: "settings", canonical: "/settings", summary: "Turn each reminder on or off and set its hour, with buttons.", how: [], examples: [{ text: "/settings" }] },
  { id: "usage", group: "see", title: "AI usage today", wordsKey: "usage", canonical: "/usage", summary: "How much of the free AI you used today and what's left.", how: [], examples: [{ text: "/usage" }], ai: true },
  { id: "ai-check", group: "see", title: "Is the AI connected?", wordsKey: "ai", summary: "A quick check of the AI key.", how: [], examples: [{ text: "/ai" }], ai: true },
  { id: "teaching", group: "see", title: "Teaching: classes, hours, pay", wordsKey: "work", canonical: "/teaching", summary: "Your classes, hours and pay this month, plus the videos you still owe.", how: ["Also /work."], examples: [{ text: "/teaching" }] },
  { id: "youtube", group: "see", title: "YouTube pipeline", words: ["/youtube", "youtube", "/yt", "yt"], canonical: "/youtube", summary: "Ideas in the bank, videos in progress, the latest published.", how: [], examples: [{ text: "/youtube" }] },
  { id: "portfolio", group: "see", title: "Portfolio status", words: ["/portfolio", "portfolio", "/portafolio", "portafolio"], canonical: "/portfolio", summary: "Each page of your public site: ✅ live · 🟠 changed since publishing · 📝 draft, and unread messages.", how: [], examples: [{ text: "/portfolio" }] },
  { id: "inbox", group: "see", title: "Contact-form inbox", words: ["/inbox", "inbox", "/bandeja", "bandeja"], canonical: "/inbox", summary: "The latest messages from your site's contact form (🔵 unread). It doesn't mark them read.", how: [], examples: [{ text: "/inbox" }] },
  { id: "checkin", group: "see", title: "Daily check-in", words: ["/checkin", "checkin", "/chequeo", "chequeo"], canonical: "/checkin", summary: "Your day at a glance, with buttons for mood, energy and sleep.", how: ["Also arrives by itself at 21:00."], examples: [{ text: "/checkin" }] },
  { id: "mood-energy", group: "see", title: "Mood and energy", words: ["/mood", "/animo", "/energy", "/energia"], summary: "A number from 1 to 10.", how: ["/mood 7 · /energy 6."], examples: [{ text: "/mood 7" }, { text: "/energy 6" }] },
  { id: "sleep-times", group: "see", title: "Bedtime and wake-up", words: ["/bed", "/dormir", "/woke", "/desperte"], summary: "Log when you went to bed and woke up.", how: ["/bed 23:30 · /woke 7:15. Alone = right now."], examples: [{ text: "/bed 23:30" }, { text: "/woke 7:15" }] },
  { id: "highlight", group: "see", title: "Highlight of the day", words: ["/highlight", "/destacado"], summary: "One line about the best thing of your day.", how: ["/highlight shipped the portfolio."], examples: [{ text: "/highlight shipped the portfolio" }] },
  { id: "review", group: "see", title: "Week review", words: ["/review", "/progress", "/semanal"], canonical: "/review", summary: "This week vs the last one.", how: [], examples: [{ text: "/review" }] },

  // ---- Fix & undo ------------------------------------------------------------------------
  {
    id: "undo", group: "fix", locked: true, title: "Undo", wordsKey: "undo", canonical: "/undo",
    summary: "Takes back the last thing: a save, a completed or moved task, a payment, a mark.",
    how: ["Every save has an Undo button under it; /undo does the last one."],
    examples: [{ text: "spent 3 coffee" }, { text: "/undo" }],
  },
  {
    id: "reply-fix", group: "fix", title: "Correct by replying",
    summary: "Reply (swipe → reply) to a “Saved ✓” message to change what it saved.",
    how: ["To an expense: an amount (15), an account (visa), a date (ayer), a category (food) or a new text.", "To a task: a date (viernes), @Block, hecha, or a new name.", "To a note: text is added; título: X renames it.", "borrar undoes it. In the simulator, use the Reply button on a bot message."],
    examples: [{ text: "spent 12 lunch" }],
  },
  {
    id: "task-buttons", group: "fix", title: "Task, habit and block buttons",
    summary: "Buttons under /today, /now and /tasks change only the row you tap.",
    how: ["✓ done · ⏭ next time its block happens · ⋯ → 📅 date, 🧱 block, ✏️ rename, 🗄 archive.", "Habits: ✓ / Skip. Blocks: ✓ Block."],
    examples: [{ text: "/tasks" }],
  },
  {
    id: "account-picker", group: "fix", locked: true, title: "Account question",
    summary: "A money message with no account asks which one, with buttons.",
    how: ["Tap an account, “No account” or Cancel.", "If you don't answer, in 10 minutes it is saved without an account and appears in /unassigned."],
    examples: [{ text: "spent 7 pizza" }],
  },

  // ---- Ask & AI --------------------------------------------------------------------------
  {
    id: "ask-os", group: "ask", ai: true, title: "Ask your notes (@os)",
    summary: "Finds the notes, reads them and answers. Reply to the answer to ask more.",
    how: ["@os question · /os question · by voice “OS, …”.", "@os NOTE-12 gives a short summary of that note; add a question to ask only that note."],
    examples: [{ text: "@os what did I write about the trip?", note: "In practice the answer is made up from your notes" }],
  },

  // ---- Automatic messages ----------------------------------------------------------------
  { id: "morning", group: "auto", title: "Morning summary (7:00)", summary: "Agenda, tasks with buttons and payments with 💳.", how: ["Turn it on or off, and change the hour, in /settings."], examples: [] },
  { id: "before", group: "auto", title: "Heads-up before an event or block", summary: "A message X minutes before each event or block.", how: ["Set X in /settings."], examples: [] },
  { id: "night", group: "auto", title: "Night check (21:00)", summary: "Your day with ✓ / Skip buttons, and the mood / energy check-in.", how: [], examples: [] },
  { id: "weekly", group: "auto", title: "Monday insights and portfolio reminder", summary: "Insights on Mondays at 8:00, the portfolio reminder at 10:00.", how: [], examples: [] },

  // ---- Setup -----------------------------------------------------------------------------
  { id: "help", group: "setup", locked: true, title: "Help and buttons", wordsKey: "help", canonical: "/help", summary: "Everything the bot understands, and the buttons under the keyboard.", how: ["Buttons: 📅 Today · ▶️ Now · 🌙 Tomorrow · 📋 Tasks · 💳 Payments · 💰 Balance · 🔎 Search · ⚙️ Settings · ❓ Help."], examples: [{ text: "/help" }] },
  { id: "menu", group: "setup", title: "Show the keyboard buttons", wordsKey: "menu", canonical: "/menu", summary: "Brings the buttons back if you don't see them.", how: [], examples: [{ text: "/menu" }] },
  { id: "link", group: "setup", title: "Link this chat", summary: "In Settings → Telegram get a code, then send /link CODE in the chat.", how: ["Linking only works in the real Telegram chat, not in the simulator."], examples: [] },
  { id: "noise", group: "setup", title: "Things that are not saved", summary: "“ok”, “gracias”, “hola”, “jaja”, 👍 … get a 👋 and nothing is saved.", how: [], examples: [{ text: "gracias" }] },
];

export const featureById = (id: string) => FEATURES.find((f) => f.id === id);

/** The built-in words of a feature: the bot's own list when it has one, else the ones declared here. */
export const baseWords = (f: Feature): string[] => (f.wordsKey ? W[f.wordsKey] : (f.words ?? []));

/** Can its words be renamed? Only features with a command of their own. */
export const isEditable = (f: Feature) => Boolean(f.canonical) && baseWords(f).length > 0;

/** What the vocabulary rewriter needs. */
export function vocabFeatures(): VocabFeature[] {
  return FEATURES.filter(isEditable).map((f) => ({ id: f.id, canonical: f.canonical!, words: baseWords(f), takesArg: Boolean(f.takesArg), locked: Boolean(f.locked) }));
}

/** Every word (without "/") some feature already answers to, to refuse a new word that is taken. */
export function takenWords(): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of FEATURES) for (const w of baseWords(f)) if (!m.has(bare(w))) m.set(bare(w), f.id);
  return m;
}
