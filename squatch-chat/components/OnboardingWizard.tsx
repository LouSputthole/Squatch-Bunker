"use client";

import { useState, useRef } from "react";
import Avatar from "@/components/Avatar";

interface OnboardingWizardProps {
  userId: string;
  username: string;
  currentAvatar?: string | null;
  onComplete: () => void;
  onAvatarChange: (url: string) => void;
}

export default function OnboardingWizard({
  userId,
  username,
  currentAvatar,
  onComplete,
  onAvatarChange,
}: OnboardingWizardProps) {
  const [step, setStep] = useState(1);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(currentAvatar ?? null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const [serverMode, setServerMode] = useState<"create" | "join" | null>(null);
  const [serverName, setServerName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [serverLoading, setServerLoading] = useState(false);
  const [serverError, setServerError] = useState("");
  const [serverDone, setServerDone] = useState<{ type: "created" | "joined"; name: string } | null>(null);

  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copyDone, setCopyDone] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 3: fetch invite when we arrive
  async function enterStep3() {
    setStep(3);
    try {
      const res = await fetch("/api/config");
      const base = res.ok ? ((await res.json()).appUrl || window.location.origin) : window.location.origin;
      if (serverDone) {
        const srvRes = await fetch("/api/servers");
        if (srvRes.ok) {
          const { servers = [] } = await srvRes.json();
          if (servers.length > 0) {
            const invRes = await fetch(`/api/servers/${servers[0].id}/invite`, { method: "POST" });
            if (invRes.ok) {
              const inv = await invRes.json();
              const code = inv.code || inv.inviteCode || "";
              setInviteLink(`${base}/join/${code}`);
              return;
            }
          }
        }
      }
      setInviteLink(`${base}/join/...`);
    } catch {
      setInviteLink(`${window.location.origin}/join/...`);
    }
  }

  // Avatar upload
  async function handleAvatarFile(file: File) {
    setUploading(true);
    setUploadError("");
    try {
      const fd = new FormData();
      fd.append("avatar", file);
      const res = await fetch("/api/auth/avatar", { method: "POST", body: fd });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      const url: string = data.avatarUrl || data.url || data.avatar || "";
      if (url) {
        setAvatarUrl(url);
        onAvatarChange(url);
      }
    } catch {
      setUploadError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  // Create server
  async function handleCreateServer() {
    if (!serverName.trim()) return;
    setServerLoading(true);
    setServerError("");
    try {
      const res = await fetch("/api/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: serverName.trim() }),
      });
      if (!res.ok) throw new Error("Could not create server");
      const data = await res.json();
      setServerDone({ type: "created", name: data.server?.name || serverName.trim() });
    } catch {
      setServerError("Could not create server. Try again.");
    } finally {
      setServerLoading(false);
    }
  }

  // Join server
  async function handleJoinServer() {
    if (!inviteCode.trim()) return;
    setServerLoading(true);
    setServerError("");
    try {
      const res = await fetch("/api/servers/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: inviteCode.trim() }),
      });
      if (!res.ok) throw new Error("Invalid invite code");
      const data = await res.json();
      setServerDone({ type: "joined", name: data.server?.name || "the server" });
    } catch {
      setServerError("Invalid invite code. Try again.");
    } finally {
      setServerLoading(false);
    }
  }

  // Copy invite link
  function handleCopy() {
    if (!inviteLink) return;
    navigator.clipboard.writeText(inviteLink).catch(() => {});
    setCopyDone(true);
    setTimeout(() => setCopyDone(false), 2000);
  }

  function goNext() {
    if (step === 1) setStep(2);
    else if (step === 2) enterStep3();
  }

  function goBack() {
    if (step === 2) setStep(1);
    else if (step === 3) setStep(2);
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 50,
      background: "rgba(0,0,0,0.70)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        background: "var(--panel)",
        borderRadius: "1rem",
        boxShadow: "0 25px 60px rgba(0,0,0,0.5)",
        width: "100%",
        maxWidth: 480,
        padding: "2rem",
        display: "flex",
        flexDirection: "column",
        gap: "1.25rem",
        position: "relative",
      }}>
        {/* Skip button */}
        <button
          onClick={step < 3 ? goNext : onComplete}
          style={{
            position: "absolute", top: "1rem", right: "1rem",
            background: "none", border: "none",
            color: "var(--muted)", fontSize: "0.8rem",
            cursor: "pointer", padding: "0.25rem 0.5rem",
          }}
        >
          Skip
        </button>

        {/* Logo */}
        <div style={{ display: "flex", justifyContent: "center" }}>
          <img src="/Campfire-Logo.png" alt="Campfire" style={{ width: 48, height: 48 }} />
        </div>

        {/* Step 1: Avatar */}
        {step === 1 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem", alignItems: "center" }}>
            <h2 style={{ margin: 0, color: "var(--text)", fontSize: "1.25rem", fontWeight: 700, textAlign: "center" }}>
              Set your avatar
            </h2>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.875rem", textAlign: "center" }}>
              Add a profile picture so your friends can recognise you.
            </p>

            <div style={{ cursor: "pointer" }} onClick={() => fileInputRef.current?.click()}>
              <Avatar
                username={username}
                avatarUrl={avatarUrl}
                size={96}
                className="bg-[var(--accent-2)] text-[var(--text)]"
              />
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleAvatarFile(file);
              }}
            />

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              style={{
                padding: "0.5rem 1.25rem",
                background: "var(--accent)",
                color: "#fff",
                border: "none",
                borderRadius: "0.5rem",
                cursor: uploading ? "not-allowed" : "pointer",
                fontSize: "0.875rem",
                fontWeight: 600,
                opacity: uploading ? 0.7 : 1,
              }}
            >
              {uploading ? "Uploading..." : "Upload Avatar"}
            </button>

            {uploadError && (
              <p style={{ margin: 0, color: "var(--danger)", fontSize: "0.8rem" }}>{uploadError}</p>
            )}
          </div>
        )}

        {/* Step 2: Server */}
        {step === 2 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <h2 style={{ margin: 0, color: "var(--text)", fontSize: "1.25rem", fontWeight: 700, textAlign: "center" }}>
              Create or join a server
            </h2>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.875rem", textAlign: "center" }}>
              Servers are where you and your friends hang out.
            </p>

            {serverDone ? (
              <div style={{
                background: "var(--accent-2)",
                borderRadius: "0.75rem",
                padding: "1rem",
                textAlign: "center",
                color: "var(--text)",
                fontSize: "0.9rem",
              }}>
                {serverDone.type === "created"
                  ? `Server "${serverDone.name}" created!`
                  : `Joined "${serverDone.name}"!`}
              </div>
            ) : (
              <>
                <div style={{ display: "flex", gap: "0.75rem" }}>
                  <button
                    onClick={() => { setServerMode("create"); setServerError(""); }}
                    style={{
                      flex: 1, padding: "0.75rem", borderRadius: "0.75rem",
                      border: `2px solid ${serverMode === "create" ? "var(--accent)" : "var(--accent-2)"}`,
                      background: serverMode === "create" ? "var(--accent)" : "transparent",
                      color: serverMode === "create" ? "#fff" : "var(--muted)",
                      cursor: "pointer", fontWeight: 600, fontSize: "0.875rem",
                    }}
                  >
                    Create a Server
                  </button>
                  <button
                    onClick={() => { setServerMode("join"); setServerError(""); }}
                    style={{
                      flex: 1, padding: "0.75rem", borderRadius: "0.75rem",
                      border: `2px solid ${serverMode === "join" ? "var(--accent)" : "var(--accent-2)"}`,
                      background: serverMode === "join" ? "var(--accent)" : "transparent",
                      color: serverMode === "join" ? "#fff" : "var(--muted)",
                      cursor: "pointer", fontWeight: 600, fontSize: "0.875rem",
                    }}
                  >
                    Join with Invite Code
                  </button>
                </div>

                {serverMode === "create" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    <input
                      type="text"
                      placeholder="Server name"
                      value={serverName}
                      onChange={(e) => setServerName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleCreateServer()}
                      style={{
                        padding: "0.625rem 0.75rem", borderRadius: "0.5rem",
                        border: "1px solid var(--accent-2)", background: "var(--bg)",
                        color: "var(--text)", fontSize: "0.875rem", outline: "none",
                      }}
                    />
                    <button
                      onClick={handleCreateServer}
                      disabled={serverLoading || !serverName.trim()}
                      style={{
                        padding: "0.5rem", background: "var(--accent)", color: "#fff",
                        border: "none", borderRadius: "0.5rem",
                        cursor: serverLoading || !serverName.trim() ? "not-allowed" : "pointer",
                        fontWeight: 600, fontSize: "0.875rem",
                        opacity: serverLoading || !serverName.trim() ? 0.6 : 1,
                      }}
                    >
                      {serverLoading ? "Creating..." : "Create Server"}
                    </button>
                  </div>
                )}

                {serverMode === "join" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    <input
                      type="text"
                      placeholder="Invite code"
                      value={inviteCode}
                      onChange={(e) => setInviteCode(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleJoinServer()}
                      style={{
                        padding: "0.625rem 0.75rem", borderRadius: "0.5rem",
                        border: "1px solid var(--accent-2)", background: "var(--bg)",
                        color: "var(--text)", fontSize: "0.875rem", outline: "none",
                      }}
                    />
                    <button
                      onClick={handleJoinServer}
                      disabled={serverLoading || !inviteCode.trim()}
                      style={{
                        padding: "0.5rem", background: "var(--accent)", color: "#fff",
                        border: "none", borderRadius: "0.5rem",
                        cursor: serverLoading || !inviteCode.trim() ? "not-allowed" : "pointer",
                        fontWeight: 600, fontSize: "0.875rem",
                        opacity: serverLoading || !inviteCode.trim() ? 0.6 : 1,
                      }}
                    >
                      {serverLoading ? "Joining..." : "Join Server"}
                    </button>
                  </div>
                )}

                {serverError && (
                  <p style={{ margin: 0, color: "var(--danger)", fontSize: "0.8rem", textAlign: "center" }}>
                    {serverError}
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* Step 3: Invite */}
        {step === 3 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem", alignItems: "center" }}>
            <h2 style={{ margin: 0, color: "var(--text)", fontSize: "1.25rem", fontWeight: 700, textAlign: "center" }}>
              Invite a friend
            </h2>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.875rem", textAlign: "center" }}>
              Share this link to bring someone into your server.
            </p>

            <div style={{
              display: "flex", width: "100%",
              border: "1px solid var(--accent-2)", borderRadius: "0.5rem", overflow: "hidden",
            }}>
              <input
                readOnly
                value={inviteLink ?? "Generating..."}
                style={{
                  flex: 1, padding: "0.625rem 0.75rem",
                  background: "var(--bg)", color: "var(--text)",
                  fontSize: "0.8rem", border: "none", outline: "none",
                }}
              />
              <button
                onClick={handleCopy}
                style={{
                  padding: "0 1rem", background: "var(--accent)", color: "#fff",
                  border: "none", cursor: "pointer", fontSize: "0.8rem",
                  fontWeight: 600, whiteSpace: "nowrap",
                }}
              >
                {copyDone ? "Copied!" : "Copy Link"}
              </button>
            </div>
          </div>
        )}

        {/* Nav footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "0.25rem" }}>
          <div style={{ width: 72 }}>
            {step > 1 && (
              <button
                onClick={goBack}
                style={{
                  background: "none", border: "1px solid var(--accent-2)",
                  borderRadius: "0.5rem", padding: "0.4rem 0.9rem",
                  color: "var(--muted)", cursor: "pointer", fontSize: "0.85rem",
                }}
              >
                Back
              </button>
            )}
          </div>

          {/* Progress dots */}
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                style={{
                  width: s === step ? 10 : 8,
                  height: s === step ? 10 : 8,
                  borderRadius: "50%",
                  background: s === step ? "var(--accent)" : "var(--accent-2)",
                  transition: "all 0.2s",
                }}
              />
            ))}
          </div>

          <div style={{ width: 72, display: "flex", justifyContent: "flex-end" }}>
            {step < 3 ? (
              <button
                onClick={goNext}
                style={{
                  background: "var(--accent)", border: "none", borderRadius: "0.5rem",
                  padding: "0.4rem 0.9rem", color: "#fff", cursor: "pointer",
                  fontSize: "0.85rem", fontWeight: 600,
                }}
              >
                Next
              </button>
            ) : (
              <button
                onClick={onComplete}
                style={{
                  background: "var(--accent)", border: "none", borderRadius: "0.5rem",
                  padding: "0.4rem 0.9rem", color: "#fff", cursor: "pointer",
                  fontSize: "0.85rem", fontWeight: 600,
                }}
              >
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
