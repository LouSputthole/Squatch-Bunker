"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import PromptDialog from "@/components/PromptDialog";
import ReportDialog from "@/components/ReportDialog";
import { UserNoteCard } from "@/components/UserNoteCard";
import { useEscape } from "@/hooks/useEscape";
import { displayName } from "@/lib/utils";
import { toast, toastResponseError } from "@/lib/toast";

interface UserProfileModalProps {
  userId: string;
  currentUserId: string;
  onClose: () => void;
  onMessageUser?: (userId: string) => void;
  onAddFriend?: (userId: string) => void;
  onBlockChange?: (userId: string, blocked: boolean) => void;
}

interface UserData {
  id: string;
  username: string;
  avatar?: string | null;
  banner?: string | null;
  bio?: string | null;
  statusMessage?: string | null;
  createdAt: string;
}

interface MutualServer {
  id: string;
  name: string;
  icon?: string | null;
}

type Tab = "about" | "servers";

function formatJoinDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export default function UserProfileModal(props: UserProfileModalProps) {
  return <UserProfileContent key={props.userId} {...props} />;
}

function UserProfileContent({
  userId,
  currentUserId,
  onClose,
  onMessageUser,
  onAddFriend,
  onBlockChange,
}: UserProfileModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("about");
  const [mutualServers, setMutualServers] = useState<MutualServer[]>([]);
  const [serversLoading, setServersLoading] = useState(false);
  const [friendStatus, setFriendStatus] = useState<"idle" | "sending" | "sent" | "friends" | "error">("idle");
  const [blockStatus, setBlockStatus] = useState<"loading" | "unblocked" | "blocked" | "saving" | "error">(
    userId === currentUserId ? "unblocked" : "loading",
  );
  const [blockError, setBlockError] = useState<string | null>(null);
  const [confirmBlockOpen, setConfirmBlockOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  // Edit state
  const [editing, setEditing] = useState(false);
  const [editBio, setEditBio] = useState("");
  const [editBanner, setEditBanner] = useState("");
  const [saving, setSaving] = useState(false);

  const isSelf = userId === currentUserId;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/users/${userId}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data.user) {
          setUser(data.user);
          setEditBio(data.user.bio || "");
          setEditBanner(data.user.banner || "");
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (isSelf) return;
    let cancelled = false;
    fetch(`/api/blocks/${userId}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load block status.");
        return response.json() as Promise<{ blocked: boolean }>;
      })
      .then((data) => {
        if (!cancelled) setBlockStatus(data.blocked ? "blocked" : "unblocked");
      })
      .catch((statusError: unknown) => {
        if (!cancelled) {
          setBlockStatus("error");
          setBlockError(
            statusError instanceof Error ? statusError.message : "Could not load block status.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isSelf, userId]);

  useEffect(() => {
    if (tab !== "servers") return;
    let cancelled = false;
    fetch(`/api/users/${userId}/mutual-servers`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data.servers) setMutualServers(data.servers);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setServersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, userId]);

  // Stack-aware: Escape in the block/report dialog closes that dialog first.
  useEscape(onClose);

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === backdropRef.current) onClose();
  }

  async function handleAddFriend() {
    if (onAddFriend) onAddFriend(userId);
    if (!user) return;
    setFriendStatus("sending");
    const res = await fetch("/api/friends", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user.username }),
    });
    const data = await res.json();
    if (res.ok) {
      setFriendStatus(data.autoAccepted ? "friends" : "sent");
    } else {
      setFriendStatus(
        data.error === "Already friends"
          ? "friends"
          : data.error === "Request already sent"
          ? "sent"
          : "error"
      );
    }
  }

  function handleBlockClick() {
    if (blockStatus === "blocked") void handleBlockToggle();
    else setConfirmBlockOpen(true);
  }

  async function handleBlockToggle() {
    const wasBlocked = blockStatus === "blocked";
    setBlockStatus("saving");
    setBlockError(null);
    try {
      const response = await fetch(
        wasBlocked ? `/api/blocks/${userId}` : "/api/blocks",
        wasBlocked
          ? { method: "DELETE" }
          : {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userId }),
            },
      );
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error || "Could not update block status.");

      const blocked = !wasBlocked;
      setBlockStatus(blocked ? "blocked" : "unblocked");
      if (blocked) setFriendStatus("idle");
      onBlockChange?.(userId, blocked);
    } catch (toggleError) {
      setBlockStatus(wasBlocked ? "blocked" : "unblocked");
      setBlockError(
        toggleError instanceof Error ? toggleError.message : "Could not update block status.",
      );
    }
  }

  async function handleSaveProfile() {
    setSaving(true);
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bio: editBio, banner: editBanner }),
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setEditing(false);
      } else {
        await toastResponseError(res, "Couldn't save your profile");
      }
    } catch {
      toast("Couldn't save your profile", "error");
    }
    setSaving(false);
  }

  async function handleBannerUpload(file: File) {
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (res.ok) {
        const data = await res.json();
        setEditBanner(data.url);
      } else {
        await toastResponseError(res, "Couldn't upload that banner");
      }
    } catch {
      toast("Couldn't upload that banner", "error");
    }
  }

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
    >
      <div
        className="relative flex flex-col bg-[var(--panel)] border border-[var(--accent-2)]/30 rounded-2xl shadow-2xl overflow-hidden"
        style={{ width: "min(540px, 90vw)", maxHeight: "85vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--panel-2)] transition-colors"
          aria-label="Close"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Banner */}
        {(user?.banner || editBanner) && !loading ? (
          <div className="relative h-28 overflow-hidden">
            <Image
              src={editing ? editBanner || user?.banner || "" : user?.banner || ""}
              alt="Banner"
              fill
              sizes="(max-width: 600px) 90vw, 540px"
              className="object-cover"
              unoptimized
            />
            {editing && (
              <label className="absolute inset-0 flex items-center justify-center bg-black/40 cursor-pointer opacity-0 hover:opacity-100 transition-opacity">
                <span className="text-xs text-white font-medium">Change Banner</span>
                <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleBannerUpload(f);
                }} />
              </label>
            )}
          </div>
        ) : editing ? (
          <label className="h-28 flex items-center justify-center bg-[var(--panel-2)] cursor-pointer hover:bg-[var(--accent-2)]/10 transition-colors border-b border-[var(--accent-2)]/20">
            <span className="text-xs text-[var(--muted)]">Click to add banner</span>
            <input type="file" accept="image/*" className="hidden" onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleBannerUpload(f);
            }} />
          </label>
        ) : null}

        {/* Header */}
        <div className="px-6 pt-4 pb-4 border-b border-[var(--accent-2)]/20">
          {loading ? (
            <div className="flex items-center gap-4">
              <div className="w-[72px] h-[72px] rounded-full bg-[var(--accent-2)]/30 animate-pulse shrink-0" />
              <div className="space-y-2 flex-1">
                <div className="h-5 w-32 rounded bg-[var(--accent-2)]/30 animate-pulse" />
                <div className="h-3 w-48 rounded bg-[var(--accent-2)]/20 animate-pulse" />
              </div>
            </div>
          ) : user ? (
            <>
              <div className="flex items-start gap-4">
                <Avatar
                  username={user.username}
                  avatarUrl={user.avatar}
                  size={72}
                  className="bg-[var(--accent-2)] text-[var(--text)] shrink-0"
                />
                <div className="min-w-0 flex-1 pt-1">
                  <h2 className="text-xl font-bold text-[var(--text)] truncate">
                    {displayName(user.username)}
                  </h2>
                  {user.statusMessage && (
                    <p className="text-sm italic text-[var(--muted)] mt-0.5 truncate">
                      {user.statusMessage}
                    </p>
                  )}
                  <p className="text-xs text-[var(--muted)] mt-1">
                    Joined {formatJoinDate(user.createdAt)}
                  </p>
                </div>
              </div>

              {!isSelf && (
                <div className="mt-4 space-y-2">
                  <div className="flex gap-2">
                  {onMessageUser && blockStatus === "unblocked" && (
                    <button
                      onClick={() => { onMessageUser(userId); onClose(); }}
                      className="flex-1 text-sm px-4 py-2 rounded-lg font-medium transition-colors"
                      style={{ background: "var(--accent-2)", color: "var(--text)" }}
                    >
                      Message
                    </button>
                  )}
                  <button
                    disabled={blockStatus !== "unblocked" || friendStatus === "sending" || friendStatus === "sent" || friendStatus === "friends"}
                    onClick={handleAddFriend}
                    className={`flex-1 text-sm px-4 py-2 rounded-lg font-medium transition-colors ${
                      friendStatus === "friends"
                        ? "bg-[var(--accent)]/15 text-[var(--accent)]"
                        : friendStatus === "sent"
                        ? "bg-[var(--panel-2)] text-[var(--muted)]"
                        : friendStatus === "error"
                        ? "bg-[var(--danger)]/15 text-[var(--danger)]"
                        : "bg-[var(--panel-2)] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--accent-2)]/20"
                    }`}
                  >
                    {friendStatus === "sending"
                      ? "..."
                      : blockStatus === "blocked"
                      ? "Blocked"
                      : friendStatus === "friends"
                      ? "Friends"
                      : friendStatus === "sent"
                      ? "Pending"
                      : friendStatus === "error"
                      ? "Failed"
                      : "Add Friend"}
                  </button>
                  <button
                    type="button"
                    onClick={handleBlockClick}
                    disabled={blockStatus === "loading" || blockStatus === "saving"}
                    className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                      blockStatus === "blocked"
                        ? "bg-[var(--panel-2)] text-[var(--muted)] hover:text-[var(--text)]"
                        : "bg-[var(--danger)]/10 text-[var(--danger)] hover:bg-[var(--danger)]/20"
                    }`}
                  >
                    {blockStatus === "saving"
                      ? "Saving…"
                      : blockStatus === "blocked"
                      ? "Unblock"
                      : "Block"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setReportOpen(true)}
                    className="shrink-0 rounded-lg px-3 py-2 text-sm text-[var(--muted)] bg-[var(--panel-2)] hover:text-[var(--danger)] transition-colors"
                    title={`Report ${displayName(user.username)}`}
                    aria-label={`Report ${displayName(user.username)}`}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                      <line x1="4" y1="22" x2="4" y2="15" />
                    </svg>
                  </button>
                  </div>
                  {blockError && (
                    <p className="text-xs text-[var(--danger)]" role="alert">{blockError}</p>
                  )}
                </div>
              )}

              {isSelf && !editing && (
                <button
                  onClick={() => setEditing(true)}
                  className="mt-3 text-xs px-3 py-1.5 rounded-lg bg-[var(--panel-2)] text-[var(--muted)] hover:text-[var(--text)] transition-colors"
                >
                  Edit Profile
                </button>
              )}
            </>
          ) : (
            <p className="text-sm text-[var(--muted)]">User not found.</p>
          )}
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-[var(--accent-2)]/20 px-6">
          {(isSelf ? (["about"] as Tab[]) : (["about", "servers"] as Tab[])).map((t) => {
            const labels: Record<Tab, string> = {
              about: "About",
              servers: "Mutual Servers",
            };
            return (
              <button
                key={t}
                onClick={() => {
                  if (t === "servers" && tab !== "servers") {
                    setServersLoading(true);
                  }
                  setTab(t);
                }}
                className={`py-3 px-1 mr-6 text-sm font-medium border-b-2 transition-colors ${
                  tab === t
                    ? "border-[var(--accent-2)] text-[var(--text)]"
                    : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"
                }`}
              >
                {labels[t]}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {tab === "about" && user && (
            <div className="space-y-4">
              {/* Bio section */}
              {editing ? (
                <div>
                  <h3 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide mb-2">
                    Bio
                  </h3>
                  <textarea
                    value={editBio}
                    onChange={(e) => setEditBio(e.target.value.slice(0, 500))}
                    placeholder="Tell others about yourself..."
                    rows={3}
                    className="w-full px-3 py-2 text-sm bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)]/30 rounded-lg focus:outline-none focus:border-[var(--accent-2)] placeholder:text-[var(--muted)] resize-none"
                  />
                  <div className="text-[10px] text-[var(--muted)] text-right">{editBio.length}/500</div>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={handleSaveProfile}
                      disabled={saving}
                      className="flex-1 py-1.5 text-xs bg-[var(--accent-2)] text-[var(--text)] rounded-lg hover:bg-[var(--accent)] transition-colors disabled:opacity-50"
                    >
                      {saving ? "Saving..." : "Save"}
                    </button>
                    <button
                      onClick={() => { setEditing(false); setEditBio(user.bio || ""); setEditBanner(user.banner || ""); }}
                      className="flex-1 py-1.5 text-xs bg-[var(--panel-2)] text-[var(--muted)] rounded-lg hover:text-[var(--text)] transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : user.bio ? (
                <div>
                  <h3 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide mb-2">
                    Bio
                  </h3>
                  <p className="text-sm text-[var(--text)] whitespace-pre-wrap">{user.bio}</p>
                </div>
              ) : isSelf ? (
                <div>
                  <h3 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide mb-2">
                    Bio
                  </h3>
                  <p className="text-xs text-[var(--muted)] italic">No bio yet. Click Edit Profile to add one.</p>
                </div>
              ) : null}

              {user.statusMessage && (
                <div>
                  <h3 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide mb-2">
                    Status Message
                  </h3>
                  <p className="text-sm text-[var(--text)] italic">{user.statusMessage}</p>
                </div>
              )}

              <div>
                <h3 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide mb-2">
                  Member Since
                </h3>
                <p className="text-sm text-[var(--text)]">{formatJoinDate(user.createdAt)}</p>
              </div>

              {!isSelf && (
                <UserNoteCard targetUserId={userId} username={displayName(user.username)} />
              )}
            </div>
          )}

          {tab === "servers" && (
            <div>
              {serversLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 p-2">
                      <div className="w-10 h-10 rounded-xl bg-[var(--accent-2)]/30 animate-pulse shrink-0" />
                      <div className="h-4 w-28 rounded bg-[var(--accent-2)]/30 animate-pulse" />
                    </div>
                  ))}
                </div>
              ) : mutualServers.length === 0 ? (
                <p className="text-sm text-[var(--muted)] text-center py-6">No mutual servers</p>
              ) : (
                <ul className="space-y-1">
                  {mutualServers.map((server) => (
                    <li key={server.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-[var(--panel-2)]/50">
                      {server.icon ? (
                        <Image
                          src={server.icon}
                          alt={server.name}
                          width={40}
                          height={40}
                          className="w-10 h-10 rounded-xl object-cover shrink-0"
                          unoptimized
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-xl bg-[var(--accent-2)]/30 flex items-center justify-center text-sm font-bold text-[var(--text)] shrink-0">
                          {server.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span className="text-sm text-[var(--text)]">{server.name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

        </div>
      </div>

      {confirmBlockOpen && (
        <PromptDialog
          mode="confirm"
          title={`Block ${user ? displayName(user.username) : "this user"}?`}
          message="Existing friendship will be removed, their shared-server messages will be collapsed, and neither of you can start new DMs or friend requests."
          confirmLabel="Block"
          destructive
          onConfirm={() => {
            setConfirmBlockOpen(false);
            void handleBlockToggle();
          }}
          onCancel={() => setConfirmBlockOpen(false)}
        />
      )}

      {reportOpen && user && (
        <ReportDialog
          targetUserId={userId}
          targetName={displayName(user.username)}
          onClose={() => setReportOpen(false)}
        />
      )}
    </div>
  );
}
