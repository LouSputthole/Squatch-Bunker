"use client";

import { useState, useEffect } from "react";
import { useEscape } from "@/hooks/useEscape";
import { toast, toastResponseError } from "@/lib/toast";

interface Permission {
  id: string;
  channelId: string;
  role: string;
  canView: boolean;
  canSend: boolean;
}

interface CustomRole {
  id: string;
  key: string;
  name: string;
  color: string;
}

interface ChannelPermissionsModalProps {
  channelId: string;
  channelName: string;
  open: boolean;
  onClose: () => void;
}

const ROLES = ["member", "mod", "admin"] as const;
const ROLE_LABELS: Record<string, string> = {
  member: "Members",
  mod: "Moderators",
  admin: "Admins",
};

export default function ChannelPermissionsModal({ channelId, channelName, open, onClose }: ChannelPermissionsModalProps) {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [customRoles, setCustomRoles] = useState<CustomRole[]>([]);
  const [roleToAdd, setRoleToAdd] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      setLoading(true);
      setLoadError(false);
      fetch(`/api/channels/${channelId}/permissions`)
        .then((r) => {
          if (!r.ok) throw new Error(`permissions ${r.status}`);
          return r.json();
        })
        .then((data) => {
          setPermissions(data.permissions || []);
          setCustomRoles(data.roles || []);
        })
        .catch(() => setLoadError(true))
        .finally(() => setLoading(false));
    }, 0);
    return () => clearTimeout(timer);
  }, [open, channelId, reloadKey]);

  useEscape(onClose, open);

  function getPermission(role: string): { canView: boolean; canSend: boolean } {
    const p = permissions.find((perm) => perm.role === role);
    return p ? { canView: p.canView, canSend: p.canSend } : { canView: true, canSend: true };
  }

  async function togglePermission(role: string, field: "canView" | "canSend") {
    const current = getPermission(role);
    const newVal = !current[field];
    const updates = { ...current, [field]: newVal };

    // If hiding channel, also disable send
    if (field === "canView" && !newVal) updates.canSend = false;
    await savePermission(role, updates);
  }

  async function savePermission(role: string, updates: { canView: boolean; canSend: boolean }) {
    setSaving(role);
    try {
      const res = await fetch(`/api/channels/${channelId}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, ...updates }),
      });
      if (res.ok) {
        const data = await res.json();
        setPermissions((prev) => {
          const idx = prev.findIndex((p) => p.role === role);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = data.permission;
            return next;
          }
          return [...prev, data.permission];
        });
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      } else {
        await toastResponseError(res, "Failed to save channel permissions");
      }
    } catch {
      toast("Failed to save channel permissions", "error");
    }
    setSaving(null);
  }

  async function removeOverride(role: string) {
    setSaving(role);
    try {
      const res = await fetch(
        `/api/channels/${channelId}/permissions?role=${encodeURIComponent(role)}`,
        { method: "DELETE" },
      );
      if (res.ok) {
        setPermissions((prev) => prev.filter((p) => p.role !== role));
      } else {
        await toastResponseError(res, "Failed to remove the override");
      }
    } catch {
      toast("Failed to remove the override", "error");
    }
    setSaving(null);
  }

  if (!open) return null;

  const roleOverrides = customRoles.filter((role) => permissions.some((p) => p.role === role.key));
  const addableRoles = customRoles.filter((role) => !permissions.some((p) => p.role === role.key));
  const rows: { key: string; label: string; color?: string; removable: boolean }[] = [
    ...ROLES.map((role) => ({ key: role, label: ROLE_LABELS[role], removable: false })),
    ...roleOverrides.map((role) => ({ key: role.key, label: `@${role.name}`, color: role.color, removable: true })),
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="channel-permissions-title"
        className="w-full max-w-md bg-[var(--panel)] rounded-xl border border-[var(--accent-2)]/30 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--accent-2)]/20">
          <div>
            <h2 id="channel-permissions-title" className="text-lg font-bold text-[var(--text)]">Channel Permissions</h2>
            <p className="text-xs text-[var(--muted)]">#{channelName}</p>
          </div>
          <button
            onClick={onClose}
            autoFocus
            aria-label="Close channel permissions"
            className="text-[var(--muted)] hover:text-[var(--text)] text-xl leading-none"
          >
            &times;
          </button>
        </div>

        <div className="p-5 space-y-4">
          {loading ? (
            <div className="py-6 text-center text-sm text-[var(--muted)]">Loading...</div>
          ) : loadError ? (
            <div className="py-6 flex flex-col items-center gap-2 text-sm text-[var(--muted)]" role="alert">
              Couldn&apos;t load permissions.
              <button
                onClick={() => setReloadKey((k) => k + 1)}
                className="text-xs px-3 py-1 rounded bg-[var(--panel-2)] text-[var(--text)] hover:bg-[var(--accent-2)] transition-colors"
              >
                Retry
              </button>
            </div>
          ) : (
            <>
              <p className="text-xs text-[var(--muted)]">
                Configure which roles can view and send messages in this channel.
                Owners always have full access.
              </p>

              <div className="space-y-3">
                {/* Header */}
                <div className="grid grid-cols-[1fr_4rem_4rem_1.5rem] gap-2 text-[10px] uppercase text-[var(--muted)] font-semibold px-1">
                  <span>Role</span>
                  <span className="text-center">View</span>
                  <span className="text-center">Send</span>
                  <span />
                </div>

                {rows.map(({ key: role, label, color, removable }) => {
                  const perm = getPermission(role);
                  const isSaving = saving === role;
                  return (
                    <div
                      key={role}
                      className="grid grid-cols-[1fr_4rem_4rem_1.5rem] gap-2 items-center py-2 px-1 rounded-lg hover:bg-[var(--panel-2)]/30 transition-colors"
                    >
                      <span className="text-sm text-[var(--text)] font-medium truncate" style={color ? { color } : undefined} title={label}>{label}</span>
                      <div className="flex justify-center">
                        <button
                          onClick={() => togglePermission(role, "canView")}
                          disabled={isSaving}
                          role="switch"
                          aria-checked={perm.canView}
                          aria-label={`${label} can view`}
                          className={`w-9 h-5 rounded-full transition-colors relative ${
                            perm.canView ? "bg-[var(--accent)]" : "bg-[var(--accent-2)]/30"
                          } ${isSaving ? "opacity-50" : ""}`}
                        >
                          <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform ${
                            perm.canView ? "translate-x-[18px]" : "translate-x-0.5"
                          }`} />
                        </button>
                      </div>
                      <div className="flex justify-center">
                        <button
                          onClick={() => togglePermission(role, "canSend")}
                          disabled={isSaving || !perm.canView}
                          role="switch"
                          aria-checked={perm.canSend}
                          aria-label={`${label} can send messages`}
                          className={`w-9 h-5 rounded-full transition-colors relative ${
                            perm.canSend ? "bg-[var(--accent)]" : "bg-[var(--accent-2)]/30"
                          } ${isSaving || !perm.canView ? "opacity-50" : ""}`}
                        >
                          <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform ${
                            perm.canSend ? "translate-x-[18px]" : "translate-x-0.5"
                          }`} />
                        </button>
                      </div>
                      {removable ? (
                        <button
                          onClick={() => void removeOverride(role)}
                          disabled={isSaving}
                          aria-label={`Remove the ${label} override`}
                          title="Remove override"
                          className="text-[var(--muted)] hover:text-[var(--danger)] text-lg leading-none disabled:opacity-50"
                        >
                          &times;
                        </button>
                      ) : <span />}
                    </div>
                  );
                })}
              </div>

              {addableRoles.length > 0 && (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!roleToAdd) return;
                    void savePermission(roleToAdd, { canView: true, canSend: true });
                    setRoleToAdd("");
                  }}
                >
                  <label htmlFor="channel-permission-role" className="sr-only">Add a role override</label>
                  <select
                    id="channel-permission-role"
                    value={roleToAdd}
                    onChange={(e) => setRoleToAdd(e.target.value)}
                    className="flex-1 min-w-0 px-2 py-1.5 text-sm bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)]/30 rounded focus:outline-none focus:border-[var(--accent)]"
                  >
                    <option value="">Add a role override…</option>
                    {addableRoles.map((role) => (
                      <option key={role.key} value={role.key}>@{role.name}</option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    disabled={!roleToAdd || saving !== null}
                    className="text-xs px-3 py-1.5 rounded bg-[var(--accent-2)]/40 text-[var(--text)] hover:bg-[var(--accent-2)]/60 disabled:opacity-40 transition-colors"
                  >
                    Add
                  </button>
                </form>
              )}

              {saved && (
                <p className="text-xs text-[var(--accent)] text-center" role="status">Saved</p>
              )}

              <div className="pt-2 border-t border-[var(--accent-2)]/20">
                <p className="text-[10px] text-[var(--muted)] italic">
                  Changes take effect immediately. A custom role override replaces the tier rule for
                  members who hold that role; with several, the most permissive one wins.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
