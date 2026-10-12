// Tiny app-wide toast bus — replaces alert() for non-blocking feedback.
// Call toast("Saved") / toast(err.message, "error") from anywhere on the client;
// <Toaster /> (mounted once in app/layout.tsx) renders them.

export type ToastKind = "info" | "success" | "error";
export interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

type Listener = (toast: ToastItem) => void;
const listeners = new Set<Listener>();
let nextId = 1;

export function toast(message: string, kind: ToastKind = "info"): void {
  const item = { id: nextId++, message, kind };
  listeners.forEach((listener) => listener(item));
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reads `{ error }` from a failed fetch Response, falling back to a generic message. */
export async function toastResponseError(res: Response, fallback: string): Promise<void> {
  let message = fallback;
  try {
    const data = await res.json();
    if (data && typeof data.error === "string" && data.error) message = data.error;
  } catch {}
  toast(message, "error");
}
