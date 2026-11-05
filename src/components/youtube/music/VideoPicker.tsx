"use client";

import { useRouter } from "next/navigation";

/** Music Lab add-on: choose "Free track" or one of the YouTube videos (loads its energy curve). */
export default function VideoPicker({ videos, current }: { videos: { id: string; label: string }[]; current: string | null }) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted">Music for</span>
      <select
        className="max-w-[16rem] rounded-md border border-line-strong bg-surface px-2 py-1"
        value={current ?? ""}
        onChange={(e) => router.push(e.target.value ? `/music-lab?video=${encodeURIComponent(e.target.value)}` : "/music-lab")}
      >
        <option value="">Free track (no video)</option>
        {videos.map((v) => (
          <option key={v.id} value={v.id}>
            {v.label}
          </option>
        ))}
      </select>
    </label>
  );
}
