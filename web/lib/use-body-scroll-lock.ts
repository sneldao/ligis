"use client";

import { useEffect } from "react";

/**
 * Locks body scroll while `locked` is true and restores the previous
 * inline overflow style on release. Shared by the mobile nav drawer
 * (GlobalDock) and the command palette so they can never clobber each
 * other's overflow state.
 */
export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [locked]);
}
