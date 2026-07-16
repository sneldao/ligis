"use client";

import { useEffect, useRef } from "react";

/**
 * useRevealOnView — react hook wiring the staggered reveal pattern
 * (`.animate-triptych-reveal` in `web/app/globals.css`) to an
 * IntersectionObserver so the animation only fires once the element
 * scrolls into view.
 *
 * The caller is responsible for applying the matching CSS class + the
 * inline `--triptych-delay` variable + the `data-revealed="false"`
 * attribute to the same element receiving the returned ref. The
 * hook flips `data-revealed="true"` when entry.isIntersecting first
 * becomes true and disconnects the observer afterward (one-shot).
 *
 * Reduced-motion is honoured: when the OS preference is set OR the
 * runtime lacks IntersectionObserver, `data-revealed` is set to
 * "true" immediately so CSS-driven opacity 1 is honoured.
 *
 *   const { ref, delayMs } = useRevealOnView<HTMLDivElement>({ delayMs: 120 });
 *   <section
 *     ref={ref}
 *     className="animate-triptych-reveal"
 *     style={{ ["--triptych-delay"]: "120ms" }}
 *     data-revealed="false"
 *   >
 *     {children}
 *   </section>
 */
export function useRevealOnView<T extends Element = HTMLDivElement>(
  opts: { delayMs?: number } = {},
) {
  const ref = useRef<T>(null);
  // Track delayMs for callers that want to apply it inline without
  // re-typing the magic string.
  const delayMs = opts.delayMs ?? 0;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduceMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion || typeof IntersectionObserver === "undefined") {
      el.setAttribute("data-revealed", "true");
      return;
    }

    const obs = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          el.setAttribute("data-revealed", "true");
          obs.disconnect();
        }
      },
      // Fire when the element has scrolled at least 10% above the
      // bottom of the viewport, so the animation begins before the
      // element is fully on screen (feels intentional, not late).
      { rootMargin: "0px 0px -10% 0px", threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return { ref, delayMs } as const;
}

/**
 * RevealOnView — convenience wrapper. Renders a `<div>` carrying the
 * reveal contract (class + style + `data-revealed`) around children.
 * Use when a per-element tweak is overkill — when you can wrap content
 * in a single block and the parent isn't already an HTML element that
 * needs to be the reveal target itself.
 *
 *   <RevealOnView delayMs={280}>
 *     <header>...</header>
 *     <Rule />
 *   </RevealOnView>
 */
export function RevealOnView({
  delayMs = 0,
  className = "",
  children,
}: {
  delayMs?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const { ref, delayMs: d } = useRevealOnView<HTMLDivElement>({ delayMs });
  return (
    <div
      ref={ref}
      className={`animate-triptych-reveal ${className}`}
      style={{ ["--triptych-delay" as string]: `${d}ms` }}
      data-revealed="false"
    >
      {children}
    </div>
  );
}
