import { isIP } from "node:net";

/**
 * The unified server removes any caller-supplied value and replaces it with
 * the TCP peer address before handing the request to Next.js.
 */
export const DIRECT_CLIENT_IP_HEADER = "x-campfire-direct-client-ip";

function normalizeIp(value: string | null): string | null {
  if (!value) return null;
  let candidate = value.trim();
  if (!candidate) return null;

  if (candidate.startsWith("[") && candidate.includes("]")) {
    candidate = candidate.slice(1, candidate.indexOf("]"));
  } else {
    const ipv4WithPort = candidate.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
    if (ipv4WithPort) candidate = ipv4WithPort[1];
  }

  const zoneIndex = candidate.indexOf("%");
  if (zoneIndex !== -1) candidate = candidate.slice(0, zoneIndex);

  if (candidate.toLowerCase().startsWith("::ffff:")) {
    const mapped = candidate.slice(7);
    if (isIP(mapped) === 4) return mapped;
  }

  return isIP(candidate) ? candidate.toLowerCase() : null;
}

function configuredProxyHops(): number {
  const raw = process.env.CAMPFIRE_TRUST_PROXY_HOPS?.trim();
  if (!raw || !/^[1-9]\d*$/.test(raw)) return 0;
  const hops = Number(raw);
  return Number.isSafeInteger(hops) && hops <= 10 ? hops : 0;
}

/**
 * Resolve a limiter key without trusting caller-controlled forwarding headers.
 *
 * CAMPFIRE_TRUST_PROXY_HOPS is intentionally opt-in. When set, the deployment
 * must have exactly that many trusted reverse-proxy hops and the outermost
 * proxy must replace, rather than append to, inbound X-Forwarded-For.
 */
export function clientIp(request: Request): string {
  const trustedHops = configuredProxyHops();
  if (trustedHops > 0) {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
      const chain = forwarded.split(",").map((part) => normalizeIp(part));
      if (chain.length >= trustedHops && chain.every((part) => part !== null)) {
        return chain[chain.length - trustedHops] as string;
      }
    } else if (trustedHops === 1) {
      const realIp = normalizeIp(request.headers.get("x-real-ip"));
      if (realIp) return realIp;
    }
  }

  if (process.env.CAMPFIRE_UNIFIED_SERVER === "1") {
    const directIp = normalizeIp(request.headers.get(DIRECT_CLIENT_IP_HEADER));
    if (directIp) return directIp;
  }

  return "unknown";
}
