import type { Metadata } from "next";
import { Hanken_Grotesk, Fraunces, JetBrains_Mono } from "next/font/google";
import { CommandPalette } from "@/components/CommandPalette";
import "./globals.css";

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-hanken",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  weight: ["300", "400", "500", "600", "700"],
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Ligis — trust, made portable for autonomous agents",
  description:
    "Portable identity and verifiable credentials for AI agents. Issue, verify, rotate, and revoke on Pharos.",
};

function PaletteHint() {
  return (
    <p
      aria-hidden
      className="pointer-events-none fixed bottom-4 right-4 hidden font-mono text-[11px] uppercase tracking-[0.16em] text-ink-quiet sm:block"
    >
      ⌘K · /
    </p>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${hanken.variable} ${fraunces.variable} ${jetbrains.variable}`}
    >
      <body className="min-h-dvh">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-paper focus:px-4 focus:py-2 focus:font-mono focus:text-xs focus:text-ink focus:underline focus:decoration-terra focus:underline-offset-4"
        >
          Skip to content
        </a>
        <div id="main-content">{children}</div>
        <CommandPalette />
        <PaletteHint />
      </body>
    </html>
  );
}
