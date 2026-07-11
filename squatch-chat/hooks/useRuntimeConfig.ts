"use client";

import { useState, useEffect } from "react";

export interface RuntimeConfig {
  appUrl: string;
  socketUrl: string;
  socketPath: string;
  turnUrl: string;
  turnUsername: string;
  turnCredential: string;
}

const DEFAULT_CONFIG: RuntimeConfig = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL || "",
  socketUrl: process.env.NEXT_PUBLIC_SOCKET_URL || "",
  socketPath: process.env.NEXT_PUBLIC_SOCKET_PATH || "/api/socketio",
  turnUrl: "",
  turnUsername: "",
  turnCredential: "",
};

let cachedConfig: RuntimeConfig | null = null;
let fetchPromise: Promise<RuntimeConfig> | null = null;

async function fetchConfig(): Promise<RuntimeConfig> {
  try {
    const res = await fetch("/api/config");
    if (!res.ok) return DEFAULT_CONFIG;
    const data = await res.json();
    cachedConfig = data;
    return data;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function getRuntimeConfig(): RuntimeConfig | null {
  return cachedConfig;
}

export function useRuntimeConfig(): RuntimeConfig | null {
  const [config, setConfig] = useState<RuntimeConfig | null>(cachedConfig);

  useEffect(() => {
    if (cachedConfig) {
      setConfig(cachedConfig);
      return;
    }
    if (!fetchPromise) {
      fetchPromise = fetchConfig();
    }
    fetchPromise.then((c) => setConfig(c));
  }, []);

  return config;
}
