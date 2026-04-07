"use client";

import Link from "next/link";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ChatError({ error, reset }: ErrorProps) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg)",
        padding: "2rem",
      }}
    >
      <div
        style={{
          background: "var(--panel)",
          border: "1px solid var(--danger)",
          borderRadius: "10px",
          padding: "2rem",
          maxWidth: "420px",
          width: "100%",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
        }}
      >
        <div
          style={{
            width: "40px",
            height: "40px",
            borderRadius: "50%",
            background: "var(--danger)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto",
            fontSize: "1.2rem",
          }}
        >
          !
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <h2
            style={{
              fontSize: "1.1rem",
              fontWeight: 600,
              color: "var(--text)",
              margin: 0,
            }}
          >
            Chat ran into a problem
          </h2>
          <p
            style={{
              fontSize: "0.875rem",
              color: "var(--muted)",
              margin: 0,
            }}
          >
            {error.message || "Something went wrong loading this chat. Try again or head back to the main view."}
          </p>
          {error.digest && (
            <p
              style={{
                fontSize: "0.75rem",
                color: "var(--muted)",
                fontFamily: "monospace",
                margin: 0,
              }}
            >
              Error ID: {error.digest}
            </p>
          )}
        </div>

        <div
          style={{
            display: "flex",
            gap: "0.75rem",
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          <button
            onClick={reset}
            style={{
              padding: "0.5rem 1.2rem",
              background: "var(--accent)",
              color: "var(--bg)",
              border: "none",
              borderRadius: "6px",
              fontSize: "0.875rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Retry
          </button>
          <Link
            href="/chat"
            style={{
              padding: "0.5rem 1.2rem",
              background: "transparent",
              color: "var(--muted)",
              border: "1px solid var(--accent-2)",
              borderRadius: "6px",
              fontSize: "0.875rem",
              fontWeight: 500,
              textDecoration: "none",
            }}
          >
            Back to /chat
          </Link>
        </div>
      </div>
    </div>
  );
}
