/** One-sentence, plain-language definitions for terms the gate surfaces. */
export const GLOSSARY = {
  shielded:
    "A shielded Zcash address hides the sender, receiver, and amount on-chain. Nobody watching the chain can see who paid whom.",
  zkProof:
    "A zero-knowledge proof convinces the gate that a statement is true (\u201cI hold a valid credential for this payment\u201d) without revealing anything else: not who you are, who issued it, or which one.",
  credential:
    "A signed, revocable statement from an accountable issuer that an address may do a job, for example take escrow payments.",
  registryRoot:
    "A single fingerprint (Merkle root) of every currently valid credential. Revoking a credential changes the fingerprint, so proofs against the old one stop working.",
  nullifier:
    "A one-time tag derived from the proof. The gate records it, so the same proof can't be used twice for the same payment.",
  payeeBinding:
    "The credential is tied to one payee address inside the proof, so a proof can't be reused to pay someone else.",
  unknown:
    "UNKNOWN means a required check couldn't answer (for example the verifier isn't available). It is never approval: the agent must not pay.",
  permission:
    "The kind of job the payee must be credentialed for, such as agent.commerce.escrow.",
} as const;

export type GlossaryKey = keyof typeof GLOSSARY;
