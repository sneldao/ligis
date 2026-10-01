/**
 * Local e2e for the /passkey ceremony: drives a real WebAuthn flow through a
 * CDP virtual authenticator (Playwright + system Chrome).
 *
 * Prerequisites:
 *   - web dev server on :3001 with LIGIS_PASSKEY_RP_ID=localhost +
 *     LIGIS_STEWARD_KEY set
 *   - PasskeyIssuer.rpIdHash rotated to sha256("localhost") (owner op):
 *       cast send 0x6C500B3968C54789b518D01066Aed2990d44c068 \
 *         "setRpIdHash(bytes32)" \
 *         0x49960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d9763 \
 *         --rpc-url https://testnet-rpc.monad.xyz --private-key $DEPLOYER_KEY
 *     Restore afterwards with sha256("ligis.vercel.app") =
 *       0x8cbe9bddbd87dd65e664fa63a10a4c0a766b83228e0a0f5f6d4f64756b705d3e
 *
 * Run: npx tsx scripts/webauthn-e2e.ts
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3001";

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable", { enableUI: false });
  const { authenticatorId } = (await cdp.send(
    "WebAuthn.addVirtualAuthenticator",
    {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    },
  )) as { authenticatorId: string };
  console.log(`virtual authenticator: ${authenticatorId}`);

  page.on("console", (m) => {
    if (m.type() === "error") console.log(`  [page] ${m.text()}`);
  });

  await page.goto(`${BASE}/passkey`, { waitUntil: "networkidle" });
  await page.waitForSelector("text=enroll this passkey", { timeout: 20_000 });

  // 01 enroll
  await page.click("text=enroll this passkey");
  await page.waitForSelector("text=public key enrolled on Monad", {
    timeout: 60_000,
  });
  console.log("✓ enroll — passkey public key on-chain");

  // 02 issue — default subject (steward) + a fresh capability per run so the
  // GO→STOP flip is unambiguous (multi-issuer semantics: any live credential
  // keeps the gate open).
  const cap = `demo.passkey.e2e${Date.now().toString(36)}`;
  const capInput = page.locator("input").nth(1);
  await capInput.fill(cap);
  await page.click("text=touch to issue");
  try {
    await page.waitForSelector("text=credential minted", { timeout: 90_000 });
  } catch {
    // dump whatever status text the issue step rendered
    const errText = await page
      .locator(".text-revoke")
      .allTextContents()
      .catch(() => [] as string[]);
    console.log("issue-step error text:", JSON.stringify(errText));
    await page.screenshot({
      path: "scripts/webauthn-e2e-fail.png",
      fullPage: true,
    });
    throw new Error("issue step failed");
  }
  console.log(`✓ issue — WebAuthn assertion verified by 0x0100 (${cap})`);
  await page.waitForSelector("p.display:has-text('GO')", { timeout: 15_000 });
  console.log("✓ gate verdict: GO");

  // 03 revoke
  await page.click("text=touch to revoke");
  await page.waitForSelector("text=credential revoked by passkey", {
    timeout: 90_000,
  });
  console.log("✓ revoke — passkey-authorized revocation on-chain");
  await page.waitForSelector("p.display:has-text('STOP')", { timeout: 15_000 });
  console.log("✓ gate verdict: STOP");

  await page.screenshot({ path: "scripts/webauthn-e2e.png", fullPage: true });
  await browser.close();
  console.log(
    "\nBROWSER WEBAUTHN CEREMONY VERIFIED — screenshot at scripts/webauthn-e2e.png",
  );
}

main().catch((e) => {
  console.error("✗", e instanceof Error ? e.message : e);
  process.exit(1);
});
