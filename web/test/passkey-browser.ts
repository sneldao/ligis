/**
 * Local-only browser proof. Real CDP WebAuthn assertions; mocked account,
 * admission, sponsor and receipts. /api/gate responses below are explicitly
 * browser fixtures, NOT live gate or chain proof. No RP-ID rotation or chain writes.
 *
 * Run against a dev server with LIGIS_PASSKEY_FIXTURE enabled and its local
 * LIGIS_PASSKEY_RP_ID / LIGIS_PASSKEY_ORIGIN configured:
 *   pnpm exec tsx web/test/passkey-browser.ts
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://localhost:3103";
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PASSKEY_BROWSER_EXECUTABLE,
});
let verdict: "GO" | "STOP" | "UNKNOWN" = "GO";
try {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  // No production/provider requests. This browser proof only uses local fixtures.
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1")
      return route.abort();
    if (url.pathname === "/api/gate") {
      const body = route.request().postDataJSON();
      assert.equal(body.capability, "demo.passkey");
      assert.equal(body.amountUsd, 1);
      assert.deepEqual(body.mandate.payees, [body.payee]);
      assert.equal(body.mandate.maxUsd, 1);
      assert.equal(body.mandate.expectedUsd, 1);
      return route.fulfill({
        json: {
          verdict,
          signals: [
            { id: "right-payee", status: "GO", confidence: 1 },
            { id: "right-amount", status: "GO", confidence: 1 },
            {
              id: "in-scope",
              status: "SKIPPED",
              confidence: 0,
              reason: "Browser fixture",
            },
            {
              id: "verified-payee",
              status:
                verdict === "STOP"
                  ? "STOP"
                  : verdict === "UNKNOWN"
                    ? "SKIPPED"
                    : "GO",
              confidence: 1,
              reason: "Browser fixture only",
            },
          ],
          provenance: ["browser fixture, not live chain state"],
          latencyMs: 1,
        },
      });
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  page.setDefaultNavigationTimeout(120_000);
  page.on("response", async (response) => {
    if (response.url().endsWith("/api/passkey") && response.status() === 400) {
      const request = response.request().postDataJSON();
      if (request.action === "fixtureSubmit") {
        const client = JSON.parse(
          Buffer.from(request.clientDataJSON.slice(2), "hex").toString(),
        );
        console.error(
          "Rejected fixture client-data fields:",
          Object.keys(client),
          "flags:",
          Buffer.from(request.authenticatorData.slice(2), "hex")[32],
        );
      }
    }
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable", { enableUI: false });
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await page.goto(`${base}/passkey`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Simulate seedless sign-in" }).click();
  await page
    .getByText("Fixture account signed in.", { exact: false })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Touch to issue fixture", exact: true })
      .isDisabled(),
    true,
  );
  await page
    .getByRole("button", { name: "Create local issuer passkey" })
    .click();
  await page
    .getByText("Local public key prepared.", { exact: false })
    .waitFor();
  await page
    .getByRole("button", { name: "Simulate authorized operator admission" })
    .click();
  await page.getByText("Simulated owner admitted", { exact: false }).waitFor();
  await page
    .getByRole("button", { name: "Touch to issue fixture", exact: true })
    .click();
  await page
    .getByText(
      "Fixture demo.passkey issued after simulated operator admission.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await page.locator("p.display").count(),
    0,
    "Capability read must not manufacture GO",
  );
  await page.getByRole("button", { name: "Ask full risk gate" }).click();
  await page.locator("p.display").filter({ hasText: "GO" }).waitFor();
  verdict = "UNKNOWN";
  await page.getByRole("button", { name: "Ask full risk gate" }).click();
  await page.locator("p.display").filter({ hasText: "UNKNOWN" }).waitFor();
  await page.waitForTimeout(1100); // deliberate fixture rate-limit window
  await page
    .getByRole("button", { name: "Touch to revoke fixture", exact: true })
    .click();
  await page
    .getByText(
      "Fixture demo.passkey revoked by the admitted operator passkey.",
      { exact: true },
    )
    .waitFor();
  await page.getByText("demo.passkey · revoked", { exact: false }).waitFor();
  verdict = "STOP";
  await page.getByRole("button", { name: "Ask full risk gate" }).click();
  await page.locator("p.display").filter({ hasText: "STOP" }).waitFor();
  await page.screenshot({
    path: new URL("../../../passkey-fixture-browser.png", import.meta.url)
      .pathname,
    fullPage: true,
  });
  console.log(
    "PASS: real browser create/get → simulated owner admission → cryptographic fixture issue/read → full gate POST GO/UNKNOWN → revoke/read → full gate POST STOP.",
  );
  for (const scenario of ["pending", "reverted", "read-failure", "outage"]) {
    // Each failure probe has its own fixture identity and operation budget.
    // Never raise the sponsor's four-request cap to make a test pass.
    await page.reload({ waitUntil: "networkidle" });
    await page
      .getByRole("button", { name: "Simulate seedless sign-in" })
      .click();
    await page
      .getByRole("button", { name: "Create local issuer passkey" })
      .click();
    await page
      .getByText("Local public key prepared.", { exact: false })
      .waitFor();
    await page
      .getByRole("button", { name: "Simulate authorized operator admission" })
      .click();
    await page
      .getByText("Simulated owner admitted", { exact: false })
      .waitFor();
    await page.getByLabel("Fixture receipt scenario").selectOption(scenario);
    await page
      .getByRole("button", { name: "Touch to issue fixture", exact: true })
      .click();
    const expected =
      scenario === "outage"
        ? "Sponsor unavailable; no fallback."
        : scenario === "read-failure"
          ? "credential read unavailable"
          : `Fixture transaction ${scenario}`;
    try {
      await page
        .getByText(expected, { exact: false })
        .waitFor({ timeout: 10_000 });
    } catch (error) {
      console.error(
        "Fixture probe status:",
        scenario,
        await page.getByRole("status").allTextContents(),
      );
      throw error;
    }
    assert.equal(await page.locator("p.display").count(), 0);
    assert.equal(
      await page
        .getByText("Fixture credential read:", { exact: false })
        .count(),
      0,
    );
  }
  console.log(
    "PASS: pending, reverted, read-failure and sponsor-outage states never fabricate success.",
  );

  const unsupported = await browser.newContext();
  await unsupported.addInitScript(() => {
    Object.defineProperty(window, "PublicKeyCredential", { value: undefined });
  });
  const unsupportedPage = await unsupported.newPage();
  await unsupportedPage.goto(`${base}/passkey`);
  await unsupportedPage
    .getByText("Unsupported browser or insecure context.", { exact: false })
    .waitFor();
  assert.equal(
    await unsupportedPage
      .getByRole("button", { name: "Simulate seedless sign-in" })
      .isDisabled(),
    true,
  );
  await unsupported.close();

  const wrong = await context.newPage();
  await wrong.goto(`${base.replace("localhost", "127.0.0.1")}/passkey`);
  await wrong.getByText("Wrong serving origin.", { exact: false }).waitFor();
  assert.equal(
    await wrong
      .getByRole("button", { name: "Simulate seedless sign-in" })
      .isDisabled(),
    true,
  );
  await wrong.close();

  const canceledContext = await browser.newContext();
  await canceledContext.addInitScript(() => {
    navigator.credentials.create = async () => {
      throw new DOMException("Canceled fixture", "NotAllowedError");
    };
  });
  const canceled = await canceledContext.newPage();
  await canceled.goto(`${base}/passkey`);
  await canceled
    .getByRole("button", { name: "Simulate seedless sign-in" })
    .click();
  await canceled
    .getByRole("button", { name: "Create local issuer passkey" })
    .click();
  await canceled
    .getByText("Ceremony canceled or timed out.", { exact: false })
    .waitFor();
  assert.equal(
    await canceled
      .getByRole("button", { name: "Simulate authorized operator admission" })
      .isDisabled(),
    true,
  );
  await canceledContext.close();
  console.log(
    "PASS: unsupported browser, wrong origin and canceled ceremony are explicit and cannot enroll.",
  );
  await context.close();
} finally {
  await browser.close();
}
