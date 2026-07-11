"use client";

import Image from "next/image";
import Link from "next/link";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: ErrorProps) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg)",
        color: "var(--text)",
        padding: "2rem",
        textAlign: "center",
        gap: "1.5rem",
      }}
    >
      <Image
        src="/Campfire-Logo.png"
        alt="Campfire"
        width={80}
        height={80}
        style={{ opacity: 0.85 }}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <h1
          style={{
            fontSize: "1.75rem",
            fontWeight: 700,
            color: "var(--text)",
            margin: 0,
          }}
        >
          Something went wrong around the campfire
        </h1>
        <p
          style={{
            fontSize: "0.95rem",
            color: "var(--muted)",
            margin: 0,
            maxWidth: "480px",
          }}
        >
          {error.message || "An unexpected error occurred. The fire went out — but we can relight it."}
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

      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", justifyContent: "center" }}>
        <button
          onClick={reset}
          style={{
            padding: "0.6rem 1.4rem",
            background: "var(--accent)",
            color: "var(--bg)",
            border: "none",
            borderRadius: "6px",
            fontSize: "0.9rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Retry
        </button>
        <Link
          href="/chat"
          style={{
            padding: "0.6rem 1.4rem",
            background: "var(--panel)",
            color: "var(--text)",
            border: "1px solid var(--accent-2)",
            borderRadius: "6px",
            fontSize: "0.9rem",
            fontWeight: 500,
            textDecoration: "none",
          }}
        >
          Back to Chat
        </Link>
      </div>
    </div>
  );
}
