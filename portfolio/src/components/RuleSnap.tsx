"use client";
// BL-6: the notebook page has ruled lines every 32px. Text sits on them, but a picture, table or embed has any height,
// so everything below it would drift off the lines. This adds the missing padding under such blocks so each one is
// a whole number of ruled lines tall. Runs after load, when pictures finish loading and when the window is resized.
import { useEffect } from "react";

const LINE = 32;
const BLOCKS = "figure, .n-table, .n-embed, .n-gallery, .n-audio, .n-bookmark, .n-math";

export default function RuleSnap() {
  useEffect(() => {
    const page = document.getElementById("main");
    if (!page) return;
    let frame = 0;
    const snap = () => {
      frame = 0;
      page.querySelectorAll<HTMLElement>(BLOCKS).forEach((el) => {
        el.style.paddingBottom = "0px"; // measure it without our own padding
        const extra = (LINE - (el.getBoundingClientRect().height % LINE)) % LINE;
        el.style.paddingBottom = extra > 0.01 ? `${extra}px` : "";
      });
    };
    const later = () => {
      if (!frame) frame = requestAnimationFrame(snap);
    };
    snap();
    window.addEventListener("resize", later);
    page.addEventListener("load", later, true); // images and iframes finishing
    void document.fonts?.ready.then(later);
    return () => {
      window.removeEventListener("resize", later);
      page.removeEventListener("load", later, true);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
