// Capture cspr.live transaction page screenshots for the demo video.
import { chromium } from "playwright";
import { join } from "node:path";

const OUT = "/Users/udingethe/Dev/ligis/videos/ligis-buildathon-2026/capture/assets";

const txs = [
  {
    hash: "f7827611102cac203258a456674e7be8d6f70165e795c9588c3448089a62e1a5",
    name: "01-cspr-deploy-credential-registry",
    desc: "Deploy hardened CredentialRegistry on Casper Testnet",
  },
  {
    hash: "c4b3c88b9c65132589f832e29c05eb750e0f633a8eabee12eff2df8ac601ce02",
    name: "02-cspr-smoke-mint",
    desc: "Smoke test: AgentId.mint_self",
  },
  {
    hash: "44dfb1863659973213efd6028af931e44a18de272335091ec9b7f4b4ec86641b",
    name: "03-cspr-smoke-issue",
    desc: "Smoke test: CredentialRegistry.issue with on-chain signature recovery",
  },
  {
    hash: "b44e4bb517c3d3190ba49d3c97017530386d5079fb91da487550d3c64991ab4f",
    name: "04-cspr-smoke-revoke",
    desc: "Smoke test: CredentialRegistry.revoke with issuer-signed digest",
  },
  {
    hash: "8b2cd788725df27a84c688f210a58be9a5e0136ab8bbe47156ac99df4a574dd6",
    name: "05-cspr-e2e-mint",
    desc: "E2E demo: AgentId.mint_self",
  },
  {
    hash: "9e06a91688e26815f4ac7527f7001aa9379d518f6aa986bee44c81f8f39235dc",
    name: "06-cspr-e2e-rwa-accredited",
    desc: "E2E demo: issue rwa.accredited credential",
  },
  {
    hash: "db4e055f407702ca0a4c389283045d1b430d4d779c329e319788ed2f76bdbd62",
    name: "07-cspr-e2e-x402-commerce",
    desc: "E2E demo: issue agent.commerce.x402 credential",
  },
  {
    hash: "97ba31a0716fa1165e5921941ae196386eb4537a21a0c24379c7f7581e20e933",
    name: "08-cspr-e2e-data-premium",
    desc: "E2E demo: issue data.premium credential",
  },
  {
    hash: "7871ad8737d971206f4fb449e5535dd021dc876f1907bd47a8a2161ef08eb56e",
    name: "09-cspr-e2e-set-token-uri",
    desc: "E2E demo: anchor 0G evidence root on Casper",
  },
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

  for (const t of txs) {
    const url = `https://testnet.cspr.live/transaction/${t.hash}`;
    console.log(`capturing ${t.name}: ${url}`);
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
    } catch (e) {
      console.log("  goto timeout, continuing");
    }
    await page.waitForTimeout(6000);
    await page.screenshot({ path: join(OUT, `${t.name}.png`) });
    console.log(`  -> ${t.name}.png`);
  }

  await browser.close();
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
