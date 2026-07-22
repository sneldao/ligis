import type { MetadataRoute } from "next";
import { readRecentSubjects } from "@/lib/chain";
import { CHAINS } from "@/lib/network";
import { SITE_URL } from "@/lib/site";

export const revalidate = 3600; // 1 hour

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const staticPages: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/steward`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/capabilities`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/issuers`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
    { url: `${SITE_URL}/embed`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/styleguide`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];

  // Add dynamic agent pages from recent on-chain activity
  const agentPages: MetadataRoute.Sitemap = [];
  for (const chain of CHAINS) {
    if (chain.kind === "evm") {
      try {
        const subjects = await readRecentSubjects(50);
        for (const subject of subjects) {
          agentPages.push({
            url: `${SITE_URL}/agent/${subject}?chain=${chain.id}`,
            lastModified: now,
            changeFrequency: "weekly",
            priority: 0.5,
          });
        }
      } catch {
        // skip chain if RPC fails
      }
    }
  }

  return [...staticPages, ...agentPages];
}
