"use client";

import { useState, useEffect } from "react";

export interface RuntimeConfig {
  appUrl: string;
  socketUrl: string;
  socketPath: string;
  turnUrl: string;
  turnUsername: string;
  turnCredential: string;
  sfuAvailable: boolean;
}

const DEFAULT_CONFIG: RuntimeConfig = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL || "",
  socketUrl: process.env.NEXT_PUBLIC_SOCKET_URL || "",
  socketPath: process.env.NEXT_PUBLIC_SOCKET_PATH || "/api/socketio",
  turnUrl: "",
  turnUsername: "",
  turnCredential: "",
  sfuAvailable: false,
};

let cachedConfig: RuntimeConfig | null = null;
let fetchPromise: Promise<RuntimeConfig> | null = null;

async function fetchConfig(): Promise<RuntimeConfig> {
  try {
    const res = await fetch("/api/config");
    if (!res.ok) {
      fetchPromise = null; // let a later caller retry instead of pinning defaults
      return DEFAULT_CONFIG;
    }
    const data = await res.json();
    cachedConfig = data;
    return data;
  } catch {
    fetchPromise = null;
    return DEFAULT_CONFIG;
  }
}

export function getRuntimeConfig(): RuntimeConfig | null {
  return cachedConfig;
}

/**
 * Fetch-and-cache the runtime config (deduped across callers). Call this
 * before code that reads getRuntimeConfig() synchronously — e.g. on voice-UI
 * mount, so ICE servers include the TURN relay by the time a peer connection
 * is created. Without a warm-up call, cachedConfig stays null forever and
 * TURN silently never applies.
 */
export function ensureRuntimeConfig(): Promise<RuntimeConfig> {
  if (cachedConfig) return Promise.resolve(cachedConfig);
  if (!fetchPromise) fetchPromise = fetchConfig();
  return fetchPromise;
}

export function useRuntimeConfig(): RuntimeConfig | null {
  const [config, setConfig] = useState<RuntimeConfig | null>(cachedConfig);

  useEffect(() => {
    let active = true;
    void ensureRuntimeConfig().then((nextConfig) => {
      if (active) setConfig(nextConfig);
    });
    return () => { active = false; };
  }, []);

  return config;
}
