import { permanentRedirect } from "next/navigation";

type SearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

/**
 * /verify is the legacy path for the gate page. Every surface now emits
 * /gate — the product's verb in the URL — so /verify permanently redirects
 * (query params preserved) instead of serving a second copy of the page.
 */
export default async function VerifyRedirect({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const v of value) qs.append(key, v);
    } else if (value !== undefined) {
      qs.set(key, value);
    }
  }
  const suffix = qs.toString();
  permanentRedirect(`/gate${suffix ? `?${suffix}` : ""}`);
}
