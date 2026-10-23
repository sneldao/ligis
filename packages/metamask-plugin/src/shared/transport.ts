/**
 * Default gate transport for the plugin commands — plain fetch over HTTPS.
 * The guard's Transport signature is a subset of fetch init, so this is a
 * thin adapter; tests inject their own.
 */
import type { Transport } from "@ligis/wallet-plugin";

export const defaultTransport: Transport = async (url, init) => {
  const response = await fetch(url, init);
  return {
    status: response.status,
    json: () => response.json() as Promise<unknown>,
  };
};
