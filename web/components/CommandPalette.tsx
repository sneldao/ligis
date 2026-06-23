"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getAddress } from "viem";
import { isAddressLike } from "@/lib/format";

type Command = {
  id: string;
  label: string;
  hint: string;
  href: string;
};

const STATIC: Command[] = [
  { id: "index", label: "Index", hint: "/", href: "/" },
  { id: "capabilities", label: "Capabilities", hint: "/capabilities", href: "/capabilities" },
  { id: "issuers", label: "Issuers", hint: "/issuers", href: "/issuers" },
  { id: "steward", label: "Steward", hint: "/steward", href: "/steward" },
  { id: "embed", label: "Embed", hint: "/embed", href: "/embed" },
  { id: "design", label: "Design system", hint: "/styleguide", href: "/styleguide" },
];

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isCmd = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      const target = e.target as HTMLElement | null;
      const inField =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;

      if (isCmd) {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (e.key === "/" && !open && !inField) {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (e.key === "Escape" && open) {
        e.preventDefault();
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      const id = setTimeout(() => inputRef.current?.focus(), 20);
      return () => clearTimeout(id);
    }
  }, [open]);

  const options = useMemo<Command[]>(() => {
    const q = query.trim();
    const matches = STATIC.filter(
      (c) =>
        !q ||
        c.label.toLowerCase().includes(q.toLowerCase()) ||
        c.hint.includes(q.toLowerCase())
    );
    if (isAddressLike(q)) {
      try {
        const checksum = getAddress(q);
        return [
          {
            id: "agent",
            label: `Agent ${checksum.slice(0, 6)}··${checksum.slice(-4)}`,
            hint: `/agent/${checksum}`,
            href: `/agent/${checksum}`,
          },
          ...matches,
        ];
      } catch {}
    }
    return matches;
  }, [query]);

  useEffect(() => {
    if (cursor >= options.length) setCursor(Math.max(0, options.length - 1));
  }, [options.length, cursor]);

  function commit(cmd?: Command) {
    const next = cmd ?? options[cursor];
    if (!next) return;
    setOpen(false);
    router.push(next.href);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 px-4 pt-24 sm:pt-32"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div className="w-full max-w-xl animate-fade-in bg-paper">
        <div className="border-b border-rule px-6 py-4">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(options.length - 1, c + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(0, c - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                commit();
              }
            }}
            placeholder="search · paste an address · enter to jump"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            className="w-full border-0 bg-transparent font-serif text-lg text-ink outline-none placeholder:text-ink-quiet placeholder:italic"
          />
        </div>
        <ul role="listbox" className="max-h-80 overflow-auto">
          {options.length === 0 ? (
            <li className="px-6 py-6 font-serif text-sm italic text-ink-quiet">
              No matches. Paste a wallet address to jump to its agent page.
            </li>
          ) : (
            options.map((c, i) => (
              <li key={c.id} role="option" aria-selected={i === cursor}>
                <button
                  type="button"
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => commit(c)}
                  className={`flex w-full items-baseline justify-between px-6 py-3 text-left transition-colors ${
                    i === cursor ? "bg-paper-deep text-ink" : "text-ink-soft hover:text-ink"
                  }`}
                >
                  <span className="text-sm">{c.label}</span>
                  <span className="font-mono text-[11px] tabular text-ink-quiet">
                    {c.hint}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="flex items-baseline justify-between border-t border-rule px-6 py-3 text-[11px] uppercase tracking-[0.16em] text-ink-quiet">
          <span>↵ jump · ↑↓ move · esc dismiss</span>
          <span className="font-mono">⌘K · /</span>
        </div>
      </div>
    </div>
  );
}
