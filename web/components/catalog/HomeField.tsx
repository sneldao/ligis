"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "framer-motion";
import { SceneErrorBoundary } from "./SceneErrorBoundary";

const CatalogScene = dynamic(
  () => import("./CatalogScene").then((module) => module.CatalogScene),
  { ssr: false },
);

/**
 * The home route's single immersive field. It is deliberately not part of
 * the root layout: reference pages and operational flows need a quiet,
 * dependable paper surface. The WebGL scene is only fetched for desktop
 * clients that have not requested reduced motion, and is removed once this
 * home-only region leaves the viewport.
 */
export function HomeField({ children }: { children: ReactNode }) {
  const regionRef = useRef<HTMLElement>(null);
  const reducedMotion = useReducedMotion();
  const [wideViewport, setWideViewport] = useState(false);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 640px)");
    const update = () => setWideViewport(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const element = regionRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const showScene = wideViewport && !reducedMotion && inView;

  return (
    <section ref={regionRef} className="relative isolate">
      {/* Mobile is a reading surface, not an immersive viewport: retain the
          quiet specimen texture without forcing a blank screen before copy. */}
      <div className="absolute inset-0 bg-paper sm:hidden">
        <QuietField />
      </div>
      <div className="sticky top-0 hidden h-dvh overflow-hidden bg-paper sm:block">
        <div className="absolute inset-0">
          {showScene ? (
            <SceneErrorBoundary>
              <CatalogScene />
            </SceneErrorBoundary>
          ) : (
            <QuietField />
          )}
        </div>
      </div>
      <div className="pointer-events-none relative z-10 sm:-mt-dvh">
        {children}
      </div>
    </section>
  );
}

/** A low-cost, motion-free specimen field for small and reduced-motion clients. */
function QuietField() {
  const marks = Array.from({ length: 48 }, (_, index) => ({
    x: 4 + ((index * 37) % 92),
    y: 6 + ((index * 23) % 88),
    r: index % 7 === 0 ? 1.5 : 0.8,
    opacity: 0.12 + (index % 4) * 0.05,
  }));

  return (
    <svg
      aria-hidden
      className="h-full w-full text-ink"
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
    >
      <line
        x1="0"
        y1="18"
        x2="100"
        y2="18"
        stroke="currentColor"
        strokeOpacity="0.08"
        strokeWidth="0.2"
      />
      <line
        x1="0"
        y1="82"
        x2="100"
        y2="82"
        stroke="currentColor"
        strokeOpacity="0.08"
        strokeWidth="0.2"
      />
      {marks.map((mark, index) => (
        <circle
          key={index}
          cx={mark.x}
          cy={mark.y}
          r={mark.r}
          fill="currentColor"
          fillOpacity={mark.opacity}
        />
      ))}
    </svg>
  );
}
