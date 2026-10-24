import Link from "next/link";

/** Calendar v1 form, retired: blocks are now created in the calendar. */
export default function BlockForm() {
  return (
    <p className="rounded-lg border border-neutral-200 p-4 text-sm text-neutral-500">
      Blocks are created in the <Link href="/calendar" className="underline">calendar</Link>: click an empty time.
    </p>
  );
}
