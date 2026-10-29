// The 4 starter templates every user gets once (they can edit or delete them). Content in Spanish,
// Notion-flavored Markdown (the note editor's format). typeOption / areaOption = built-in option ids.
export type StarterDef = {
  starter: "diario" | "semanal" | "reunion" | "aprendizaje";
  title: string;
  icon: string;
  typeOption: string;
  areaOption?: string;
  /** "Use for Type": choosing that Type on an empty note fills it with this template. */
  forType?: boolean;
  content: string;
};

export const STARTERS: StarterDef[] = [
  {
    starter: "diario",
    title: "Diario — {{fecha}}",
    icon: "📔",
    typeOption: "diario",
    areaOption: "personal",
    forType: true,
    content: `<callout icon="🌙" color="blue_bg">

Unos minutos para cerrar el día. No tiene que ser perfecto.

</callout>

## ¿Cómo me siento?

Del 1 al 10:

## 3 cosas buenas de hoy

1. Algo bueno
2. Algo bueno
3. Algo bueno

## ¿Qué aprendí?

## Pendientes para mañana

- [ ] Primera cosa
- [ ] Segunda cosa
`,
  },
  {
    starter: "semanal",
    title: "Semana {{week}} — Revisión",
    icon: "🗓️",
    typeOption: "plan",
    content: `<callout icon="🗓️" color="purple_bg">

Revisión de la semana {{week}} · {{date}}. Mira tu calendario y tus notas de la semana antes de empezar.

</callout>

## Logros

- 

## Qué no salió y por qué

- 

## Prioridades de la próxima semana

- [ ] Prioridad 1
- [ ] Prioridad 2
- [ ] Prioridad 3

## Hábitos (cómo me fue)

- Ejercicio:
- Lectura:
- Sueño:
`,
  },
  {
    starter: "reunion",
    title: "Reunión — ",
    icon: "🤝",
    typeOption: "reunion",
    forType: true,
    content: `**Fecha:** {{fecha}}, {{time}}

## Con quién

- 

## Temas

1. Tema

## Decisiones

- 

## Tareas que salen

- [ ] Tarea · responsable · fecha

## Próximos pasos

- 
`,
  },
  {
    starter: "aprendizaje",
    title: "Aprendizaje — ",
    icon: "📚",
    typeOption: "aprendizaje",
    areaOption: "aprendizaje",
    forType: true,
    content: `<callout icon="💡" color="yellow_bg">

Pega la fuente (libro, video, artículo) en la propiedad **Source**.

</callout>

## Ideas clave

- 

## Citas

> Una frase que valga la pena recordar.

## Cómo lo aplico

- [ ] Algo concreto que voy a hacer
`,
  },
];
