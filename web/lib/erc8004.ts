import "server-only";
import type { Address } from "viem";
import {
  readErc8004,
  MONAD_ERC8004,
  type Erc8004Options,
  type Erc8004Profile,
} from "./payee-evidence/erc8004";

export type { Erc8004Feedback, Erc8004Profile } from "./payee-evidence/erc8004";

/** Compatibility for the agent page. Discovery is no longer address-book-only.
 * The gate reads all scoped identities and coverage, never this first-profile view.
 */
export async function readErc8004Profile(
  address: Address,
  options: Erc8004Options = {},
): Promise<Erc8004Profile | null> {
  const result = await readErc8004(address, options);
  return result.profiles[0] ?? null;
}

export const ERC8004_EXPLORER = {
  identity: `${MONAD_ERC8004.explorer}/address/${MONAD_ERC8004.identity}`,
  reputation: `${MONAD_ERC8004.explorer}/address/${MONAD_ERC8004.reputation}`,
};
