import Image from "next/image";
import Link from "next/link";

export default function NotFound() {
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
        style={{ opacity: 0.7 }}
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
          404 — Lost in the Woods
        </h1>
        <p
          style={{
            fontSize: "0.95rem",
            color: "var(--muted)",
            margin: 0,
            maxWidth: "480px",
          }}
        >
          Looks like you wandered off the trail. The page you&apos;re looking for
          doesn&apos;t exist or has moved deeper into the forest.
        </p>
      </div>

      <Link
        href="/chat"
        style={{
          padding: "0.6rem 1.4rem",
          background: "var(--accent)",
          color: "var(--bg)",
          border: "none",
          borderRadius: "6px",
          fontSize: "0.9rem",
          fontWeight: 600,
          textDecoration: "none",
        }}
      >
        Head Back to Camp
      </Link>
    </div>
  );
}
