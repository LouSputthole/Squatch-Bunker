"use client";

import { useEffect, useState } from "react";
import { subscribeToasts, type ToastItem } from "@/lib/toast";

const KIND_STYLES: Record<ToastItem["kind"], string> = {
  info: "border-[var(--accent-2)]/60",
  success: "border-green-500/60",
  error: "border-[var(--danger)]",
};

export default function Toaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(
    () =>
      subscribeToasts((item) => {
        setToasts((current) => [...current.slice(-3), item]);
        setTimeout(() => setToasts((current) => current.filter((t) => t.id !== item.id)), item.kind === "error" ? 6000 : 3500);
      }),
    [],
  );

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-3 z-[200] flex flex-col items-center gap-2 px-4"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === "error" ? "alert" : "status"}
          className={`pointer-events-auto max-w-md rounded-lg border bg-[var(--panel)] px-4 py-2.5 text-sm text-[var(--text)] shadow-xl ${KIND_STYLES[t.kind]}`}
          onClick={() => setToasts((current) => current.filter((x) => x.id !== t.id))}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
