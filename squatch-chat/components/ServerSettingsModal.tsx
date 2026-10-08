"use client";

import Image from "next/image";
import { useState, useRef } from "react";
import RolesManager from "@/components/RolesManager";
import PromptDialog from "@/components/PromptDialog";
import { useEscape } from "@/hooks/useEscape";
import { toast, toastResponseError } from "@/lib/toast";

type SavedSettings = { description?: string; isPublic?: boolean; welcomeMessage?: string };

interface ServerSettingsModalProps {
  open: boolean;
  serverId: string;
  serverName: string;
  serverDescription?: string | null;
  serverIcon?: string | null;
  serverBanner?: string | null;
  isPublic?: boolean;
  welcomeMessage?: string | null;
  onClose: () => void;
  onUpdated: (updates: { name?: string; description?: string; icon?: string; banner?: string; isPublic?: boolean; welcomeMessage?: string }) => void;
  /** Called after the server is deleted. Without it the page reloads. */
  onDeleted?: () => void;
  hasActiveChannel?: boolean;
  onOpenModeration?: () => void;
  onOpenEmoji?: () => void;
  onOpenAutoMod?: () => void;
  onOpenAudit?: () => void;
  onOpenPurge?: () => void;
  onOpenChannelPerms?: () => void;
}

export default function ServerSettingsModal({
  ...props
}: ServerSettingsModalProps) {
  // Values saved from this modal, so reopening it shows what was just saved
  // even if the parent's copy of the server hasn't been refreshed yet.
  const [saved, setSaved] = useState<{ serverId: string; values: SavedSettings } | null>(null);
  if (!props.open) return null;

  const overrides = saved?.serverId === props.serverId ? saved.values : {};
  const merged: ServerSettingsModalProps = {
    ...props,
    serverDescription: overrides.description ?? props.serverDescription,
    isPublic: overrides.isPublic ?? props.isPublic,
    welcomeMessage: overrides.welcomeMessage ?? props.welcomeMessage,
    onUpdated: (updates) => {
      const values: SavedSettings = {};
      if (updates.description !== undefined) values.description = updates.description;
      if (updates.isPublic !== undefined) values.isPublic = updates.isPublic;
      if (updates.welcomeMessage !== undefined) values.welcomeMessage = updates.welcomeMessage;
      setSaved((current) => ({
        serverId: props.serverId,
        values: { ...(current?.serverId === props.serverId ? current.values : {}), ...values },
      }));
      props.onUpdated(updates);
    },
  };

  const resetKey = JSON.stringify([
    props.serverId,
    props.serverName,
    props.serverIcon ?? null,
    props.serverBanner ?? null,
  ]);

  return <ServerSettingsContent key={resetKey} {...merged} />;
}

