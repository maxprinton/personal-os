// Guided lessons for the Telegram practice chat: a few steps each, and the chat tells you whether you did the step.
// Pure data + one checker (no database, no network); scripts/test-telegram.ts checks that every step's "try" text passes its own check.

/** What a practice step must look like for the lesson to move on. All given parts must match. */
export type Expect = {
  /** typed a message ("text") or tapped a button ("tap") */
  kind?: "text" | "tap";
  /** regular expression (case-insensitive) for what you typed */
  text?: string;
  /** regular expression for the button data you tapped */
  data?: string;
  /** you used ↩ Reply on a bot message */
  replied?: boolean;
  /** regular expression for what the bot answered (messages and the little notice after a tap) */
  reply?: string;
};
export type Step = { say: string; try?: string; hint?: string; expect: Expect };
export type Lesson = { id: string; title: string; goal: string; steps: Step[] };

/** What happened in one practice step (the chat sends this after each step). */
export type StepInfo = { kind: "text" | "tap"; text?: string; data?: string; replied?: boolean; botText: string };

export function stepPassed(e: Expect, info: StepInfo): boolean {
  if (e.kind && e.kind !== info.kind) return false;
  if (e.text && !new RegExp(e.text, "i").test(info.text ?? "")) return false;
  if (e.data && !new RegExp(e.data).test(info.data ?? "")) return false;
  if (e.replied !== undefined && Boolean(info.replied) !== e.replied) return false;
  if (e.reply && !new RegExp(e.reply, "i").test(info.botText)) return false;
  return true;
}

export const LESSONS: Lesson[] = [
  {
    id: "expense", title: "Your first expense", goal: "Save an expense, choose its account and take it back.",
    steps: [
      { say: "Log an expense the way you'd say it.", try: "spent 12 lunch", hint: "Start with spent, gasté, a minus or a $ sign, then the amount and what it was.", expect: { kind: "text", text: "^\\s*(spent|gast\\w*|-\\s*\\d|\\$\\s*\\d)", reply: "Which account|Saved ✓" } },
      { say: "It asks which account. Tap one of the account buttons.", hint: "If it saved straight away (you named an account), press Skip.", expect: { kind: "tap", data: "^ac:", reply: "Saved ✓" } },
      { say: "Changed your mind? Tap ↩ Undo under the Saved ✓ message.", expect: { kind: "tap", data: "^undo:", reply: "Undone|Nothing to undo" } },
    ],
  },
  {
    id: "tasks", title: "Tasks: add, see, finish", goal: "Add a task with a date, find it in your list and tick it off.",
    steps: [
      { say: "Add a task with a day in it.", try: "t: call mom friday", hint: "t: or task: or tarea:, then the text. Days like viernes, 5 nov, mañana work.", expect: { kind: "text", text: "^\\s*(t|task|tarea)\\s*:", reply: "Saved ✓" } },
      { say: "Open your open tasks.", try: "/tasks", expect: { kind: "text", text: "^/?(tasks|tareas)$", reply: "Open tasks" } },
      { say: "Tap the ✓ next to any task to finish it.", hint: "The ⏭ moves it to the next time its block happens; ⋯ opens date, block, rename and archive.", expect: { kind: "tap", data: "^td:", reply: "" } },
    ],
  },
  {
    id: "event", title: "Events and free days", goal: "Put an event on the calendar and mark a day off.",
    steps: [
      { say: "Add an event with a day and a time.", try: "evento: dentista viernes 3pm", expect: { kind: "text", text: "^\\s*(event|evento|cita)\\s*:", reply: "Saved ✓" } },
      { say: "Mark tomorrow as a free day.", try: "libre mañana", hint: "libre or free day, with a day or a range like “del 2 al 5 de nov”.", expect: { kind: "text", text: "^\\s*(libre|free|d[ií]a libre)", reply: "" } },
      { say: "It asks what to do with that day's tasks. Tap one of the options.", hint: "If there was nothing to ask, press Skip.", expect: { kind: "tap", reply: "" } },
    ],
  },
  {
    id: "fix", title: "Fix a mistake by replying", goal: "Correct a saved expense without deleting it.",
    steps: [
      { say: "Log an expense.", try: "spent 8 coffee", expect: { kind: "text", text: "^\\s*(spent|gast\\w*|-\\s*\\d|\\$\\s*\\d)", reply: "Which account|Saved ✓" } },
      { say: "Tap an account if it asks.", hint: "Press Skip if it already saved.", expect: { kind: "tap", data: "^ac:", reply: "Saved ✓" } },
      { say: "Press ↩ Reply under the Saved ✓ message and send the right amount: 15.", hint: "You can also reply with a date (ayer), an account or a category.", expect: { kind: "text", replied: true, reply: "." } },
    ],
  },
  {
    id: "habits", title: "Habits", goal: "See your streaks and tick a habit.",
    steps: [
      { say: "Look at your habits and streaks.", try: "/habits", expect: { kind: "text", text: "^/?(habits|habitos|rachas|streaks)$", reply: "Habits" } },
      { say: "Mark one as done: type done and the name of one of your habits.", hint: "For example: done stretch. skip also works.", expect: { kind: "text", text: "^\\s*(done|hecho|skip|listo)\\b", reply: "" } },
    ],
  },
  {
    id: "day", title: "See your day", goal: "Today, now and the week.",
    steps: [
      { say: "What's left today?", try: "/today", expect: { kind: "text", text: "^/?(today|hoy)$", reply: "" } },
      { say: "Only the block of right now.", try: "/now", expect: { kind: "text", text: "^/?(now|ahora)$", reply: "" } },
      { say: "And the rest of the week.", try: "/week", expect: { kind: "text", text: "^/?(week|semana)$", reply: "" } },
    ],
  },
  {
    id: "money", title: "Money overview", goal: "Balances, budgets and payments.",
    steps: [
      { say: "How much is in each account?", try: "/balance", expect: { kind: "text", text: "^/?(balance|saldo|cuentas|accounts)$", reply: "" } },
      { say: "How are your budgets?", try: "/budget", expect: { kind: "text", text: "^/?(budget|presupuesto)s?$", reply: "" } },
      { say: "What do you have to pay?", try: "/payments", expect: { kind: "text", text: "^/?(payments|pagos|bills)$", reply: "" } },
    ],
  },
  {
    id: "notes", title: "Notes and asking them", goal: "Save a note, then ask your notes a question and a follow-up.",
    steps: [
      { say: "Save a note: the first line is the title.", try: "note: Trip idea\nbook the hostel early #travel", expect: { kind: "text", text: "^\\s*(note|nota)\\s*:", reply: "Saved ✓" } },
      { say: "Ask your notes. (In practice the answer is made up from your notes; the real bot uses the AI.)", try: "@os what did I write about the trip?", expect: { kind: "text", text: "^\\s*(@os|/os|os\\s*:)", reply: "." } },
      { say: "Ask a follow-up: press ↩ Reply under the answer and write another question.", hint: "That is how the bot keeps the context of the same notes.", expect: { kind: "text", replied: true, reply: "." } },
    ],
  },
];
