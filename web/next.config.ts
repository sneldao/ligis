import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(process.cwd(), ".."),

  // `web/tsconfig.json` maps `@ligis/*` directly to `packages/*/src/index.ts`
  // (source, not the built dist). The package tsconfigs use
  // `module: NodeNext` + `moduleResolution: NodeNext`, which requires
  // relative imports to use the runtime `.js` extension even when the
  // on-disk file is `.ts` (e.g. `export * from "./hash.js"`).
  //
  // Turbopack's default resolve-extensions list does NOT strip the
  // `.js` and try `.ts/.tsx` for cross-package source imports, so Vercel
  // builds fail with `Module not found: Can't resolve './config.js'`
  // until the list is taught about TypeScript. Adding `.ts` and `.tsx`
  // ahead of `.js` resolves it. `transpilePackages` makes sure Next also
  // runs the package source through its own TS transform (so
  // `target: ES2022` + `lib: dom` features in web/lib/* see fully
  // typed package symbols without going through dist first).
  transpilePackages: [
    "@ligis/core",
    "@ligis/adapter-evm",
    "@ligis/adapter-casper",
    "@ligis/agent-logic",
    "@ligis/zerog",
  ],

  turbopack: {
    resolveExtensions: [
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".mjs",
      ".cjs",
      ".json",
    ],
  },
};

export default nextConfig;
