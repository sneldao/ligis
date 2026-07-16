"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import { ChainSelector } from "@/components/ChainSelector";
import { WalletChip } from "@/components/WalletChip";

const NAV = [
  { href: "/#how", label: "How it works" },
  { href: "/steward?chain=casper-testnet", label: "Steward" },
  { href: "/capabilities", label: "Capabilities" },
  { href: "/embed", label: "Embed" },
];

export function GlobalDock() {
  const pathname = usePathname() ?? "/";
  const [navOpen, setNavOpen] = useState(false);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

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
                className={`font-mono text-[11px] uppercase tracking-[0.18em] transition-colors ${
                  isActive
                    ? "text-terra"
                    : "text-paper-deep/80 hover:text-paper"
                }`}
              >
                {n.label}
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
            <WalletChip />
          </div>
        </div>

        {/* Hamburger — <lg only. At lg+ the nav links carry primary nav. */}
        <button
          type="button"
          onClick={() => setNavOpen((v) => !v)}
          aria-label="Open menu"
          aria-expanded={navOpen}
          className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-deep/80 hover:text-paper lg:hidden"
        >
          {navOpen ? "close" : "menu"}
        </button>
      </motion.div>

      {/* Mobile dropdown — chain + nav + chip */}
      <AnimatePresence>
        {navOpen ? (
          <motion.div
            initial={reducedMotion ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: 0.16 }}
            className="pointer-events-auto absolute left-3 right-3 top-14 bg-ink/92 px-5 py-4 text-paper backdrop-blur-md lg:hidden"
            style={{ borderRadius: 16 }}
          >
            <div className="mb-4">
              <ChainSelector />
            </div>
            <ul className="flex flex-col gap-y-3">
              {NAV.map((n) => (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    className="block font-mono text-xs uppercase tracking-[0.18em] text-paper-deep hover:text-paper"
                  >
                    {n.label}
                  </Link>
                </li>
              ))}
              <li>
                <WalletChip />
              </li>
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
