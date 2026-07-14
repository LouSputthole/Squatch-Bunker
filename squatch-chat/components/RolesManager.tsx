"use client";

import { useState, useEffect, useCallback } from "react";
import { PERMISSIONS, PERMISSION_DESCRIPTIONS, type PermKey } from "@/lib/permissions";

interface Role {
  id: string;
  name: string;
  color: string;
  permissions: string; // JSON array
  position: number;
  isDefault: boolean;
}

const PERM_KEYS = Object.keys(PERMISSIONS) as PermKey[];

export default function RolesManager({ serverId }: { serverId: string }) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/servers/${serverId}/roles`);
      if (r.ok) {
        const d = await r.json();
        setRoles(d.roles || []);
        setCanManage(!!d.canManageRoles);
      }
    } catch { /* ignore */ }
  }, [serverId]);

  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const role = roles.find((r) => r.id === selectedId) || null;
  let perms: PermKey[] = [];
  try { perms = role ? JSON.parse(role.permissions || "[]") : []; } catch { perms = []; }

  async function createRole() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true); setError("");
    try {
      const r = await fetch(`/api/servers/${serverId}/roles`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't create role");
      setNewName("");
      await load();
      setSelectedId(d.role.id);
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setBusy(false); }
  }

  async function patchRole(updates: Record<string, unknown>) {
    if (!role) return;
    setBusy(true); setError("");
    // optimistic
    setRoles((rs) => rs.map((r) => (r.id === role.id ? { ...r, ...updates, permissions: updates.permissions ? JSON.stringify(updates.permissions) : r.permissions } : r)));
    try {
      const r = await fetch(`/api/servers/${serverId}/roles/${role.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updates),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || "Couldn't save"); }
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); await load(); }
    finally { setBusy(false); }
  }

  async function deleteRole(id: string) {
    setBusy(true); setError("");
    try {
      const r = await fetch(`/api/servers/${serverId}/roles/${id}`, { method: "DELETE" });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || "Couldn't delete"); }
      if (selectedId === id) setSelectedId(null);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setBusy(false); }
  }

  function togglePerm(p: PermKey) {
    const next = perms.includes(p) ? perms.filter((x) => x !== p) : [...perms, p];
    patchRole({ permissions: next });
  }

  return (
    <div className="flex gap-3 h-80">
      {/* Role list */}
      <div className="w-40 shrink-0 flex flex-col border-r border-[var(--accent-2)]/20 pr-3">
        <div className="flex-1 overflow-y-auto space-y-1">
          {roles.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelectedId(r.id)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left transition-colors ${
                selectedId === r.id ? "bg-[var(--panel-2)] text-[var(--text)]" : "text-[var(--muted)] hover:bg-[var(--panel-2)]/50"
              }`}
            >
              <span className="w-3 h-3 rounded-full shrink-0" style={{ background: r.color }} />
              <span className="truncate">{r.name}</span>
            </button>
          ))}
        </div>
        {canManage && (
          <div className="pt-2 border-t border-[var(--accent-2)]/20 mt-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") createRole(); }}
              placeholder="New role…"
              className="w-full text-xs px-2 py-1 bg-[var(--panel-2)] border border-[var(--accent-2)]/30 rounded text-[var(--text)] focus:outline-none"
            />
            <button onClick={createRole} disabled={busy || !newName.trim()} className="w-full mt-1 text-xs py-1 bg-[var(--accent-2)]/30 text-[var(--text)] rounded hover:bg-[var(--accent-2)]/50 disabled:opacity-40">
              + Create
            </button>
          </div>
        )}
      </div>

      {/* Editor */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {error && <div className="mb-2 px-2 py-1 bg-red-500/10 text-red-400 text-xs rounded">{error}</div>}
        {!role ? (
          <div className="h-full flex items-center justify-center text-[var(--muted)] text-sm">Select a role to edit</div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={role.color}
                disabled={!canManage}
                onChange={(e) => patchRole({ color: e.target.value })}
                className="w-8 h-8 rounded bg-transparent border border-[var(--accent-2)]/30 cursor-pointer"
                title="Role color"
              />
              <input
                value={role.name}
                disabled={!canManage}
                onChange={(e) => setRoles((rs) => rs.map((r) => (r.id === role.id ? { ...r, name: e.target.value } : r)))}
                onBlur={(e) => { if (e.target.value.trim() && e.target.value !== role.name) patchRole({ name: e.target.value.trim() }); }}
                className="flex-1 text-sm px-2 py-1.5 bg-[var(--panel-2)] border border-[var(--accent-2)]/30 rounded text-[var(--text)] focus:outline-none"
              />
              {canManage && !role.isDefault && (
                <button onClick={() => deleteRole(role.id)} className="text-xs px-2 py-1.5 text-red-400 hover:bg-red-500/10 rounded" title="Delete role">Delete</button>
              )}
            </div>
            {role.isDefault && <p className="text-[10px] text-[var(--muted)]">This is the base role given to everyone — it can&apos;t be deleted.</p>}

            <div>
              <p className="text-xs font-semibold text-[var(--muted)] mb-1.5 uppercase tracking-wide">Permissions</p>
              <div className="space-y-1">
                {PERM_KEYS.map((p) => (
                  <label key={p} className={`flex items-start gap-2 px-2 py-1.5 rounded ${canManage ? "hover:bg-[var(--panel-2)]/40 cursor-pointer" : "opacity-70"}`}>
                    <input
                      type="checkbox"
                      checked={perms.includes(p)}
                      disabled={!canManage}
                      onChange={() => togglePerm(p)}
                      className="mt-0.5 accent-[var(--accent)]"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm text-[var(--text)]">{PERMISSIONS[p]}</span>
                      <span className="block text-[10px] text-[var(--muted)]">{PERMISSION_DESCRIPTIONS[p]}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
