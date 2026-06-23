/**
 * Ligis — CLI
 *
 * Usage:
 *   ligis issue [--token-uri <uri>] [--controller <addr>]
 *   ligis verify --subject <addr> --capability <name|hash> [--issuer <addr>]
 *   ligis revoke --subject <addr> --capability <name|hash> --nonce <n> [--issuer-key <key>]
 *   ligis rotate --token-id <id> --new-controller <addr>
 *   ligis hash --capability <name>
 *   ligis sign --issuer-key <key> --subject <addr> --capability <name|hash> [--expires-in <seconds>]
 *   ligis info
 */
import { CREDENTIAL_REGISTRY_ABI, PHAROS_AGENT_ID_ABI } from "../lib/index.js";
export { PHAROS_AGENT_ID_ABI, CREDENTIAL_REGISTRY_ABI };