function ServerSettingsContent({
  serverId,
  serverName,
  serverDescription,
  serverIcon,
  serverBanner,
  isPublic: initialPublic,
  welcomeMessage: initialWelcome,
  onClose,
  onUpdated,
  onDeleted,
  hasActiveChannel,
  onOpenModeration,
  onOpenEmoji,
  onOpenAutoMod,
  onOpenAudit,
  onOpenPurge,
  onOpenChannelPerms,
}: ServerSettingsModalProps) {
  const [tab, setTab] = useState<"general" | "welcome" | "roles" | "tools" | "danger">("general");
  const [name, setName] = useState(serverName);
  const [description, setDescription] = useState(serverDescription ?? "");
  const [isPublic, setIsPublic] = useState(initialPublic ?? false);
  const [welcomeMsg, setWelcomeMsg] = useState(initialWelcome ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [iconPreview, setIconPreview] = useState(serverIcon ?? "");
  const [bannerPreview, setBannerPreview] = useState(serverBanner ?? "");
  const iconInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  useEscape(onClose, !confirmDelete);

  async function errorMessage(res: Response, fallback: string): Promise<string> {
    const data = await res.json().catch(() => ({}));
    return (data as { error?: string }).error || fallback;
  }

  async function uploadImage(file: File): Promise<string | null> {
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) {
        setError(await errorMessage(res, "Upload failed"));
        return null;
      }
      const data = await res.json();
      return data.url;
    } catch {
      setError("Upload failed");
      return null;
    }
  }

  async function handleIconUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    if (file.size > 2 * 1024 * 1024) { setError("Icon must be under 2MB"); return; }
    const url = await uploadImage(file);
    if (url) setIconPreview(url);
  }

  async function handleBannerUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    if (file.size > 5 * 1024 * 1024) { setError("Banner must be under 5MB"); return; }
    const url = await uploadImage(file);
    if (url) setBannerPreview(url);
  }

  async function handleSave() {
    if (!name.trim()) { setError("Server name is required"); return; }
    setSaving(true);
    setError("");

    const body: Record<string, unknown> = { name: name.trim(), description: description.trim(), isPublic };
    if (iconPreview !== (serverIcon ?? "")) body.icon = iconPreview;
    if (bannerPreview !== (serverBanner ?? "")) body.banner = bannerPreview;

    try {
      const res = await fetch(`/api/servers/${serverId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        toast("Server settings saved", "success");
        onUpdated(body as { name?: string; description?: string; icon?: string; banner?: string; isPublic?: boolean });
      } else {
        setError(await errorMessage(res, "Failed to save"));
      }
    } catch {
      setError("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveWelcome() {
    setSaving(true);
    setError("");

    try {
      const res = await fetch(`/api/servers/${serverId}/welcome`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ welcomeMessage: welcomeMsg.trim() }),
      });
      if (res.ok) {
        toast("Welcome message saved", "success");
        onUpdated({ welcomeMessage: welcomeMsg.trim() });
      } else {
        setError(await errorMessage(res, "Failed to save welcome message"));
      }
    } catch {
      setError("Failed to save welcome message");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteServer() {
    try {
      const res = await fetch(`/api/servers/${serverId}`, { method: "DELETE" });
      if (!res.ok) {
        await toastResponseError(res, "Failed to delete server");
        return;
      }
    } catch {
      toast("Failed to delete server", "error");
      return;
    }
    setConfirmDelete(false);
    toast(`Deleted ${serverName}`, "success");
    onClose();
    if (onDeleted) onDeleted();
    else window.location.reload();
  }

  const TABS = [
    { id: "general" as const, label: "General" },
    { id: "welcome" as const, label: "Welcome" },
    { id: "roles" as const, label: "Roles" },
    { id: "tools" as const, label: "Tools" },
    { id: "danger" as const, label: "Danger Zone" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="server-settings-title"
        className="w-full max-w-xl bg-[var(--panel)] rounded-xl border border-[var(--accent-2)]/30 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--accent-2)]/20">
          <h2 id="server-settings-title" className="text-lg font-bold text-[var(--text)]">Server Settings</h2>
          <button
            onClick={onClose}
            autoFocus
            aria-label="Close server settings"
            className="text-[var(--muted)] hover:text-[var(--text)] text-xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--accent-2)]/20 px-5 overflow-x-auto" role="tablist" aria-label="Server settings sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => { setTab(t.id); setError(""); }}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                tab === t.id
                  ? "border-[var(--accent-2)] text-[var(--text)]"
                  : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Status messages */}
        {error && <div role="alert" className="mx-5 mt-3 px-3 py-2 bg-[var(--danger)]/10 border border-[var(--danger)]/40 rounded text-[var(--danger)] text-sm">{error}</div>}

        {/* Content */}
        <div className="p-5 space-y-4 max-h-96 overflow-y-auto">
          {tab === "general" && (
            <>
              {/* Icon + Banner */}
              <div className="flex items-start gap-4">
                <div>
                  <label className="text-xs text-[var(--muted)] mb-1 block">Icon</label>
                  <button
                    onClick={() => iconInputRef.current?.click()}
                    aria-label="Upload server icon"
                    className="relative w-16 h-16 rounded-xl bg-[var(--panel-2)] border border-[var(--accent-2)]/30 flex items-center justify-center overflow-hidden hover:border-[var(--accent-2)] transition-colors"
                  >
                    {iconPreview ? (
                      <Image
                        src={iconPreview}
                        alt="Icon"
                        fill
                        sizes="4rem"
                        className="object-cover"
                        unoptimized
                      />
                    ) : (
                      <span className="text-2xl font-bold text-[var(--muted)]">{name.charAt(0).toUpperCase()}</span>
                    )}
                  </button>
                  <input ref={iconInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={handleIconUpload} className="hidden" />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-[var(--muted)] mb-1 block">Banner</label>
                  <button
                    onClick={() => bannerInputRef.current?.click()}
                    aria-label="Upload server banner"
                    className="relative w-full h-16 rounded-lg bg-[var(--panel-2)] border border-[var(--accent-2)]/30 flex items-center justify-center overflow-hidden hover:border-[var(--accent-2)] transition-colors"
                  >
                    {bannerPreview ? (
                      <Image
                        src={bannerPreview}
                        alt="Banner"
                        fill
                        sizes="28rem"
                        className="object-cover"
                        unoptimized
                      />
                    ) : (
                      <span className="text-xs text-[var(--muted)]">Click to upload banner</span>
                    )}
                  </button>
                  <input ref={bannerInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={handleBannerUpload} className="hidden" />
                </div>
              </div>

              {/* Name */}
              <div>
                <label htmlFor="server-settings-name" className="text-xs text-[var(--muted)] mb-1 block">Server Name</label>
                <input
                  id="server-settings-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                  className="w-full px-3 py-2 bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)]/30 rounded-lg focus:outline-none focus:border-[var(--accent-2)]"
                />
              </div>

              {/* Description */}
              <div>
                <label htmlFor="server-settings-description" className="text-xs text-[var(--muted)] mb-1 block">Description</label>
                <textarea
                  id="server-settings-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="What's this server about?"
                  className="w-full px-3 py-2 bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)]/30 rounded-lg focus:outline-none focus:border-[var(--accent-2)] resize-none placeholder:text-[var(--muted)]"
                />
              </div>

              {/* Public toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-[var(--text)]">Public Server</div>
                  <div className="text-xs text-[var(--muted)]">Anyone can find and join this server</div>
                </div>
                <button
                  onClick={() => setIsPublic(!isPublic)}
                  role="switch"
                  aria-checked={isPublic}
                  aria-label="Public server"
                  className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${isPublic ? "bg-[var(--accent)]" : "bg-[var(--accent-2)]/30"}`}
                >
                  <div className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform ${isPublic ? "translate-x-[22px]" : "translate-x-0.5"}`} />
                </button>
              </div>

              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full py-2 bg-[var(--accent-2)] text-[var(--text)] rounded-lg hover:bg-[var(--accent)] hover:text-[var(--bg)] transition-colors font-medium disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </>
          )}

          {tab === "welcome" && (
            <>
              <div>
                <label htmlFor="server-settings-welcome" className="text-xs text-[var(--muted)] mb-1 block">Welcome Message</label>
                <textarea
                  id="server-settings-welcome"
                  value={welcomeMsg}
                  onChange={(e) => setWelcomeMsg(e.target.value)}
                  maxLength={1000}
                  rows={4}
                  placeholder="Welcome to our server! Check out #rules and say hi in #general."
                  className="w-full px-3 py-2 bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)]/30 rounded-lg focus:outline-none focus:border-[var(--accent-2)] resize-none placeholder:text-[var(--muted)]"
                />
                <p className="text-xs text-[var(--muted)] mt-1">Shown to new members when they join. Supports markdown.</p>
              </div>
              <button
                onClick={handleSaveWelcome}
                disabled={saving}
                className="w-full py-2 bg-[var(--accent-2)] text-[var(--text)] rounded-lg hover:bg-[var(--accent)] hover:text-[var(--bg)] transition-colors font-medium disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Welcome Message"}
              </button>
            </>
          )}

          {tab === "roles" && <RolesManager serverId={serverId} />}

          {tab === "tools" && (
            <div className="space-y-1.5">
              {([
                ["🛡️", "Moderation", "Mute, kick, ban, manage members", onOpenModeration],
                ["🤖", "Word Filter", "Block words in messages you send (this device)", onOpenAutoMod],
                ["😎", "Custom Emoji", "Add and remove server emoji", onOpenEmoji],
                ["📋", "Audit Log", "Review recent server actions", onOpenAudit],
              ] as const).map(([icon, label, desc, fn]) => (
                <button
                  key={label}
                  onClick={fn}
                  disabled={!fn}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-[var(--panel-2)] hover:bg-[var(--accent-2)]/20 text-left transition-colors disabled:opacity-40"
                >
                  <span className="text-xl shrink-0">{icon}</span>
                  <span className="min-w-0">
                    <span className="block text-sm text-[var(--text)]">{label}</span>
                    <span className="block text-[11px] text-[var(--muted)]">{desc}</span>
                  </span>
                </button>
              ))}
              {hasActiveChannel && (
                <>
                  <div className="text-[10px] text-[var(--muted)] uppercase tracking-wide pt-2">This channel</div>
                  {([
                    ["🔒", "Channel Permissions", "Who can view / send here", onOpenChannelPerms],
                    ["🗑️", "Purge Messages", "Bulk-delete messages here", onOpenPurge],
                  ] as const).map(([icon, label, desc, fn]) => (
                    <button
                      key={label}
                      onClick={fn}
                      disabled={!fn}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-[var(--panel-2)] hover:bg-[var(--accent-2)]/20 text-left transition-colors disabled:opacity-40"
                    >
                      <span className="text-xl shrink-0">{icon}</span>
                      <span className="min-w-0">
                        <span className="block text-sm text-[var(--text)]">{label}</span>
                        <span className="block text-[11px] text-[var(--muted)]">{desc}</span>
                      </span>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}

          {tab === "danger" && (
            <div className="border border-[var(--danger)]/40 rounded-lg p-4 space-y-3">
              <h3 className="text-[var(--danger)] font-semibold">Danger Zone</h3>
              <p className="text-sm text-[var(--muted)]">
                These actions are permanent and cannot be undone.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="px-4 py-2 bg-[var(--danger)]/15 text-[var(--danger)] border border-[var(--danger)]/40 rounded-lg hover:bg-[var(--danger)]/25 transition-colors text-sm font-medium"
                >
                  Delete Server
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      {confirmDelete && (
        <div onClick={(e) => e.stopPropagation()}>
          <PromptDialog
            title={`Delete ${serverName}?`}
            message="Every channel, message, and file in this server will be permanently deleted. This can't be undone."
            mode="confirm"
            confirmLabel="Delete server"
            destructive
            onConfirm={handleDeleteServer}
            onCancel={() => setConfirmDelete(false)}
          />
        </div>
      )}
    </div>
  );
}
