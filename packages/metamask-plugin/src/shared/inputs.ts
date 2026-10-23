/**
 * Shared input schema for the ligis commands. Indexes order the prompt flow
 * (host convention); required fields prompt interactively when the flag is
 * missing, optional fields never prompt.
 */
import {
  InputFieldType,
  type InputSchema,
} from "@metamask/agent-wallet/plugin";

export const operationInputs = {
  chainId: {
    type: InputFieldType.Text,
    flag: "chain-id",
    message:
      "EVM chain id the payment authorizes (e.g. 10143 for Monad testnet)",
    index: 0,
    prompt: true,
  },
  payee: {
    type: InputFieldType.Text,
    flag: "payee",
    message: "Payment recipient address (0x…)",
    index: 1,
    prompt: true,
  },
  value: {
    type: InputFieldType.Text,
    flag: "value",
    message:
      "Amount in base units, decimal (e.g. 5000000 = 5 USDC at 6 decimals)",
    index: 2,
    prompt: true,
  },
  asset: {
    type: InputFieldType.Text,
    flag: "asset",
    message: "EIP-3009 token contract (the verifyingContract)",
    index: 3,
    prompt: true,
  },
  from: {
    type: InputFieldType.Text,
    flag: "from",
    message: "Payer address (default: the wallet's selected EVM account)",
    index: 4,
    required: false,
    prompt: false,
  },
  domainName: {
    type: InputFieldType.Text,
    flag: "domain-name",
    message: "EIP-712 domain name of the token (default: USD Coin)",
    index: 5,
    required: false,
    prompt: false,
  },
  domainVersion: {
    type: InputFieldType.Text,
    flag: "domain-version",
    message: "EIP-712 domain version of the token (default: 2)",
    index: 6,
    required: false,
    prompt: false,
  },
  validFor: {
    type: InputFieldType.Text,
    flag: "valid-for",
    message: "Validity window in seconds (default 300)",
    index: 7,
    required: false,
    prompt: false,
  },
  nonce: {
    type: InputFieldType.Text,
    flag: "nonce",
    message: "0x-prefixed 32-byte nonce (default: random)",
    index: 8,
    required: false,
    prompt: false,
  },
  purpose: {
    type: InputFieldType.Text,
    flag: "purpose",
    message: "Stated purpose — forwarded to the gate as the agent request",
    index: 9,
    required: false,
    prompt: false,
  },
  policy: {
    type: InputFieldType.Text,
    flag: "policy",
    message:
      "Path to the operator policy JSON (else LIGIS_WALLET_POLICY / _FILE)",
    index: 10,
    required: false,
    prompt: false,
  },
  mandateMaxUsd: {
    type: InputFieldType.Text,
    flag: "mandate-max-usd",
    message: "Agent mandate: tighten the per-payment USD cap",
    index: 11,
    required: false,
    prompt: false,
  },
  mandateMaxSeconds: {
    type: InputFieldType.Text,
    flag: "mandate-max-seconds",
    message: "Agent mandate: shorten the validity window (seconds)",
    index: 12,
    required: false,
    prompt: false,
  },
  mandateCapability: {
    type: InputFieldType.Text,
    flag: "mandate-capability",
    message: "Agent mandate: add a required payee capability",
    index: 13,
    required: false,
    prompt: false,
  },
} satisfies InputSchema;
