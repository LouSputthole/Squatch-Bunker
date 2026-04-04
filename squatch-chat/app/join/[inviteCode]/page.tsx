"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { use } from "react";

export default function JoinPage({
  params,
}: {
  params: Promise<{ inviteCode: string }>;
}) {
  const { inviteCode } = use(params);
  const router = useRouter();
  const [status, setStatus] = useState<"joining" | "error" | "success">("joining");
  const [error, setError] = useState("");

  useEffect(() => {
    async function joinServer() {
      try {
        const res = await fetch("/api/servers/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ inviteCode }),
        });

        if (!res.ok) {
          const data = await res.json();
          if (res.status === 401) {
            // Not logged in - redirect to login then back
            router.push(`/login?redirect=/join/${inviteCode}`);
            return;
          }
          setError(data.error || "Failed to join");
          setStatus("error");
          return;
        }

        setStatus("success");
        setTimeout(() => router.push("/chat"), 1000);
      } catch {
        setError("Something went wrong");
        setStatus("error");
      }
    }

    joinServer();
  }, [inviteCode, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
      <div className="text-center">
        {status === "joining" && (
          <p className="text-[var(--muted)] text-lg">Joining server...</p>
        )}
        {status === "success" && (
          <div>
            <p className="text-[var(--text)] text-lg mb-2">You&apos;re in!</p>
            <p className="text-[var(--muted)] text-sm">Redirecting to chat...</p>
          </div>
        )}
        {status === "error" && (
          <div>
            <p className="text-[var(--danger)] text-lg mb-2">{error}</p>
            <button
              onClick={() => router.push("/chat")}
              className="text-[var(--accent)] hover:underline text-sm"
            >
              Back to chat
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
