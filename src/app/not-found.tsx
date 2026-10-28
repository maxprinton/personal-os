import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-[70dvh] w-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-surface p-6 text-center shadow-card sm:p-8">
        <p className="text-4xl font-semibold tracking-tight text-faint">404</p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">This page doesn’t exist</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted">It may have been deleted, or the link is old.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link href="/" className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg shadow-sm hover:bg-accent-hover">
            Go to Today
          </Link>
          <Link href="/notes" className="rounded-md border border-edge bg-surface px-4 py-2 text-sm font-medium hover:bg-subtle">
            Notes
          </Link>
        </div>
      </div>
    </main>
  );
}
