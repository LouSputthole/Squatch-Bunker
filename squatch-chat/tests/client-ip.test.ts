import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clientIp,
  clientNetwork,
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

describe("clientNetwork", () => {
  it("keeps IPv4 addresses and non-addresses as they are", () => {
    expect(clientNetwork("203.0.113.7")).toBe("203.0.113.7");
    expect(clientNetwork("unknown")).toBe("unknown");
  });

  it("groups an IPv6 /64 into one key, however the address is written", () => {
    const network = "2001:db8:1:2::/64";
    expect(clientNetwork("2001:db8:1:2:3:4:5:6")).toBe(network);
    expect(clientNetwork("2001:db8:1:2:ffff::1")).toBe(network);
    expect(clientNetwork("2001:0db8:0001:0002::")).toBe(network);
    expect(clientNetwork("2001:db8:1:3::1")).not.toBe(network);
  });

  it("expands :: before taking the prefix, so zero groups can't be rotated through", () => {
    expect(clientNetwork("2001:db8::1:2:3:4")).toBe("2001:db8:0:0::/64");
    expect(clientNetwork("2001:db8::5")).toBe("2001:db8:0:0::/64");
    expect(clientNetwork("::")).toBe("0:0:0:0::/64");
    expect(clientNetwork("64:ff9b::192.0.2.1")).toBe("64:ff9b:0:0::/64");
  });
});
