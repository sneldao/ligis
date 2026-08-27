import { permanentRedirect } from "next/navigation";

type SearchParams = Promise<{ subject?: string; capability?: string }>;

export default async function VerifyCasperRedirect({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { subject, capability } = await searchParams;
  const params = new URLSearchParams({ chain: "casper-testnet" });
  if (subject) params.set("subject", subject);
  if (capability) params.set("capability", capability);
  permanentRedirect(`/gate?${params.toString()}`);
}
