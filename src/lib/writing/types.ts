// The writing checker (spelling + simple rules, Spanish and English). Pure types: browser, worker, tests.

export type Lang = "es" | "en";
export type IssueKind = "spelling" | "repeat" | "space" | "capital" | "punct";

/** One problem in a text: [from, to) are character offsets in the text that was checked. */
export type Issue = {
  from: number;
  to: number;
  kind: IssueKind;
  /** The text it covers, as written. */
  word: string;
  /** Short message in English (the app's language), e.g. "Possible spelling mistake". */
  message: string;
  /** Replacements for [from, to), best first ("" = delete it). */
  suggestions: string[];
  /** Spelling: the language of its sentence (its suggestions come from that dictionary first). */
  lang?: Lang;
};

export type CheckResult = { lang: Lang; issues: Issue[] };

/** What the checker needs from a dictionary (nspell has these). */
export interface Speller {
  correct(word: string): boolean;
  suggest(word: string): string[];
}

/** Characters the checker must skip (code, links, mentions…): words never cross them. */
export const MASK = "￼";
