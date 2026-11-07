"use client";
// Click-to-load YouTube player: nothing from YouTube loads until the visitor presses play (privacy-enhanced domain).
import { useState } from "react";
import { embedUrl } from "../lib/videos";

export default function VideoEmbed({ id, title, thumb, playLabel, watchLabel, watchHref }: { id: string; title: string; thumb: string | null; playLabel: string; watchLabel: string; watchHref: string | null }) {
  const [on, setOn] = useState(false);
  const src = embedUrl(id);
  if (!src) return null;
  return (
    <div className="vwrap">
      <div className="vframe">
        {on ? (
          <iframe src={src} title={title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
        ) : (
          <button type="button" className="vplay" onClick={() => setOn(true)} aria-label={playLabel}>
            {thumb && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumb} alt="" loading="lazy" />
            )}
            <span className="vtri" aria-hidden="true" />
          </button>
        )}
      </div>
      {watchHref && (
        <a className="vwatch" href={watchHref} rel="noopener noreferrer" target="_blank">
          {watchLabel}
        </a>
      )}
    </div>
  );
}
