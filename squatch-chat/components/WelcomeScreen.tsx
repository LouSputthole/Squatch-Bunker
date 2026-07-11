"use client";
import { useState, useEffect } from "react";

interface Props {
  serverId: string;
  serverName: string;
  serverIcon?: string | null;
  onDismiss: () => void;
}

export function WelcomeScreen({ serverId, serverName, serverIcon, onDismiss }: Props) {
  const [welcome, setWelcome] = useState<{ welcomeMessage?: string | null; welcomeChannelIds?: string | null } | null>(null);

  useEffect(() => {
    fetch(`/api/servers/${serverId}/welcome`).then(r => r.json()).then(d => setWelcome(d.welcome));
  }, [serverId]);

  if (!welcome?.welcomeMessage) return null;

  const channelIds: string[] = (() => {
    try { return JSON.parse(welcome.welcomeChannelIds ?? "[]"); } catch { return []; }
  })();

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--panel)] rounded-2xl shadow-2xl w-full max-w-lg p-8 text-center">
        <div className="w-20 h-20 rounded-2xl bg-[var(--panel-2)] flex items-center justify-center text-3xl font-bold mx-auto mb-4 overflow-hidden">
          {serverIcon
            ? <img src={serverIcon} alt={serverName} className="w-full h-full object-cover" />
            : serverName[0]?.toUpperCase()
          }
        </div>
        <h1 className="text-2xl font-bold text-[var(--text)] mb-1">Welcome to {serverName}!</h1>
        <p className="text-[var(--muted)] text-sm mb-6 whitespace-pre-wrap leading-relaxed">
          {welcome.welcomeMessage}
        </p>
        {channelIds.length > 0 && (
          <p className="text-xs text-[var(--muted)] mb-4">
            Check out {channelIds.length} highlighted {channelIds.length === 1 ? "channel" : "channels"} to get started.
          </p>
        )}
        <button
          onClick={onDismiss}
          className="px-6 py-2.5 bg-[var(--accent-2)] text-[var(--text)] rounded-lg hover:bg-[var(--accent)] transition-colors font-medium"
        >
          Get Started
        </button>
      </div>
    </div>
  );
}
