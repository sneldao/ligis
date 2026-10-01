import "server-only";
import { parseAbiItem, type Address } from "viem";
import { getEvmReadContext } from "./chain";
import erc8004State from "../../assets/erc8004-monad-testnet.json";

/**
 * ERC-8004 reads for Monad testnet — the singleton Identity/Reputation
 * registries at the 0x8004… vanity addresses (see assets/networks.json).
 *
 * Discovery is address-book based: we know the agentIds Ligis registered
 * (assets/erc8004-monad-testnet.json). For each, `getAgentWallet` resolves the
 * wallet the identity is bound to, so `/agent/<address>` can find its 8004
 * identity without a global reverse index.
 */

const IDENTITY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as Address;
const REPUTATION = "0x8004B663056A597Dffe9eCcC1965A193B7388713" as Address;
const NETWORK = "monad-testnet";

const IDENTITY_ABI = [
  parseAbiItem(
    "function getAgentWallet(uint256 agentId) view returns (address)",
  ),
  parseAbiItem("function ownerOf(uint256 tokenId) view returns (address)"),
  parseAbiItem("function tokenURI(uint256 tokenId) view returns (string)"),
];

const REPUTATION_ABI = [
  parseAbiItem("function getClients(uint256 agentId) view returns (address[])"),
  parseAbiItem(
    "function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
  ),
  parseAbiItem(
    "function readFeedback(uint256 agentId, address clientAddress, uint64 feedbackIndex) view returns (int128 value, uint8 valueDecimals, string tag1, string tag2, bool isRevoked)",
  ),
  parseAbiItem(
    "function getLastIndex(uint256 agentId, address clientAddress) view returns (uint64)",
  ),
];

export type Erc8004Feedback = {
  client: Address;
  index: bigint;
  value: bigint;
  valueDecimals: number;
  tag1: string;
  tag2: string;
  revoked: boolean;
};

export type Erc8004Profile = {
  agentId: bigint;
  wallet: Address;
  agentURI: string;
  isLigisSteward: boolean;
  feedbackCount: bigint;
  summaryValue: bigint;
  summaryValueDecimals: number;
  feedback: Erc8004Feedback[];
};

function knownAgentIds(): { id: bigint; role: "steward" | "counterparty" }[] {
  const out: { id: bigint; role: "steward" | "counterparty" }[] = [];
  if (erc8004State.stewardAgentId)
    out.push({ id: BigInt(erc8004State.stewardAgentId), role: "steward" });
  if (erc8004State.counterpartyAgentId)
    out.push({
      id: BigInt(erc8004State.counterpartyAgentId),
      role: "counterparty",
    });
  return out;
}

/**
 * Resolve an ERC-8004 identity + reputation for an EVM address on Monad
 * testnet, or null if the address has no known 8004 registration.
 */
export async function readErc8004Profile(
  address: Address,
): Promise<Erc8004Profile | null> {
  const { client } = getEvmReadContext(NETWORK);
  const lower = address.toLowerCase();

  for (const { id, role } of knownAgentIds()) {
    const wallet = (await client
      .readContract({
        address: IDENTITY,
        abi: IDENTITY_ABI,
        functionName: "getAgentWallet",
        args: [id],
      })
      .catch(() => null)) as Address | null;
    if (!wallet || wallet.toLowerCase() !== lower) continue;

    const [agentURI, clients] = await Promise.all([
      client
        .readContract({
          address: IDENTITY,
          abi: IDENTITY_ABI,
          functionName: "tokenURI",
          args: [id],
        })
        .catch(() => "") as Promise<string>,
      client
        .readContract({
          address: REPUTATION,
          abi: REPUTATION_ABI,
          functionName: "getClients",
          args: [id],
        })
        .catch(() => [] as Address[]),
    ]);

    const [count, summaryValue, summaryDecimals] =
      clients.length > 0
        ? ((await client
            .readContract({
              address: REPUTATION,
              abi: REPUTATION_ABI,
              functionName: "getSummary",
              args: [id, clients, "", ""],
            })
            .catch(() => [0n, 0n, 0])) as [bigint, bigint, number])
        : ([0n, 0n, 0] as [bigint, bigint, number]);

    const feedback: Erc8004Feedback[] = [];
    for (const c of clients) {
      const last = (await client
        .readContract({
          address: REPUTATION,
          abi: REPUTATION_ABI,
          functionName: "getLastIndex",
          args: [id, c],
        })
        .catch(() => 0n)) as bigint;
      for (let i = 1n; i <= last && i <= 10n; i++) {
        const f = (await client
          .readContract({
            address: REPUTATION,
            abi: REPUTATION_ABI,
            functionName: "readFeedback",
            args: [id, c, i],
          })
          .catch(() => null)) as
          | [bigint, number, string, string, boolean]
          | null;
        if (f) {
          feedback.push({
            client: c,
            index: i,
            value: f[0],
            valueDecimals: f[1],
            tag1: f[2],
            tag2: f[3],
            revoked: f[4],
          });
        }
      }
    }

    return {
      agentId: id,
      wallet,
      agentURI,
      isLigisSteward: role === "steward",
      feedbackCount: count,
      summaryValue,
      summaryValueDecimals: summaryDecimals,
      feedback,
    };
  }
  return null;
}

export const ERC8004_EXPLORER = {
  identity: `https://testnet.monadscan.com/address/${IDENTITY}`,
  reputation: `https://testnet.monadscan.com/address/${REPUTATION}`,
};
