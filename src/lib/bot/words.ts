// The whole-message command words of the bot (the text is compared after norm(): no accents, lower case,
// no leading emoji, no "?"). Pure data: the Telegram module (catalog, simulator, vocabulary) reads it too.
export const W = {
  help: ["/help", "/start", "help", "ayuda", "/ayuda"],
  menu: ["/menu", "menu", "/teclado"],
  tasks: ["/tareas", "tareas", "/tasks", "tasks", "/todo", "mis tareas", "todas las tareas", "all tasks"],
  archived: ["/archivadas", "archivadas", "/archived", "archived", "/archivo"],
  recurring: ["/recurrentes", "recurrentes", "/recurring", "recurring", "/repetir", "/repeticiones", "tareas recurrentes", "recurring tasks"],
  payments: ["/pagos", "pagos", "/payments", "payments", "/bills", "bills", "que tengo que pagar", "por pagar"],
  categorize: ["/categorizar", "categorizar", "/categorize", "categorize", "/autocat", "/categorias", "categorias automaticas"],
  proposals: ["/propuestas", "propuestas", "/proposals", "proposals", "/nuevascategorias"],
  unassigned: ["/sincuenta", "sincuenta", "sin cuenta", "/unassigned", "unassigned", "/no_account"],
  budget: ["/presupuesto", "/presupuestos", "presupuesto", "presupuestos", "/budget", "/budgets", "budget", "budgets"],
  movements: ["/movimientos", "movimientos", "/movements", "movements", "/txns", "/transactions", "transactions", "ultimos movimientos", "/recent"],
  notes: ["/notas", "notas", "/notes", "notes", "mis notas"],
  habits: ["/habitos", "habitos", "/habits", "habits", "rachas", "/streaks", "streaks"],
  insights: ["/insights", "insights", "/consejos"],
  metrics: ["/metricas", "metricas", "/metrics", "metrics"],
  settings: ["/ajustes", "ajustes", "/settings", "settings", "/config", "config", "configuracion"],
  ai: ["/ai"],
  usage: ["/usage", "/uso", "usage", "uso"],
  work: ["/teaching", "teaching", "/work", "work", "/trabajo", "trabajo", "/horas", "horas", "/clases", "clases", "/videos", "videos"],
  undo: ["/undo", "/deshacer", "deshacer", "undo"],
};

export type Words = Record<keyof typeof W, string[]>;
