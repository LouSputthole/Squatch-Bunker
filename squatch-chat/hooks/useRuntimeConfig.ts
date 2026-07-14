"use client";

import { useState, useEffect } from "react";

export interface RuntimeConfig {
  appUrl: string;
  socketUrl: string;
  socketPath: string;
  turnUrls: string[];
  turnUrl: string;
  turnUsername: string;
  turnCredential: string;
  /** Unix epoch milliseconds; null for no TURN or explicit legacy static credentials. */
  turnExpiresAt: number | null;
  sfuAvailable: boolean;
}

const DEFAULT_CONFIG: RuntimeConfig = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL || "",
  socketUrl: process.env.NEXT_PUBLIC_SOCKET_URL || "",
  socketPath: process.env.NEXT_PUBLIC_SOCKET_PATH || "/api/socketio",
  turnUrls: [],
  turnUrl: "",
  turnUsername: "",
  turnCredential: "",
  turnExpiresAt: null,
  sfuAvailable: false,
};

export const TURN_REFRESH_SKEW_MS = 30_000;
export const TURN_REFRESH_RETRY_MS = 5_000;

let cachedConfig: RuntimeConfig | null = null;
let fetchPromise: Promise<RuntimeConfig> | null = null;
let cacheGeneration = 0;

function normalizeConfig(data: Partial<RuntimeConfig>): RuntimeConfig {
  const turnUrls = Array.isArray(data.turnUrls)
    && data.turnUrls.length > 0
    && data.turnUrls.every((url) => typeof url === "string" && url.length > 0)
    ? [...data.turnUrls]
    : typeof data.turnUrl === "string" && data.turnUrl.length > 0
      ? [data.turnUrl]
      : [];

  return {
    ...DEFAULT_CONFIG,
    ...data,
    turnUrls,
    turnUrl: turnUrls[0] || "",
    turnExpiresAt: typeof data.turnExpiresAt === "number"
      && Number.isFinite(data.turnExpiresAt)
      ? data.turnExpiresAt
      : null,
  };
}

function withoutExpiredTurn(config: RuntimeConfig, nowMs: number): RuntimeConfig {
  if (!config.turnExpiresAt || config.turnExpiresAt > nowMs) return config;
  return {
    ...config,
    turnUrls: [],
    turnUrl: "",
    turnUsername: "",
    turnCredential: "",
    turnExpiresAt: null,
  };
}

export function hasFreshTurnCredentials(
  config: RuntimeConfig,
  nowMs = Date.now(),
  minValidityMs = TURN_REFRESH_SKEW_MS,
): boolean {
  if (!config.turnExpiresAt) return true;
  return config.turnExpiresAt > nowMs + Math.max(0, minValidityMs);
}

async function fetchConfig(generation: number): Promise<RuntimeConfig> {
  const res = await fetch("/api/config", {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!res.ok) throw new Error(`Runtime config request failed with ${res.status}`);
  const data = normalizeConfig(await res.json());
  if (generation !== cacheGeneration) return cachedConfig ?? DEFAULT_CONFIG;
  cachedConfig = data;
  return data;
}

function configAfterFetchFailure(nowMs: number, generation: number): RuntimeConfig {
  if (generation !== cacheGeneration) return cachedConfig ?? DEFAULT_CONFIG;
  if (!cachedConfig) return DEFAULT_CONFIG;
  return withoutExpiredTurn(cachedConfig, nowMs);
}

export interface EnsureRuntimeConfigOptions {
  forceRefresh?: boolean;
  minTurnValidityMs?: number;
}

export function invalidateRuntimeConfig(): void {
  cacheGeneration += 1;
  cachedConfig = null;
  fetchPromise = null;
}

export function getRuntimeConfig(): RuntimeConfig | null {
  if (!cachedConfig) return null;
  return withoutExpiredTurn(cachedConfig, Date.now());
}

/**
 * Fetch and cache runtime configuration. Concurrent refreshes are deduplicated,
 * expiring TURN credentials refresh before new peers, and invalidation prevents
 * a prior SPA session's in-flight response from repopulating the cache.
 */
export function ensureRuntimeConfig(
  options: EnsureRuntimeConfigOptions = {},
): Promise<RuntimeConfig> {
  const nowMs = Date.now();
  if (
    !options.forceRefresh
    && cachedConfig
    && hasFreshTurnCredentials(
      cachedConfig,
      nowMs,
      options.minTurnValidityMs ?? TURN_REFRESH_SKEW_MS,
    )
  ) {
    return Promise.resolve(cachedConfig);
  }

  if (!fetchPromise) {
    const generation = cacheGeneration;
    const request = fetchConfig(generation)
      .catch(() => configAfterFetchFailure(nowMs, generation));
    fetchPromise = request;
    void request.finally(() => {
      if (fetchPromise === request) fetchPromise = null;
    });
  }
  return fetchPromise;
}

export function useRuntimeConfig(): RuntimeConfig | null {
  const [config, setConfig] = useState<RuntimeConfig | null>(cachedConfig);

  useEffect(() => {
    let active = true;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    const update = async (forceRefresh = false) => {
      const nextConfig = await ensureRuntimeConfig({ forceRefresh });
      if (!active) return;
      setConfig(nextConfig);

      if (nextConfig.turnExpiresAt) {
        const refreshInMs = Math.max(
          TURN_REFRESH_RETRY_MS,
          nextConfig.turnExpiresAt - Date.now() - TURN_REFRESH_SKEW_MS,
        );
        refreshTimer = setTimeout(() => { void update(true); }, refreshInMs);
      }
    };

    void update();
    return () => {
      active = false;
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, []);

  return config;
}
