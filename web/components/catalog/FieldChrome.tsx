"use client";

import { useEffect, useState } from "react";
import { CATALOG_CONFIG, rigState } from "./catalogState";

export function FieldChrome() {
  const [far, setFar] = useState(false);
  const [hint, setHint] = useState(true);

  useEffect(() => {
    const id = window.setInterval(() => {
      setFar(rigState.zoom >= CATALOG_CONFIG.lodMarker);
    }, 200);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!hint) return;
    const id = window.setTimeout(() => setHint(false), 8_000);
    return () => window.clearTimeout(id);
  }, [hint]);

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div className="absolute inset-x-0 bottom-6 flex flex-col items-center px-5 text-center sm:bottom-10">
        {far ? (
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-quiet">
            zoom in · terra rings are live · esc leaves
          </p>
        ) : hint ? (
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-quiet">
            <span className="hidden sm:inline">
              click a LIVE specimen · esc clears · esc again leaves
            </span>
            <span className="sm:hidden">tap LIVE · esc leaves</span>
          </p>
        ) : (
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-quiet">
            esc leaves
          </p>
        )}
      </div>
    </div>
  );
}
