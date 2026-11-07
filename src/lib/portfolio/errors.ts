// Portfolio add-on — error helpers (pure, no server imports so tests can load them).
type PgError = { code?: string; message?: string } | null | undefined;

/** True when the error means "this table/column does not exist yet" (migration not run). */
export function isMissingPortfolio(error: PgError) {
  if (!error) return false;
  const c = error.code ?? "";
  return c === "42P01" || c === "42703" || c === "PGRST204" || c === "PGRST205" || (error.message ?? "").includes("portfolio_");
}
