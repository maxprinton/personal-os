import Link from "next/link";
import type { Tag } from "@/lib/tags";

export default function TagChips({ tags, base }: { tags: Tag[]; base: string }) {
  if (!tags.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {tags.map((t) => (
        <Link
          key={t.name}
          href={`${base}?tag=${encodeURIComponent(t.name)}`}
          className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-200"
        >
          #{t.name}
        </Link>
      ))}
    </span>
  );
}
