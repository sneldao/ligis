"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { counterAction } from "@/app/actions/counter";

/**
 * Fires `share_link_open` once when /gate (or /arena) mounts with a
 * shareable query string. Privacy-light: only the bucket is recorded —
 * the subject / capability values stay in the URL but are not logged.
 *
 * Mounting this on a page without share-link params is free.
 */
export function ShareLinkCounter({
  bucket,
}: {
  bucket: "share:gate" | "share:arena";
}) {
  const params = useSearchParams();
  useEffect(() => {
    if (!params) return;
    // Consider it a share-link open if there's any non-trivial query.
    const subject = params.get("subject");
    const situation = params.get("situation");
    const payment = params.get("payment");
    if (!subject && !situation && !payment) return;
    void counterAction("share_link_open", bucket);
    // intentionally exclude params from deps — fire exactly once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
