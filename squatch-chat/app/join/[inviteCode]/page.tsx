"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { use } from "react";

interface ServerPreview {
  id: string;
  name: string;
  icon?: string | null;
  _count: { members: number };
}

interface InvitePreview {
  expiresAt: string | null;
  maxUses: number | null;
  useCount: number;
  remainingUses: number | null;
}

export default function JoinPage({
  params,
}: {
  params: Promise<{ inviteCode: string }>;
}) {
  const { inviteCode } = use(params);
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "preview" | "joining" | "error" | "success">("loading");
  const [error, setError] = useState("");
  const [server, setServer] = useState<ServerPreview | null>(null);
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [alreadyMember, setAlreadyMember] = useState(false);

  // Fetch server preview on load
  useEffect(() => {
    async function fetchPreview() {
      try {
        const res = await fetch(`/api/servers/preview?inviteCode=${encodeURIComponent(inviteCode)}`);
        if (res.status === 401) {
          router.push(`/login?redirect=/join/${inviteCode}`);
          return;
        }
        if (!res.ok) {
          const data = await res.json();
          setError(data.error || "Invalid invite link");
          setStatus("error");
          return;
        }
        const data = await res.json();
        setServer(data.server);
        setInvite(data.invite);
        setAlreadyMember(Boolean(data.alreadyMember));
        setStatus("preview");
      } catch {
        setError("Something went wrong");
        setStatus("error");
      }
    }

    fetchPreview();
  }, [inviteCode, router]);

  async function handleJoin() {
    if (status === "joining") return;
    setStatus("joining");
    try {
      const res = await fetch("/api/servers/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode }),
      });

      if (!res.ok) {
        const data = await res.json();
        if (res.status === 401) {
          router.push(`/login?redirect=/join/${inviteCode}`);
          return;
        }
        setError(data.error || "Failed to join");
        setStatus("error");
        return;
      }

      const data = await res.json();
      setStatus("success");
      const serverId = data.server?.id || server?.id;
      setTimeout(
        () => router.push(serverId ? `/chat?s=${serverId}` : "/chat"),
        700,
      );
    } catch {
      setError("Something went wrong");
      setStatus("error");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
      <div className="w-full max-w-sm mx-4">
        {status === "loading" && (
          <div className="text-center">
            <p className="text-[var(--muted)] text-lg">Loading invite...</p>
          </div>
        )}

        {status === "preview" && server && (
          <div className="bg-[var(--panel)] rounded-xl border border-[var(--accent-2)]/30 shadow-2xl overflow-hidden">
            <div className="p-8 text-center">
              {/* Server icon */}
              <div className="flex justify-center mb-4">
                {server.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element -- server icons may be user-hosted, data, or blob URLs
                  <img
                    src={server.icon}
                    alt={server.name}
                    className="w-20 h-20 rounded-2xl object-cover"
                  />
                ) : (
                  <div
                    className="w-20 h-20 rounded-2xl flex items-center justify-center text-3xl font-bold text-[var(--text)]"
                    style={{ background: "var(--accent-2)" }}
                  >
                    {server.name.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>

              <p className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide mb-1">
                You&apos;ve been invited to join
              </p>
              <h1 className="text-2xl font-bold text-[var(--text)] mb-1">{server.name}</h1>
              <p className="text-sm text-[var(--muted)] mb-6">
                {server._count.members} {server._count.members === 1 ? "member" : "members"}
              </p>

              {alreadyMember ? (
                <p className="text-sm text-green-400 mb-4">
                  You are already a member of this server.
                </p>
              ) : (
                <div className="mb-4 rounded-lg bg-[var(--panel-2)]/60 px-3 py-2 text-xs text-[var(--muted)]">
                  <p>
                    {invite?.expiresAt
                      ? `Expires ${new Date(invite.expiresAt).toLocaleString()}`
                      : "This invite does not expire"}
                  </p>
                  {invite?.remainingUses !== null &&
                    invite?.remainingUses !== undefined && (
                      <p className="mt-1">
                        {invite.remainingUses}{" "}
                        {invite.remainingUses === 1 ? "use" : "uses"} remaining
                      </p>
                    )}
                </div>
              )}

              <button
                onClick={handleJoin}
                className="w-full py-3 bg-[var(--accent)] hover:bg-[var(--accent-2)] text-[var(--bg)] font-semibold rounded-lg transition-colors text-sm"
              >
                {alreadyMember ? "Open Server" : "Join Server"}
              </button>
              <button
                onClick={() => router.push("/chat")}
                className="w-full mt-2 py-2 text-sm text-[var(--muted)] hover:text-[var(--text)] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {status === "joining" && (
          <div className="text-center">
            <p className="text-[var(--muted)] text-lg">Joining server...</p>
          </div>
        )}

        {status === "success" && (
          <div className="text-center">
            <p className="text-[var(--text)] text-lg mb-2">You&apos;re in!</p>
            <p className="text-[var(--muted)] text-sm">Redirecting to chat...</p>
          </div>
        )}

        {status === "error" && (
          <div className="text-center">
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
