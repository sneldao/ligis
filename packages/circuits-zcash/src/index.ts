/**
 * @ligis/circuits-zcash — off-chain half of the Week 2 credential circuit.
 *
 * Mirrors `circuit/src/main.nr` exactly: Poseidon (BN254, circomlib
 * parameters) for the identity commitment, credential leaf, nullifier, and
 * Merkle nodes. Build the registry tree here from CredentialRegistry state,
 * publish/anchor its root, and hand a holder their witness.
 */
import { buildPoseidon } from "circomlibjs";
import { TREE_DEPTH, fieldHex, toField } from "./fields.js";

export * from "./fields.js";
export {
  PINNED_BB,
  encodePublicInputs,
  resolveBb,
  verifyMembershipProof,
  type BbResolution,
  type VerifyOutcome,
} from "./verify.js";

export {
  proveAndVerify,
  resolveToolchain,
  type Toolchain,
} from "./toolchain.js";

type Poseidon = (inputs: bigint[]) => bigint;
let poseidonPromise: Promise<Poseidon> | undefined;

/** Lazily-built circomlib Poseidon, returning field elements as bigint. */
export function getPoseidon(): Promise<Poseidon> {
  poseidonPromise ??= buildPoseidon().then(
    (p) => (inputs: bigint[]) => p.F.toObject(p(inputs)) as bigint,
  );
  return poseidonPromise;
}

export type CredentialLeafInput = {
  /** H(identity_secret). The tree stores this, never the subject address. */
  identityCommitment: bigint;
  capabilityHash: bigint;
  issuer: bigint;
  /** Unix seconds; must be > the proof's `current_time`. */
  expiresAt: bigint;
  /** CredentialRegistry nonce for (subject, capability). */
  nonce: bigint;
};

export async function identityCommitment(
  identitySecret: bigint,
): Promise<bigint> {
  return (await getPoseidon())([toField(identitySecret)]);
}

export async function credentialLeaf(c: CredentialLeafInput): Promise<bigint> {
  return (await getPoseidon())([
    c.identityCommitment,
    c.capabilityHash,
    c.issuer,
    c.expiresAt,
    c.nonce,
  ]);
}

export async function nullifierFor(
  identitySecret: bigint,
  capabilityHash: bigint,
  context: bigint,
): Promise<bigint> {
  return (await getPoseidon())([
    toField(identitySecret),
    capabilityHash,
    context,
  ]);
}

/** Fixed-depth sparse Poseidon Merkle tree; empty leaves are 0. */
export class CredentialTree {
  readonly depth: number;
  private readonly levels: Map<number, bigint>[];
  private readonly zeros: bigint[];

  private constructor(depth: number, poseidon: Poseidon, leaves: bigint[]) {
    if (leaves.length > 2 ** depth) throw new RangeError("tree is full");
    this.depth = depth;
    this.zeros = [0n];
    for (let i = 0; i < depth; i++) {
      this.zeros.push(poseidon([this.zeros[i]!, this.zeros[i]!]));
    }
    this.levels = [new Map(leaves.map((l, i) => [i, l]))];
    for (let lvl = 0; lvl < depth; lvl++) {
      const cur = this.levels[lvl]!;
      const next = new Map<number, bigint>();
      for (const idx of cur.keys()) {
        const parent = idx >> 1;
        if (next.has(parent)) continue;
        const left = cur.get(parent * 2) ?? this.zeros[lvl]!;
        const right = cur.get(parent * 2 + 1) ?? this.zeros[lvl]!;
        next.set(parent, poseidon([left, right]));
      }
      this.levels.push(next);
    }
  }

  static async build(
    leaves: bigint[],
    depth = TREE_DEPTH,
  ): Promise<CredentialTree> {
    return new CredentialTree(depth, await getPoseidon(), leaves);
  }

  get root(): bigint {
    return this.levels[this.depth]!.get(0) ?? this.zeros[this.depth]!;
  }

  /** Sibling path for `index`, bottom-up — the circuit's `merkle_path`. */
  path(index: number): bigint[] {
    if (!this.levels[0]!.has(index))
      throw new RangeError(`no leaf at ${index}`);
    const out: bigint[] = [];
    let idx = index;
    for (let lvl = 0; lvl < this.depth; lvl++) {
      out.push(this.levels[lvl]!.get(idx ^ 1) ?? this.zeros[lvl]!);
      idx >>= 1;
    }
    return out;
  }
}

export type CircuitInputs = {
  // public
  registry_root: bigint;
  capability_hash: bigint;
  context: bigint;
  current_time: bigint;
  nullifier: bigint;
  // private
  identity_secret: bigint;
  issuer: bigint;
  expires_at: bigint;
  credential_nonce: bigint;
  leaf_index: bigint;
  merkle_path: bigint[];
};

/** Assemble a holder's witness for credential `index` in `tree`. */
export async function buildInputs(args: {
  tree: CredentialTree;
  index: number;
  identitySecret: bigint;
  credential: Omit<CredentialLeafInput, "identityCommitment">;
  context: bigint;
  currentTime: bigint;
}): Promise<CircuitInputs> {
  const { tree, index, identitySecret, credential, context, currentTime } =
    args;
  return {
    registry_root: tree.root,
    capability_hash: credential.capabilityHash,
    context,
    current_time: currentTime,
    nullifier: await nullifierFor(
      identitySecret,
      credential.capabilityHash,
      context,
    ),
    identity_secret: toField(identitySecret),
    issuer: credential.issuer,
    expires_at: credential.expiresAt,
    credential_nonce: credential.nonce,
    leaf_index: BigInt(index),
    merkle_path: tree.path(index),
  };
}

/** Serialize inputs as a Nargo `Prover.toml`. */
export function toProverToml(inputs: CircuitInputs): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(inputs)) {
    if (Array.isArray(v)) {
      lines.push(`${k} = [${v.map((x) => `"${fieldHex(x)}"`).join(", ")}]`);
    } else if (k === "current_time" || k === "expires_at") {
      lines.push(`${k} = "${v.toString()}"`);
    } else {
      lines.push(`${k} = "${fieldHex(v)}"`);
    }
  }
  return `${lines.join("\n")}\n`;
}
