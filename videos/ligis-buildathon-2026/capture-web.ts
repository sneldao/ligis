// Capture Ligis web UI screenshots for the demo video.
import { chromium } from "playwright";
import { join } from "node:path";

const OUT = "/Users/udingethe/Dev/ligis/videos/ligis-buildathon-2026/capture/assets";

const shots = [
  { url: "https://ligis.vercel.app/?chain=casper-testnet", name: "10-web-home-casper" },
  { url: "https://ligis.vercel.app/steward?chain=casper-testnet", name: "11-web-steward-casper" },
  { url: "https://ligis.vercel.app/issuers?chain=casper-testnet", name: "12-web-issuers-casper" },
];

async function main() {
  const browser = await chromium.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
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
    } catch (e) {
      console.log("  goto timeout, continuing");
    }
    await page.waitForTimeout(3000);
    await page.screenshot({ path: join(OUT, `${s.name}.png`) });
    console.log(`  -> ${s.name}.png`);
  }

  await browser.close();
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
