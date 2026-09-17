// Capture Ligis GenLayer screens for the Agent Tank demo video.
import { chromium } from "playwright";
import { join } from "node:path";

const OUT = "/Users/udingethe/Dev/ligis/videos/ligis-genlayer-tank/assets";
const BASE = process.env.LIGIS_WEB_URL || "http://localhost:3001";

const shots = [
  { url: `${BASE}/genlayer`, name: "genlayer-ui", wait: 4000 },
  { url: `${BASE}/gate?chain=casper-testnet`, name: "gate-ui", wait: 4000 },
  { url: `${BASE}/`, name: "home", wait: 3000 },
];

async function main() {
  const browser = await chromium.launch({
    executablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  for (const s of shots) {
    console.log(`capturing ${s.name}: ${s.url}`);
    try {
      await page.goto(s.url, { waitUntil: "networkidle", timeout: 30000 });
    } catch {
      console.log("  goto timeout, continuing");
    }
    await page.waitForTimeout(s.wait);
    await page.screenshot({ path: join(OUT, `${s.name}.png`) });
    console.log(`  -> ${s.name}.png`);
  }

  // Also capture the explorer (external site)
  console.log(
    "capturing explorer: https://explorer-studio-dev.genlayer.com/address/0x64eF9e556B0E564fbC6162bE17fd9be992D0cB0F",
  );
  try {
    await page.goto(
      "https://explorer-studio-dev.genlayer.com/address/0x64eF9e556B0E564fbC6162bE17fd9be992D0cB0F",
      {
        waitUntil: "networkidle",
        timeout: 30000,
      },
    );
  } catch {
    console.log("  explorer goto timeout, continuing");
  }
  await page.waitForTimeout(5000);
  await page.screenshot({ path: join(OUT, "explorer.png") });
  console.log("  -> explorer.png");

  await browser.close();
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
