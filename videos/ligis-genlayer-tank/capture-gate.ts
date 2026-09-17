// Capture the gate page with a subject + capability selected to show GO verdict.
import { chromium } from "playwright";
import { join } from "node:path";

const OUT = "/Users/udingethe/Dev/ligis/videos/ligis-genlayer-tank/assets";
const BASE = process.env.LIGIS_WEB_URL || "http://localhost:3001";

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

  // Gate page with subject + capability → shows GO/STOP verdict
  // Try deployer account + kyc.basic (issued in previous demos)
  const gateUrl = `${BASE}/gate?chain=casper-testnet&subject=account-hash-c76927ed08eb9a3a2cca7ee0b730fb4cefa22551d3e5914e4d44d693762a8326&capability=kyc.basic`;
  console.log(`capturing gate-go: ${gateUrl}`);
  try {
    await page.goto(gateUrl, { waitUntil: "networkidle", timeout: 30000 });
  } catch {
    console.log("  goto timeout, continuing");
  }
  await page.waitForTimeout(5000);
  await page.screenshot({ path: join(OUT, "gate-go.png") });
  console.log("  -> gate-go.png");

  await browser.close();
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
