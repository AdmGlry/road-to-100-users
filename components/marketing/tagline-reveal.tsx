"use client";

import { useEffect, useRef } from "react";

/**
 * The landing's large tagline (DESIGN.md "Landing", tagline reveal): words
 * start at 30% opacity and light up one by one, in reading order, as each
 * crosses a line at 60% of the viewport height. Each word stays lit.
 */
export function TaglineReveal({ lines, id }: { lines: readonly string[]; id: string }) {
  const ref = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const words = ref.current?.querySelectorAll<HTMLElement>("[data-word]");
    if (!words?.length) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !("IntersectionObserver" in window)) {
      words.forEach((word) => word.setAttribute("data-lit", ""));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute("data-lit", "");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -40% 0px", threshold: 1 },
    );
    words.forEach((word) => observer.observe(word));
    return () => observer.disconnect();
  }, []);

  return (
    <h2
      ref={ref}
      id={id}
      className="max-w-[680px] text-4xl font-semibold tracking-tight sm:text-5xl"
    >
      {lines.map((line, lineIndex) => (
        <span key={line} className="block">
          {line.split(" ").map((word, wordIndex) => (
            <span key={`${lineIndex}-${wordIndex}`} data-word="">
              {word}{" "}
            </span>
          ))}
        </span>
      ))}
    </h2>
  );
}
