// Starter text for a new portfolio note, by page kind and language.
// Plain Markdown only (no private links, no to-do items, no raw HTML) so a fresh page renders with zero warnings.
import type { Lang, SlotKind } from "./constants";

type Starter = Record<Lang, string>;

const STARTERS: Record<SlotKind, Starter> = {
  home: {
    en: "I build tools for my own life, then teach what I learn.\n\nWrite two or three short sentences about what you do and who this site is for.\n",
    es: "Construyo herramientas para mi propia vida y luego enseño lo que aprendo.\n\nEscribe dos o tres frases cortas sobre lo que haces y para quién es este sitio.\n",
  },
  about: {
    en: "## Who I am\n\nOne short paragraph. Where you are, what you do, what you care about.\n\n## What I work on\n\nThe things you spend your time on right now.\n\n## How to reach me\n\nWhere people can find you.\n",
    es: "## Quién soy\n\nUn párrafo corto. Dónde estás, qué haces, qué te importa.\n\n## En qué trabajo\n\nLas cosas a las que dedicas tu tiempo ahora.\n\n## Cómo contactarme\n\nDónde pueden encontrarte.\n",
  },
  now: {
    en: "## Right now\n\nWhat you are focused on this month.\n\n## Learning\n\nWhat you are studying or practicing.\n\n## Reading and watching\n\nWhat is on your desk.\n",
    es: "## Ahora mismo\n\nEn qué estás enfocado este mes.\n\n## Aprendiendo\n\nLo que estás estudiando o practicando.\n\n## Leyendo y viendo\n\nLo que tienes en tu escritorio.\n",
  },
  uses: {
    en: "## Hardware\n\nThe computer, phone and gear you use every day.\n\n## Software\n\nThe apps and tools you open first.\n\n## Why these\n\nOne or two lines on how you chose them.\n",
    es: "## Hardware\n\nLa computadora, el teléfono y el equipo que usas todos los días.\n\n## Software\n\nLas apps y herramientas que abres primero.\n\n## Por qué estas\n\nUna o dos líneas sobre cómo las elegiste.\n",
  },
  project: {
    en: "A one-line summary of what this project is.\n\n## Why I built it\n\nThe problem, in plain words.\n\n## How it works\n\nThe main idea, and the tools you used.\n\n## What I learned\n\nWhat you would tell someone starting the same thing.\n",
    es: "Un resumen de una línea de qué es este proyecto.\n\n## Por qué lo hice\n\nEl problema, en palabras simples.\n\n## Cómo funciona\n\nLa idea principal y las herramientas que usaste.\n\n## Qué aprendí\n\nLo que le dirías a alguien que empieza lo mismo.\n",
  },
  article: {
    en: "A first paragraph that says what the reader will get from this.\n\n## The problem\n\nStart with what went wrong or what you wanted.\n\n## What I did\n\nThe steps, in order.\n\n## What to take from it\n\nThe short version.\n",
    es: "Un primer párrafo que diga qué se lleva quien lo lea.\n\n## El problema\n\nEmpieza con lo que salió mal o lo que querías.\n\n## Lo que hice\n\nLos pasos, en orden.\n\n## Lo que te llevas\n\nLa versión corta.\n",
  },
};

/** Starter Markdown for a new note of this page kind in this language. */
export function starterFor(kind: SlotKind, lang: Lang): string {
  return STARTERS[kind][lang];
}
