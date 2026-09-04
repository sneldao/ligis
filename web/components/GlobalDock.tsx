"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { ChainSelector } from "@/components/ChainSelector";
import { UnifiedWalletChip } from "@/components/UnifiedWalletChip";

const NAV = [
  { href: "/gate", label: "Gate" },
  { href: "/#how", label: "How it works" },
  { href: "/steward", label: "Steward" },
  { href: "/capabilities", label: "Capabilities" },
  { href: "/issuers", label: "Issuers" },
  { href: "/embed", label: "Embed" },
  { href: "/#croo", label: "CROO" },
];

/** Inline hamburger/close icon — no icon-font dependency, crisp at any DPR. */
function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden
    >
      {open ? (
        <>
          <line x1="3.5" y1="3.5" x2="12.5" y2="12.5" />
          <line x1="12.5" y1="3.5" x2="3.5" y2="12.5" />
        </>
      ) : (
        <>
          <line x1="2" y1="4" x2="14" y2="4" />
          <line x1="2" y1="8" x2="14" y2="8" />
          <line x1="2" y1="12" x2="14" y2="12" />
        </>
      )}
    </svg>
  );
}

export function GlobalDock() {
  const pathname = usePathname() ?? "/";
  const [navOpen, setNavOpen] = useState(false);
  const reducedMotion = useReducedMotion();

  const closeDrawer = useCallback(() => setNavOpen(false), []);

  // Close mobile drawer on route change
  useEffect(() => {
    closeDrawer();
  }, [pathname, closeDrawer]);

  // Close mobile drawer on Escape
  useEffect(() => {
    if (!navOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDrawer();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [navOpen, closeDrawer]);

  // Lock body scroll while the mobile drawer is open so the page
  // doesn't scroll behind the overlay.
  useEffect(() => {
    if (!navOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [navOpen]);

  // An embed is a borrowed surface. The host owns its navigation and the
  // verification document must contain only the compact result.
  if (pathname.startsWith("/embed/verify")) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-40 flex justify-center px-3 sm:top-6 sm:px-4">
      <motion.div
        layout
        transition={{ type: "spring", stiffness: 360, damping: 32 }}
        className="pointer-events-auto flex max-w-full items-center gap-x-3 bg-ink/85 px-3 py-2 text-paper backdrop-blur-md sm:gap-x-4 sm:px-5 sm:py-2.5"
        style={{ color: "#F4F1EC", borderRadius: 999 }}
      >
        {/* Brand zone */}
        <Link
          href="/"
          aria-label="Ligis · home"
          className="flex items-center gap-x-2 font-mono text-[11px] uppercase tracking-[0.18em] text-paper hover:text-terra"
        >
          <span aria-hidden>🪪</span>
          <span className="hidden sm:inline">Ligis</span>
        </Link>

        {/* Single hairline divider between brand zone and nav zone */}
        <span
          className="hidden h-3 w-px bg-paper-deep/30 sm:inline-block"
          aria-hidden
        />

        {/* Nav links — lg+ only. The mobile drawer carries them below. */}
        <nav className="hidden items-center gap-x-3 lg:flex">
          {NAV.map((n) => {
            const isActive =
              n.href === "/"
                ? pathname === "/"
                : pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`font-mono text-[11px] uppercase tracking-[0.18em] transition-colors relative ${
                  isActive
                    ? "text-terra"
                    : "text-paper-deep/80 hover:text-paper"
                }`}
              >
                {n.label}
                {isActive ? (
                  <span
                    className="absolute -bottom-1 left-0 right-0 h-px bg-terra"
                    aria-hidden
                  />
                ) : null}
              </Link>
            );
          })}
        </nav>

        {/* Right cluster: chain selector + wallet chip — ml-auto pushes it.
            Both children carry their own sm+ visibility wrapper so the mobile
            drawer (rendered separately below) owns them at <sm. */}
        <div className="ml-auto flex items-center gap-x-3 sm:gap-x-4">
          <div className="hidden sm:block">
            <ChainSelector />
          </div>
          <div className="hidden sm:flex items-center">
            <UnifiedWalletChip />
          </div>
        </div>

        {/* Hamburger — <lg only. At lg+ the nav links carry primary nav. */}
        <button
          type="button"
          onClick={() => setNavOpen((v) => !v)}
          aria-label={navOpen ? "Close menu" : "Open menu"}
          aria-expanded={navOpen}
          className="flex items-center justify-center text-paper-deep/80 transition-colors hover:text-paper lg:hidden"
        >
          <MenuIcon open={navOpen} />
        </button>
      </motion.div>

      {/* Backdrop — dims the page behind the drawer and closes on click. */}
      <AnimatePresence>
        {navOpen ? (
          <motion.div
            initial={reducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reducedMotion ? undefined : { opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="pointer-events-auto fixed inset-0 top-0 z-30 bg-ink/30 lg:hidden"
            onClick={closeDrawer}
            aria-hidden
          />
        ) : null}
      </AnimatePresence>

      {/* Mobile dropdown — chain + nav + chip */}
      <AnimatePresence>
        {navOpen ? (
          <motion.div
            initial={reducedMotion ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: 0.16 }}
            className="pointer-events-auto absolute left-3 right-3 top-14 z-40 bg-ink/92 px-5 py-4 text-paper backdrop-blur-md lg:hidden"
            style={{ borderRadius: 16 }}
          >
            <div className="mb-4">
              <ChainSelector />
            </div>
            <ul className="flex flex-col gap-y-3">
              {NAV.map((n) => {
                const isActive =
                  n.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(n.href);
                return (
                  <li key={n.href}>
                    <Link
                      href={n.href}
                      className={`block font-mono text-xs uppercase tracking-[0.18em] transition-colors ${isActive
                        ? "text-terra"
                        : "text-paper-deep hover:text-paper"
                      }`}
                    >
                      {n.label}
                    </Link>
                  </li>
                );
              })}
              <li>
                <UnifiedWalletChip />
              </li>
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
