import AskChat from "@/components/ask/AskChat";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ask your notes · Personal OS" };

/** BL-22: @os as a full page, with every saved conversation on the side. */
export default function AskPage() {
  return (
    <main className="mx-auto w-full max-w-[1100px] space-y-6 px-4 py-6 sm:px-8 lg:py-9">
      <div>
        <h1 className="font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">Ask your notes</h1>
        <p className="mt-2 text-muted">Answers come from your own notes, with links to the ones used.</p>
      </div>
      <AskChat wide />
    </main>
  );
}
