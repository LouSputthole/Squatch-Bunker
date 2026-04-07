"use client";

import { useState } from "react";

export default function TestPage() {
  const [count, setCount] = useState(0);
  const [clicked, setClicked] = useState(false);

  return (
    <div style={{ padding: "2rem", fontFamily: "sans-serif", color: "#fff", background: "#111", minHeight: "100vh" }}>
      <h1>Hydration Test</h1>
      <p>If the buttons below work, React hydration is functional.</p>
      <div style={{ marginTop: "1rem", display: "flex", gap: "1rem" }}>
        <button
          type="button"
          onClick={() => setCount((c) => c + 1)}
          style={{ padding: "12px 24px", fontSize: "18px", background: "#c2410c", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer" }}
        >
          Count: {count}
        </button>
        <button
          type="button"
          onClick={() => setClicked(true)}
          style={{ padding: "12px 24px", fontSize: "18px", background: "#0e7490", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer" }}
        >
          {clicked ? "CLICKED - IT WORKS!" : "Click Me"}
        </button>
      </div>
      {clicked && (
        <p style={{ marginTop: "1rem", color: "#4ade80", fontSize: "20px", fontWeight: "bold" }}>
          React hydration is working! The login page issue is component-specific.
        </p>
      )}
      <p style={{ marginTop: "2rem", color: "#888", fontSize: "14px" }}>
        Count value: {count} | Clicked: {clicked ? "yes" : "no"}
      </p>
    </div>
  );
}
