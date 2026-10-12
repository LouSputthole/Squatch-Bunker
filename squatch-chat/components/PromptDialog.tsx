"use client";

import { useId, useState } from "react";
import { useEscape } from "@/hooks/useEscape";

export interface PromptDialogOption {
  value: string;
  label: string;
}

export interface PromptDialogProps {
  title: string;
  /** Optional helper copy under the title. */
  message?: string;
  /**
   * "text" (default) single-line input, "textarea" multi-line, "select" from
   * `options`, or "confirm" for a yes/no question with no input.
   */
  mode?: "text" | "textarea" | "select" | "confirm";
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  options?: PromptDialogOption[];
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as a destructive action. */
  destructive?: boolean;
  /** Allow confirming an empty text value (e.g. clearing a field). */
  allowEmpty?: boolean;
  minLength?: number;
  maxLength?: number;
  /**
   * Called with the entered value (or "" in confirm mode). The caller closes
   * the dialog; while a returned promise is pending the buttons are disabled.
   */
  onConfirm: (value: string) => void | Promise<void>;
  onCancel: () => void;
}

/** What a caller keeps in state to open a dialog: everything except onCancel. */
export type PromptDialogRequest = Omit<PromptDialogProps, "onCancel">;

/**
 * In-app replacement for window.prompt / window.confirm (Electron does not
 * implement prompt()). Render it conditionally; Escape or the backdrop cancels.
 */
export default function PromptDialog({
  title,
  message,
  mode = "text",
  label,
  defaultValue = "",
  placeholder,
  options = [],
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  allowEmpty = false,
  minLength,
  maxLength,
  onConfirm,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(
    mode === "select" && !defaultValue && options.length > 0 ? options[0].value : defaultValue,
  );
  const [busy, setBusy] = useState(false);
  const titleId = useId();
  const inputId = useId();

  useEscape(() => {
    if (!busy) onCancel();
  });

  const trimmedLength = value.trim().length;
  const isEmptyAllowed = allowEmpty && trimmedLength === 0;
  const invalid =
    (mode === "text" || mode === "textarea") &&
    !isEmptyAllowed &&
    (trimmedLength === 0 || (minLength !== undefined && trimmedLength < minLength));

  async function submit() {
    if (busy || invalid) return;
    setBusy(true);
    try {
      await onConfirm(mode === "confirm" ? "" : value);
    } finally {
      setBusy(false);
    }
  }

  const fieldClass =
    "w-full rounded-lg border border-[var(--accent-2)]/40 bg-[var(--panel-2)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none";

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
      // The dialog renders inside its caller's tree; keep its clicks from
      // reaching a parent modal's click-to-close backdrop or row handlers.
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-sm overflow-hidden rounded-xl border border-[var(--accent-2)]/30 bg-[var(--panel)] shadow-2xl"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="space-y-3 px-5 pb-4 pt-5">
          <h2 id={titleId} className="text-base font-semibold text-[var(--text)]">
            {title}
          </h2>
          {message && <p className="text-sm text-[var(--muted)]">{message}</p>}

          {mode !== "confirm" && (
            <div>
              {label && (
                <label htmlFor={inputId} className="mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                  {label}
                </label>
              )}
              {mode === "select" ? (
                <select
                  id={inputId}
                  autoFocus
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className={fieldClass}
                >
                  {options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : mode === "textarea" ? (
                <textarea
                  id={inputId}
                  autoFocus
                  rows={4}
                  value={value}
                  placeholder={placeholder}
                  maxLength={maxLength}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      void submit();
                    }
                  }}
                  className={`${fieldClass} resize-none`}
                />
              ) : (
                <input
                  id={inputId}
                  autoFocus
                  type="text"
                  value={value}
                  placeholder={placeholder}
                  maxLength={maxLength}
                  onChange={(e) => setValue(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  className={fieldClass}
                />
              )}
              {mode === "textarea" && (minLength !== undefined || maxLength !== undefined) && (
                <p className="mt-1 text-right text-[11px] text-[var(--muted)]">
                  {minLength !== undefined && trimmedLength < minLength
                    ? `${minLength - trimmedLength} more characters needed`
                    : maxLength !== undefined
                      ? `${value.length}/${maxLength}`
                      : null}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 bg-[var(--panel-2)]/60 px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg px-3 py-1.5 text-sm text-[var(--muted)] transition-colors hover:text-[var(--text)] disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="submit"
            autoFocus={mode === "confirm"}
            disabled={busy || invalid}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${
              destructive
                ? "bg-[var(--danger)] text-white hover:opacity-90"
                : "bg-[var(--accent)] text-[var(--bg)] hover:bg-[var(--accent-2)] hover:text-[var(--text)]"
            }`}
          >
            {busy ? "Working…" : confirmLabel ?? (mode === "confirm" ? "Confirm" : "Save")}
          </button>
        </div>
      </form>
    </div>
  );
}
