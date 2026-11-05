"use client";
// Research Laboratory screen (Worker A). Left: the notes drawer. Center: the board — the video's buckets,
// or the topic shelves on /youtube/lab (videoId null). Drag & drop on computers; buttons everywhere.
import { useEffect, useMemo, useState } from "react";
import NotesDrawer from "./NotesDrawer";
import BucketBoard from "./BucketBoard";
import type { LabBucket, LabCard, LabNote, LabOption, LabReference, LabVideo } from "./shared";

/** Drag & drop only with a mouse / trackpad (phones and tablets get the buttons only). */
function useCanDrag() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(pointer: fine)");
    setOk(m.matches);
    const on = () => setOk(m.matches);
    m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, []);
  return ok;
}

export default function ResearchLab({
  videoId,
  terms,
  notes,
  typeOptions,
  areaOptions,
  buckets,
  cards,
  shelves,
  shelfCards,
  references,
  usedIn,
  aiReady,
}: {
  videoId: string | null;
  terms: string[];
  notes: LabNote[];
  typeOptions: LabOption[];
  areaOptions: LabOption[];
  /** The board: the video's buckets, or the shelves on /youtube/lab. */
  buckets: LabBucket[];
  cards: LabCard[];
  /** Topic shelves to copy from (video page only). */
  shelves: LabBucket[];
  shelfCards: LabCard[];
  references: LabReference[];
  usedIn: Record<string, LabVideo[]>;
  aiReady: boolean;
}) {
  const canDrag = useCanDrag();
  const [drawer, setDrawer] = useState(true);
  const notesById = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);
  const refsById = useMemo(() => new Map(references.map((r) => [r.id, r])), [references]);
  const onBoard = useMemo(() => new Set(cards.map((c) => c.note_id).filter((x): x is string => !!x)), [cards]);

  return (
    <div className="space-y-2">
      <button type="button" className="text-xs text-muted hover:text-fg" onClick={() => setDrawer((d) => !d)}>
        {drawer ? "◂ Hide notes drawer" : "▸ Show notes drawer"}
      </button>
      <div className={`grid gap-4 ${drawer ? "lg:grid-cols-[320px_minmax(0,1fr)]" : ""}`}>
        {drawer && (
          <NotesDrawer
            videoId={videoId}
            notes={notes}
            terms={terms}
            onBoard={onBoard}
            buckets={buckets}
            typeOptions={typeOptions}
            areaOptions={areaOptions}
            usedIn={usedIn}
            shelves={shelves}
            shelfCards={shelfCards}
            refsById={refsById}
            aiReady={aiReady}
            canDrag={canDrag}
          />
        )}
        <BucketBoard
          videoId={videoId}
          buckets={buckets}
          cards={cards}
          notesById={notesById}
          refsById={refsById}
          usedIn={usedIn}
          typeOptions={typeOptions}
          canDrag={canDrag}
        />
      </div>
    </div>
  );
}
