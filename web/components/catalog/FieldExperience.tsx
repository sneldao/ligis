"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useReducedMotion } from "framer-motion";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { FieldChrome } from "./FieldChrome";
import { QuietField } from "./QuietField";
import { SceneErrorBoundary } from "./SceneErrorBoundary";
import { resetRig, setFieldChainId } from "./catalogState";

const CatalogScene = dynamic(
  () => import("./CatalogScene").then((module) => module.CatalogScene),
  { ssr: false },
);

let webglSupported: boolean | null = null;
function checkWebGL(): boolean {
  if (webglSupported !== null) return webglSupported;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    webglSupported = !!gl;
  } catch {
    webglSupported = false;
  }
  return webglSupported;
}

export function FieldExperience({ chainId }: { chainId: string }) {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const [webglOk, setWebglOk] = useState(false);
  const [ready, setReady] = useState(false);
  const leaveHref = `/?chain=${encodeURIComponent(chainId)}`;

  useBodyScrollLock(true);

  useEffect(() => {
    setFieldChainId(chainId);
    resetRig();
    return () => setFieldChainId(null);
  }, [chainId]);

  useEffect(() => {
    setWebglOk(checkWebGL());
    const id = window.setTimeout(() => setReady(true), 80);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (document.querySelector('[aria-expanded="true"]')) return;
      e.preventDefault();
      router.push(leaveHref);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leaveHref, router]);

  const showScene = !reducedMotion && webglOk && ready;

  return (
    <div className="relative h-dvh overflow-hidden bg-paper">
      <div className="absolute inset-0">
        <QuietField />
      </div>
      {showScene ? (
        <div className="absolute inset-0 animate-fade-in">
          <SceneErrorBoundary>
            <CatalogScene />
          </SceneErrorBoundary>
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center px-6">
          <p className="max-w-sm text-center font-serif text-base italic leading-relaxed text-ink-soft">
            {reducedMotion
              ? "Motion is reduced, so the field stays still. The registry is still here."
              : ready && !webglOk
                ? "This device can’t run the live field. The rest of Ligis is on the landing page."
                : "Opening the field…"}
          </p>
        </div>
      )}
      <FieldChrome leaveHref={leaveHref} />
    </div>
  );
}
