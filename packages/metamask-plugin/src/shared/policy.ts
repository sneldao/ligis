/**
 * Operator policy loading for the plugin commands.
 *
 * The policy is the protected half of the guard — it comes from the operator's
 * environment, never from the agent's request. Resolution order:
 * `--policy <file>` → `LIGIS_WALLET_POLICY` (inline JSON) →
 * `LIGIS_WALLET_POLICY_FILE` (path). Missing or unreadable policy disables
 * signing at the guard layer as well (`policy-missing`), but we fail earlier
 * here so the error names the fix.
 */
import { readFile } from "node:fs/promises";
import { CommandError } from "@metamask/agent-wallet/plugin";

export async function loadPolicyInput(policyFlag?: string): Promise<unknown> {
  const file = policyFlag ?? process.env.LIGIS_WALLET_POLICY_FILE;
  if (file) {
    try {
      return JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      throw new CommandError(
        "POLICY_UNREADABLE",
        `could not read operator policy at ${file}`,
        `${error instanceof Error ? error.message : String(error)} — the file must contain the operator policy JSON.`,
      );
    }
  }
  const inline = process.env.LIGIS_WALLET_POLICY;
  if (inline) {
    try {
      return JSON.parse(inline);
    } catch (error) {
      throw new CommandError(
        "POLICY_UNREADABLE",
        "LIGIS_WALLET_POLICY is not valid JSON",
        `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  throw new CommandError(
    "POLICY_MISSING",
    "no operator policy configured",
    "Set LIGIS_WALLET_POLICY (inline JSON), LIGIS_WALLET_POLICY_FILE (path), or pass --policy <path>. See docs/wallet-enforcement.md for the policy shape.",
  );
}
