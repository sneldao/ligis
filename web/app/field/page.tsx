import { FieldExperience } from "@/components/catalog/FieldExperience";
import { getChain } from "@/lib/network";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Field",
  description:
    "The Ligis registry as a place you can fly through. Zoom in to a specimen. Zoom out and it stays a map.",
};

export default async function FieldPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const chain = getChain(params);
  const enterRaw = params.enter;
  const enter = Array.isArray(enterRaw) ? enterRaw[0] : enterRaw;
  return <FieldExperience chainId={chain.id} fresh={enter === "1"} />;
}
