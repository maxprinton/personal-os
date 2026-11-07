// Portfolio publishing — shapes shared by the server actions and the Publish dialog (no server code).
import type { HistoryItem } from "./engine";
import type { Warning } from "./warnings";

export type { HistoryItem };
export type PreviewData = {
  title: string;
  path: string;
  /** fingerprint of what was previewed; sent back on publish so a note edited meanwhile is caught */
  hash: string;
  html: string;
  summary: string | null;
  icon: string | null;
  cover: string | null;
  readingMinutes: number;
  warnings: Warning[];
  blocked: boolean;
  needsConfirm: boolean;
  /** this page is live right now (so publishing is an update) */
  live: boolean;
  nextVersion: number;
};
export type PreviewReply = { ok: true; preview: PreviewData } | { ok: false; error: string; warnings?: Warning[] };
export type PublishReply = { ok: true; version: number; path: string; site: "updated" | "skipped" | "failed"; siteError?: string } | { ok: false; error: string; warnings?: Warning[]; needsConfirm?: boolean; changed?: boolean };
export type SimpleReply = { ok: true; site?: "updated" | "skipped" | "failed"; note?: string } | { ok: false; error: string };
export type HistoryReply = { ok: true; items: HistoryItem[] } | { ok: false; error: string };
