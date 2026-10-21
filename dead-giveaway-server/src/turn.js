// ICE servers for `turn:get`.
//
// Ported from squatch-chat lib/turnCredentials.ts: the same environment
// variables, the same URL validation and the same coturn REST credential
// (username "<expiryUnix>:<userId>", credential base64(HMAC-SHA1(secret,
// username)), expiry bucketed so repeat requests reuse one username).
// Campfire's legacy static-credential mode is not carried over.

import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';

export const STUN_URL = 'stun:stun.l.google.com:19302';
export const DEFAULT_TURN_CREDENTIAL_TTL_SECONDS = 15 * 60;
export const MIN_TURN_CREDENTIAL_TTL_SECONDS = 60;
export const MAX_TURN_CREDENTIAL_TTL_SECONDS = 60 * 60;
export const MAX_TURN_CREDENTIAL_BUCKET_SECONDS = 5 * 60;
export const MIN_TURN_AUTH_SECRET_LENGTH = 32;
export const MAX_TURN_URLS = 8;

export function resolveTurnCredentialTtlSeconds(rawTtl) {
  const parsed = Number.parseInt(rawTtl || '', 10);
  if (!Number.isFinite(parsed)) return DEFAULT_TURN_CREDENTIAL_TTL_SECONDS;
  return Math.min(MAX_TURN_CREDENTIAL_TTL_SECONDS, Math.max(MIN_TURN_CREDENTIAL_TTL_SECONDS, parsed));
}

const TURN_URI_PATTERN = /^(turns?):(\[[^\]]+\]|[^:?#[\]/@]+)(?::([0-9]+))?(?:\?transport=(udp|tcp))?$/;

function validHostname(host) {
  if (host.length > 253) return false;
  if (/^[0-9.]+$/.test(host)) return isIP(host) === 4;
  return host
    .split('.')
    .every((label) => label.length > 0 && label.length <= 63 && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label));
}

export function validateTurnUrl(url) {
  if (!url || /\s/.test(url)) throw new Error('TURN URLs must be non-empty and contain no whitespace.');
  const match = TURN_URI_PATTERN.exec(url);
  if (!match) {
    throw new Error(`Invalid TURN URL "${url}". Expected turn: or turns: with an optional port and transport=udp|tcp.`);
  }
  if (match[1] === 'turns' && match[4] === 'udp') {
    throw new Error(`Invalid secure TURN transport in "${url}"; turns: requires TCP.`);
  }
  const host = match[2];
  if (host.startsWith('[')) {
    if (isIP(host.slice(1, -1)) !== 6) throw new Error(`Invalid TURN URL host in "${url}".`);
  } else if (isIP(host) === 0 && !validHostname(host)) {
    throw new Error(`Invalid TURN URL host in "${url}".`);
  }
  if (match[3]) {
    const port = Number(match[3]);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`Invalid TURN URL port in "${url}".`);
  }
  return url;
}

export function resolveTurnUrls(env = process.env) {
  const serialized = env.TURN_URLS;
  if (serialized?.trim()) {
    let parsed;
    try {
      parsed = JSON.parse(serialized);
    } catch {
      throw new Error('TURN_URLS must be valid JSON.');
    }
    if (!Array.isArray(parsed)) throw new Error('TURN_URLS must be a JSON array.');
    if (parsed.length < 1 || parsed.length > MAX_TURN_URLS) {
      throw new Error(`TURN_URLS must contain between 1 and ${MAX_TURN_URLS} entries.`);
    }
    if (!parsed.every((v) => typeof v === 'string')) throw new Error('Every TURN_URLS entry must be a string.');
    const urls = parsed.map(validateTurnUrl);
    if (new Set(urls).size !== urls.length) throw new Error('TURN_URLS entries must be unique.');
    return urls;
  }
  if (env.TURN_URL?.trim()) return [validateTurnUrl(env.TURN_URL)];
  return [];
}

/**
 * { mode: 'disabled' } or { mode: 'ephemeral', urls, authSecret, ttlSeconds }.
 * Throws on malformed URLs or a short secret. A partial configuration (URLs
 * without a secret, or the reverse) throws under NODE_ENV=production and is
 * treated as disabled otherwise, exactly like Campfire.
 */
export function assertTurnConfiguration(env = process.env) {
  const urls = resolveTurnUrls(env);
  const authSecret = env.TURN_AUTH_SECRET || '';
  if (urls.length > 0 && authSecret) {
    if (authSecret.trim().length < MIN_TURN_AUTH_SECRET_LENGTH) {
      throw new Error(`TURN_AUTH_SECRET must contain at least ${MIN_TURN_AUTH_SECRET_LENGTH} characters of random data.`);
    }
    return { mode: 'ephemeral', urls, authSecret, ttlSeconds: resolveTurnCredentialTtlSeconds(env.TURN_CREDENTIAL_TTL_SECONDS) };
  }
  const partial = Boolean(urls.length > 0 || authSecret || env.TURN_CREDENTIAL_TTL_SECONDS);
  if (env.NODE_ENV === 'production' && partial) {
    throw new Error('Incomplete TURN configuration. Set TURN_URLS or TURN_URL with a strong TURN_AUTH_SECRET.');
  }
  return { mode: 'disabled', partial };
}

/** Mint a coturn TURN REST credential. The secret never leaves the server. */
export function mintTurnCredentials(authSecret, userId, { nowMs, ttlSeconds } = {}) {
  if (typeof authSecret !== 'string' || authSecret.trim().length < MIN_TURN_AUTH_SECRET_LENGTH) {
    throw new Error(`TURN_AUTH_SECRET must contain at least ${MIN_TURN_AUTH_SECRET_LENGTH} characters of random data.`);
  }
  const nowSeconds = Math.floor((nowMs ?? Date.now()) / 1000);
  const ttl = Math.min(
    MAX_TURN_CREDENTIAL_TTL_SECONDS,
    Math.max(MIN_TURN_CREDENTIAL_TTL_SECONDS, ttlSeconds ?? DEFAULT_TURN_CREDENTIAL_TTL_SECONDS),
  );
  // Stable expiry buckets stop repeated requests minting a fresh coturn
  // username each time and slipping past coturn's user-quota.
  const bucketSeconds = Math.min(MAX_TURN_CREDENTIAL_BUCKET_SECONDS, Math.max(1, Math.floor(ttl / 4)));
  const expiryUnix = Math.floor((nowSeconds + ttl) / bucketSeconds) * bucketSeconds;
  const username = `${expiryUnix}:${userId}`;
  return {
    username,
    credential: createHmac('sha1', authSecret).update(username).digest('base64'),
    expiresAt: expiryUnix * 1000,
  };
}

/**
 * The `turn:get` ack body for one player.
 * @returns {{ iceServers: Array<{urls, username?, credential?}>, expiresAt: number|null }}
 */
export function iceServersFor(config, userId, nowMs = Date.now()) {
  const iceServers = [{ urls: STUN_URL }];
  if (!config || config.mode !== 'ephemeral') return { iceServers, expiresAt: null };
  const cred = mintTurnCredentials(config.authSecret, userId, { nowMs, ttlSeconds: config.ttlSeconds });
  iceServers.push({ urls: config.urls.slice(), username: cred.username, credential: cred.credential });
  return { iceServers, expiresAt: cred.expiresAt };
}
