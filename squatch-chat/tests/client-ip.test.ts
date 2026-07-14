import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clientIp,
  DIRECT_CLIENT_IP_HEADER,
} from "@/lib/clientIp";

const originalProxyHops = process.env.CAMPFIRE_TRUST_PROXY_HOPS;
const originalUnifiedServer = process.env.CAMPFIRE_UNIFIED_SERVER;

function request(headers: Record<string, string>): Request {
  return new Request("http://test.local", { headers });
}

beforeEach(() => {
  delete process.env.CAMPFIRE_TRUST_PROXY_HOPS;
  delete process.env.CAMPFIRE_UNIFIED_SERVER;
});

afterEach(() => {
  if (originalProxyHops === undefined) {
    delete process.env.CAMPFIRE_TRUST_PROXY_HOPS;
  } else {
    process.env.CAMPFIRE_TRUST_PROXY_HOPS = originalProxyHops;
  }
  if (originalUnifiedServer === undefined) {
    delete process.env.CAMPFIRE_UNIFIED_SERVER;
  } else {
    process.env.CAMPFIRE_UNIFIED_SERVER = originalUnifiedServer;
  }
});

describe("clientIp", () => {
  it("ignores caller-controlled forwarding and direct-IP headers by default", () => {
    expect(clientIp(request({
      "x-forwarded-for": "198.51.100.10",
      "x-real-ip": "198.51.100.11",
      [DIRECT_CLIENT_IP_HEADER]: "198.51.100.12",
    }))).toBe("unknown");
  });

  it("trusts only the direct address overwritten by the unified server", () => {
    process.env.CAMPFIRE_UNIFIED_SERVER = "1";
    expect(clientIp(request({
      "x-forwarded-for": "198.51.100.10",
      [DIRECT_CLIENT_IP_HEADER]: "::ffff:192.0.2.9",
    }))).toBe("192.0.2.9");
  });

  it("selects the client address before the configured trusted proxy hops", () => {
    process.env.CAMPFIRE_TRUST_PROXY_HOPS = "2";
    expect(clientIp(request({
      "x-forwarded-for": "203.0.113.7, 198.51.100.4",
    }))).toBe("203.0.113.7");
  });

  it("accepts X-Real-IP only for an explicitly trusted single proxy", () => {
    process.env.CAMPFIRE_TRUST_PROXY_HOPS = "1";
    expect(clientIp(request({
      "x-real-ip": "203.0.113.19",
    }))).toBe("203.0.113.19");
  });

  it("fails closed on malformed or undersized forwarding chains", () => {
    process.env.CAMPFIRE_TRUST_PROXY_HOPS = "2";
    expect(clientIp(request({
      "x-forwarded-for": "spoofed, 198.51.100.4",
    }))).toBe("unknown");
    expect(clientIp(request({
      "x-forwarded-for": "203.0.113.7",
    }))).toBe("unknown");
  });
});
