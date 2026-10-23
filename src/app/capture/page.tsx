import Nav from "@/components/Nav";
import QuickCapture from "@/components/QuickCapture";

export default function CapturePage() {
  return (
    <>
      <Nav active="/capture" />
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
        <h1 className="text-2xl font-semibold">Quick capture</h1>
        <p className="text-sm text-neutral-500">
          One box for tasks, notes and money. Works without internet: items wait on this device and sync later.
        </p>
        <QuickCapture autoFocus />
        <ul className="space-y-1 text-sm text-neutral-500">
          <li><code>spent 12 on lunch</code> → expense (Food)</li>
          <li><code>received 1500 salary</code> → income</li>
          <li><code>task: call mom tomorrow</code> → task for tomorrow</li>
          <li><code>note: idea</code> + more lines → note</li>
          <li>Any short text → task for today</li>
        </ul>
      </main>
    </>
  );
}
