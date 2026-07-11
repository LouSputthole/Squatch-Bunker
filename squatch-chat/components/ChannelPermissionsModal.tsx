"use client";

import { useState, useEffect } from "react";

interface Permission {
  id: string;
  channelId: string;
  role: string;
  canView: boolean;
  canSend: boolean;
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
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch(`/api/channels/${channelId}/permissions`)
      .then((r) => r.json())
      .then((data) => setPermissions(data.permissions || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, channelId]);

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
      }
    } catch { /* ignore */ }
    setSaving(null);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-md bg-[var(--panel)] rounded-xl border border-[var(--accent-2)]/30 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--accent-2)]/20">
          <div>
            <h2 className="text-lg font-bold text-[var(--text)]">Channel Permissions</h2>
            <p className="text-xs text-[var(--muted)]">#{channelName}</p>
          </div>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--text)] text-xl leading-none">&times;</button>
        </div>

        <div className="p-5 space-y-4">
          {loading ? (
            <div className="py-6 text-center text-sm text-[var(--muted)]">Loading...</div>
          ) : (
            <>
              <p className="text-xs text-[var(--muted)]">
                Configure which roles can view and send messages in this channel.
                Owners always have full access.
              </p>

              <div className="space-y-3">
                {/* Header */}
                <div className="grid grid-cols-3 gap-2 text-[10px] uppercase text-[var(--muted)] font-semibold px-1">
                  <span>Role</span>
                  <span className="text-center">View</span>
                  <span className="text-center">Send</span>
                </div>

                {ROLES.map((role) => {
                  const perm = getPermission(role);
                  const isSaving = saving === role;
                  return (
                    <div
                      key={role}
                      className="grid grid-cols-3 gap-2 items-center py-2 px-1 rounded-lg hover:bg-[var(--panel-2)]/30 transition-colors"
                    >
                      <span className="text-sm text-[var(--text)] font-medium">{ROLE_LABELS[role]}</span>
                      <div className="flex justify-center">
                        <button
                          onClick={() => togglePermission(role, "canView")}
                          disabled={isSaving}
                          className={`w-9 h-5 rounded-full transition-colors relative ${
                            perm.canView ? "bg-green-500" : "bg-[var(--accent-2)]/30"
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
                          className={`w-9 h-5 rounded-full transition-colors relative ${
                            perm.canSend ? "bg-green-500" : "bg-[var(--accent-2)]/30"
                          } ${isSaving || !perm.canView ? "opacity-50" : ""}`}
                        >
                          <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform ${
                            perm.canSend ? "translate-x-[18px]" : "translate-x-0.5"
                          }`} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {saved && (
                <p className="text-xs text-green-400 text-center">Saved!</p>
              )}

              <div className="pt-2 border-t border-[var(--accent-2)]/20">
                <p className="text-[10px] text-[var(--muted)] italic">
                  Changes take effect immediately. Higher roles inherit lower role permissions.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
