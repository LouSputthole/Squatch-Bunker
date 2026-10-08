"use client";

import { useEffect, useRef } from "react";

// Stack of open Escape handlers — only the most recently opened layer reacts,
// so Escape in a dialog stacked over a modal closes the dialog, not both.
const stack: symbol[] = [];

/** Calls `onEscape` when Escape is pressed while this layer is the top-most one. */
export function useEscape(onEscape: () => void, active = true): void {
  const handlerRef = useRef(onEscape);
  useEffect(() => {
    handlerRef.current = onEscape;
  });

  useEffect(() => {
    if (!active) return;
    const token = Symbol("escape-layer");
    stack.push(token);
    function handleKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (stack[stack.length - 1] !== token) return;
      e.preventDefault();
      handlerRef.current();
    }
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      const index = stack.lastIndexOf(token);
      if (index >= 0) stack.splice(index, 1);
    };
  }, [active]);
}
