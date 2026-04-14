"use client";

import { useState, useEffect, useRef } from "react";

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
}

export default function ServerSettingsModal({
  open,
  serverId,
  serverName,
  serverDescription,
  serverIcon,
  serverBanner,
  isPublic: initialPublic,
  welcomeMessage: initialWelcome,
  onClose,
  onUpdated,
}: ServerSettingsModalProps) {
  const [tab, setTab] = useState<"general" | "welcome" | "danger">("general");
  const [name, setName] = useState(serverName);
  const [description, setDescription] = useState(serverDescription ?? "");
  const [isPublic, setIsPublic] = useState(initialPublic ?? false);
  const [welcomeMsg, setWelcomeMsg] = useState(initialWelcome ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [iconPreview, setIconPreview] = useState(serverIcon ?? "");
  const [bannerPreview, setBannerPreview] = useState(serverBanner ?? "");
  const iconInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName(serverName);
    setDescription(serverDescription ?? "");
    setIsPublic(initialPublic ?? false);
    setWelcomeMsg(initialWelcome ?? "");
    setIconPreview(serverIcon ?? "");
    setBannerPreview(serverBanner ?? "");
    setTab("general");
    setError("");
    setSuccess("");
  }, [open, serverName, serverDescription, serverIcon, serverBanner, initialPublic, initialWelcome]);

  if (!open) return null;

  async function uploadImage(file: File): Promise<string | null> {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: formData });
    if (!res.ok) return null;
    const data = await res.json();
    return data.url;
  }

  async function handleIconUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setError("Icon must be under 2MB"); return; }
    const url = await uploadImage(file);
    if (url) setIconPreview(url);
    else setError("Upload failed");
  }

  async function handleBannerUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError("Banner must be under 5MB"); return; }
    const url = await uploadImage(file);
    if (url) setBannerPreview(url);
    else setError("Upload failed");
  }

  async function handleSave() {
    if (!name.trim()) { setError("Server name is required"); return; }
    setSaving(true);
    setError("");
    setSuccess("");

    const body: Record<string, unknown> = { name: name.trim(), description: description.trim(), isPublic };
    if (iconPreview !== (serverIcon ?? "")) body.icon = iconPreview;
    if (bannerPreview !== (serverBanner ?? "")) body.banner = bannerPreview;

    const res = await fetch(`/api/servers/${serverId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      setSuccess("Settings saved!");
      onUpdated(body as { name?: string; description?: string; icon?: string; banner?: string; isPublic?: boolean });
      setTimeout(() => setSuccess(""), 2000);
    } else {
      const data = await res.json().catch(() => ({}));
      setError((data as { error?: string }).error || "Failed to save");
    }
    setSaving(false);
  }

  async function handleSaveWelcome() {
    setSaving(true);
    setError("");
    setSuccess("");

    const res = await fetch(`/api/servers/${serverId}/welcome`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ welcomeMessage: welcomeMsg.trim() }),
    });

    if (res.ok) {
      setSuccess("Welcome message saved!");
      onUpdated({ welcomeMessage: welcomeMsg.trim() });
      setTimeout(() => setSuccess(""), 2000);
    } else {
      setError("Failed to save welcome message");
    }
    setSaving(false);
  }

  const TABS = [
    { id: "general" as const, label: "General" },
    { id: "welcome" as const, label: "Welcome" },
    { id: "danger" as const, label: "Danger Zone" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-xl bg-[var(--panel)] rounded-xl border border-[var(--accent-2)]/30 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--accent-2)]/20">
          <h2 className="text-lg font-bold text-[var(--text)]">Server Settings</h2>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--text)] text-xl leading-none">&times;</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--accent-2)]/20 px-5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setError(""); setSuccess(""); }}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
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
        {error && <div className="mx-5 mt-3 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-sm">{error}</div>}
        {success && <div className="mx-5 mt-3 px-3 py-2 bg-green-500/10 border border-green-500/30 rounded text-green-400 text-sm">{success}</div>}

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
                    className="w-16 h-16 rounded-xl bg-[var(--panel-2)] border border-[var(--accent-2)]/30 flex items-center justify-center overflow-hidden hover:border-[var(--accent-2)] transition-colors"
                  >
                    {iconPreview ? (
                      <img src={iconPreview} alt="Icon" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-2xl font-bold text-[var(--muted)]">{name.charAt(0).toUpperCase()}</span>
                    )}
                  </button>
                  <input ref={iconInputRef} type="file" accept="image/*" onChange={handleIconUpload} className="hidden" />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-[var(--muted)] mb-1 block">Banner</label>
                  <button
                    onClick={() => bannerInputRef.current?.click()}
                    className="w-full h-16 rounded-lg bg-[var(--panel-2)] border border-[var(--accent-2)]/30 flex items-center justify-center overflow-hidden hover:border-[var(--accent-2)] transition-colors"
                  >
                    {bannerPreview ? (
                      <img src={bannerPreview} alt="Banner" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-xs text-[var(--muted)]">Click to upload banner</span>
                    )}
                  </button>
                  <input ref={bannerInputRef} type="file" accept="image/*" onChange={handleBannerUpload} className="hidden" />
                </div>
              </div>

              {/* Name */}
              <div>
                <label className="text-xs text-[var(--muted)] mb-1 block">Server Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                  className="w-full px-3 py-2 bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)]/30 rounded-lg focus:outline-none focus:border-[var(--accent-2)]"
                />
              </div>

              {/* Description */}
              <div>
                <label className="text-xs text-[var(--muted)] mb-1 block">Description</label>
                <textarea
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
                  className={`w-11 h-6 rounded-full transition-colors relative ${isPublic ? "bg-green-500" : "bg-[var(--accent-2)]/30"}`}
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
                <label className="text-xs text-[var(--muted)] mb-1 block">Welcome Message</label>
                <textarea
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

          {tab === "danger" && (
            <div className="border border-red-500/30 rounded-lg p-4 space-y-3">
              <h3 className="text-red-400 font-semibold">Danger Zone</h3>
              <p className="text-sm text-[var(--muted)]">
                These actions are permanent and cannot be undone.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    if (!confirm("Delete this server? This cannot be undone.")) return;
                    const res = await fetch(`/api/servers/${serverId}`, { method: "DELETE" });
                    if (res.ok) {
                      onClose();
                      window.location.reload();
                    }
                  }}
                  className="px-4 py-2 bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/30 transition-colors text-sm font-medium"
                >
                  Delete Server
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
