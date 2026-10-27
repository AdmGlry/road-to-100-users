"use client";

import { useEffect } from "react";

/**
 * Landing scroll behaviour (styles in app/globals.css), one IntersectionObserver
 * each and never a scroll listener:
 * - `[data-reveal]` elements rise in once when they enter the viewport;
 * - `[data-story]` visuals run their loop only while they are on screen.
 */
export function RevealObserver() {
  useEffect(() => {
    const reveals = document.querySelectorAll<HTMLElement>("[data-reveal]:not([data-revealed])");
    const stories = document.querySelectorAll<HTMLElement>("[data-story]");
    if (!("IntersectionObserver" in window)) {
      reveals.forEach((el) => el.setAttribute("data-revealed", ""));
      stories.forEach((el) => el.setAttribute("data-playing", ""));
      return;
    }
    const revealObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute("data-revealed", "");
          revealObserver.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.1 },
    );
    const storyObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          entry.target.toggleAttribute("data-playing", entry.isIntersecting);
        }
      },
      { threshold: 0.3 },
    );
    reveals.forEach((el) => revealObserver.observe(el));
    stories.forEach((el) => storyObserver.observe(el));
    return () => {
      revealObserver.disconnect();
      storyObserver.disconnect();
    };
  }, []);

  return null;
}
