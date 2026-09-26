"use client";

import { useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

const CHARS_PER_TICK = 2;
const TICK_MS = 16;

/** Types text out once on mount. The full text stays in the DOM for readers. */
export function TypedText({
  text,
  instant = false,
}: {
  text: string;
  instant?: boolean;
}) {
  const reduce = useReducedMotion();
  const skip = instant || reduce;
  const [count, setCount] = useState(skip ? text.length : 0);

  useEffect(() => {
    if (skip) {
      setCount(text.length);
      return;
    }
    const id = setInterval(() => {
      setCount((c) => {
        const next = Math.min(text.length, c + CHARS_PER_TICK);
        if (next === text.length) clearInterval(id);
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [text, skip]);

  const done = count >= text.length;
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden className={done ? undefined : "caret"}>
        {text.slice(0, count)}
      </span>
    </>
  );
}
