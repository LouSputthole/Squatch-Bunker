"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Popover open-state that closes on outside mousedown or Escape.
 * Attach the returned ref to the popover's positioning container — a click on
 * any other button counts as "outside", so opening one popover dismisses the
 * previous one without cross-component coordination.
 */
export function useDismissable<T extends HTMLElement = HTMLDivElement>() {
  const [open, setOpen] = useState(false);
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return { open, setOpen, ref };
}
