import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, Fraunces, JetBrains_Mono } from "next/font/google";
import { CommandPalette } from "@/components/CommandPalette";
import { SITE_URL } from "@/lib/site";
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

const TITLE = "Ligis — a trust layer for autonomous agents";
const DESCRIPTION =
  "Portable identity and verifiable credentials for AI agents on Pharos. Two non-custodial contracts, one read: isCapable. No admin, no SDK, no oracle.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: "%s · Ligis",
  },
  description: DESCRIPTION,
  applicationName: "Ligis",
  keywords: [
    "Ligis",
    "Pharos",
    "agent identity",
    "verifiable credentials",
    "EIP-712",
    "ERC-721",
    "AI agents",
    "0G",
    "Trust Steward",
  ],
  authors: [{ name: "sneldao" }],
  creator: "sneldao",
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "Ligis",
    title: TITLE,
    description: DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    creator: "@sneldao",
  },
  robots: {
    index: true,
    follow: true,
  },
  alternates: {
    canonical: SITE_URL,
  },
  category: "technology",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F4F1EC" },
    { media: "(prefers-color-scheme: dark)", color: "#F4F1EC" },
  ],
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
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
