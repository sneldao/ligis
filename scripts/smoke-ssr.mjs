#!/usr/bin/env node
/**
 * SSR smoke: curl main routes and fail on client-side bailout markers or a
 * missing <h1>. Expects a running web server (BASE_URL, default
 * http://127.0.0.1:3000).
 */
const BASE = (process.env.BASE_URL ?? "http://127.0.0.1:3000").replace(
  /\/$/,
  "",
);

const ROUTES = [
  "/",
  "/gate",
  "/gate?chain=monad-testnet",
  "/issuers?chain=monad-testnet",
  "/croo",
  "/compose",
  "/field",
  "/steward",
];

const BAIL = /BAILOUT_TO_CLIENT_SIDE_RENDERING/i;

async function check(path) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    headers: { accept: "text/html" },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.text();
  const problems = [];
  if (!res.ok) problems.push(`HTTP ${res.status}`);
  if (BAIL.test(body)) problems.push("BAILOUT_TO_CLIENT_SIDE_RENDERING");
  if (!/<h1[\s>]/i.test(body) && path !== "/field") {
    // /field is a canvas shell — no editorial h1 required.
    problems.push("missing <h1>");
  }
  return { url, problems };
}

const results = [];
for (const path of ROUTES) {
  try {
    results.push(await check(path));
  } catch (err) {
    results.push({
      url: `${BASE}${path}`,
      problems: [err instanceof Error ? err.message : String(err)],
    });
  }
}

let failed = 0;
for (const r of results) {
  if (r.problems.length) {
    failed++;
    console.error(`FAIL ${r.url}`);
    for (const p of r.problems) console.error(`  · ${p}`);
  } else {
    console.log(`ok   ${r.url}`);
  }
}

if (failed) {
  console.error(`\nsmoke-ssr: ${failed}/${results.length} routes failed`);
  process.exit(1);
}
console.log(`\nsmoke-ssr: ${results.length} routes ok`);
