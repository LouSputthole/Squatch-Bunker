import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";

export class PreviewFetchError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "PreviewFetchError";
  }
}

export interface SafePreviewTarget {
  url: URL;
  address: string;
  family: 4 | 6;
}

interface SafePreviewRequestInit {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

const blocked = new BlockList();

for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(address, prefix, "ipv4");
}

for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(address, prefix, "ipv6");
}

export function isPublicAddress(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, "");
  if (normalized.toLowerCase().startsWith("::ffff:")) return false;
  const family = isIP(normalized);
  if (family === 4) return !blocked.check(normalized, "ipv4");
  if (family === 6) return !blocked.check(normalized, "ipv6");
  return false;
}

export function assertSafePreviewUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new PreviewFetchError("Invalid URL", 400);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PreviewFetchError("Invalid URL", 400);
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname) && !isPublicAddress(hostname)) {
    throw new PreviewFetchError("Target is not allowed", 403);
  }
  return url;
}

export async function assertSafePreviewTarget(rawUrl: string): Promise<SafePreviewTarget> {
  const url = assertSafePreviewUrl(rawUrl);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const literalFamily = isIP(hostname);
  if (literalFamily) {
    return { url, address: hostname, family: literalFamily as 4 | 6 };
  }

  let addresses: LookupAddress[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new PreviewFetchError("Target could not be resolved", 502);
  }
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new PreviewFetchError("Target is not allowed", 403);
  }
  const [selected] = addresses;
  return {
    url,
    address: selected.address,
    family: selected.family as 4 | 6,
  };
}

export function fetchSafePreviewTarget(
  target: SafePreviewTarget,
  init: SafePreviewRequestInit = {},
): Promise<Response> {
  const pinnedLookup: LookupFunction = (_hostname, _options, callback) => {
    callback(null, target.address, target.family);
  };

  return new Promise((resolve, reject) => {
    // A fresh socket guarantees this vetted lookup is used. Passing the
    // original URL keeps its hostname as the HTTP Host and HTTPS TLS SNI.
    const transport = target.url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = transport(
      target.url,
      {
        headers: init.headers,
        agent: false,
        lookup: pinnedLookup,
        signal: init.signal,
      },
      (incoming) => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) {
            for (const item of value) headers.append(name, item);
          } else if (value !== undefined) {
            headers.set(name, value);
          }
        }

        const status = incoming.statusCode ?? 502;
        const hasBody = status !== 204 && status !== 205 && status !== 304;
        const body = hasBody
          ? (Readable.toWeb(incoming) as unknown as ReadableStream<Uint8Array>)
          : null;
        resolve(
          new Response(body, {
            headers,
            status,
            statusText: incoming.statusMessage,
          }),
        );
      },
    );
    request.once("error", reject);
    request.end();
  });
}
