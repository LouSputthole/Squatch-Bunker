import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  createServer,
  type ClientRequest,
  type IncomingMessage,
  type RequestOptions,
  type Server,
} from "node:http";
import { Readable } from "node:stream";
import { NextRequest } from "next/server";

const authMock = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => authMock);
const dnsMock = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("node:dns/promises", () => dnsMock);
const transportMock = vi.hoisted(() => ({
  httpRequest: vi.fn(),
  httpsRequest: vi.fn(),
}));
vi.mock("node:http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:http")>();
  return { ...actual, request: transportMock.httpRequest };
});
vi.mock("node:https", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:https")>();
  return { ...actual, request: transportMock.httpsRequest };
});
import { GET } from "@/app/api/og-preview/route";

const SESSION = { userId: "preview-user", username: "preview_user" };
const servers = new Set<Server>();

function request(url: string) {
  return new NextRequest(
    `http://test.local/api/og-preview?url=${encodeURIComponent(url)}`,
  );
}

type TransportProtocol = "http" | "https";

interface MockTransportResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  onRead?: () => void;
}

function outboundFor(protocol: TransportProtocol) {
  return protocol === "https"
    ? transportMock.httpsRequest
    : transportMock.httpRequest;
}

function mockTransportResponse(
  response: MockTransportResponse,
  protocol: TransportProtocol = "https",
) {
  const outbound = outboundFor(protocol);
  outbound.mockImplementationOnce(
    (
      _url: URL,
      _options: RequestOptions,
      callback: (incoming: IncomingMessage) => void,
    ) => {
      const bytes =
        typeof response.body === "string"
          ? Buffer.from(response.body)
          : response.body ?? new Uint8Array();
      const respond = () => {
        let sent = false;
        const incoming = new Readable({
          read() {
            response.onRead?.();
            if (sent) return;
            sent = true;
            if (bytes.byteLength > 0) this.push(bytes);
            this.push(null);
          },
        }) as IncomingMessage;
        incoming.statusCode = response.status ?? 200;
        incoming.statusMessage = "OK";
        incoming.headers = response.headers ?? {};
        callback(incoming);
      };

      return Object.assign(new EventEmitter(), {
        end: vi.fn(respond),
      }) as unknown as ClientRequest;
    },
  );
  return outbound;
}

function mockTransportError(
  error: Error,
  protocol: TransportProtocol = "https",
) {
  const outbound = outboundFor(protocol);
  outbound.mockImplementationOnce(
    () => {
      const request = new EventEmitter();
      return Object.assign(request, {
        end: vi.fn(() => request.emit("error", error)),
      }) as unknown as ClientRequest;
    },
  );
  return outbound;
}

beforeEach(() => {
  authMock.getSession.mockReset();
  authMock.getSession.mockResolvedValue(SESSION);
  vi.unstubAllGlobals();
  dnsMock.lookup.mockReset();
  dnsMock.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  transportMock.httpRequest.mockReset();
  transportMock.httpsRequest.mockReset();
});

afterEach(async () => {
  await Promise.all(
    [...servers].map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
  servers.clear();
});
describe("GET /api/og-preview", () => {
  it("rejects unauthenticated callers before making an outbound request", async () => {
    authMock.getSession.mockResolvedValue(null);

    const response = await GET(request("https://example.test/page"));

    expect(response.status).toBe(401);
    expect(transportMock.httpsRequest).not.toHaveBeenCalled();
    expect(transportMock.httpRequest).not.toHaveBeenCalled();
  });

  it.each([
    "http://127.0.0.1/admin",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.5/internal",
    "http://[::1]/admin",
  ])("blocks private, loopback, and link-local targets: %s", async (url) => {
    expect((await GET(request(url))).status).toBe(403);
    expect(transportMock.httpRequest).not.toHaveBeenCalled();
  });

  it("blocks hostnames when DNS resolves to a private address", async () => {
    dnsMock.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);

    const response = await GET(request("https://community.example.test/page"));
    expect(response.status).toBe(403);
    expect(transportMock.httpsRequest).not.toHaveBeenCalled();
  });

  it("revalidates each redirect before opening its connection", async () => {
    dnsMock.lookup
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    const outbound = mockTransportResponse({
      status: 302,
      headers: { location: "https://redirect.example.test/internal" },
    });

    const response = await GET(request("https://community.example.test/page"));

    expect(response.status).toBe(403);
    expect(outbound).toHaveBeenCalledTimes(1);
    expect(dnsMock.lookup).toHaveBeenCalledTimes(2);
  });

  it("rejects non-HTML responses before parsing their body", async () => {
    const onRead = vi.fn();
    mockTransportResponse({
      headers: { "content-type": "application/json" },
      body: "{\"secret\":true}",
      onRead,
    });

    expect((await GET(request("https://community.example.test/data"))).status).toBe(415);
    expect(onRead).not.toHaveBeenCalled();
  });

  it("rejects an oversized declared HTML body before buffering it", async () => {
    const onRead = vi.fn();
    mockTransportResponse({
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-length": String(1024 * 1024 + 1),
      },
      body: "<title>too large</title>",
      onRead,
    });

    expect((await GET(request("https://community.example.test/huge"))).status).toBe(413);
    expect(onRead).not.toHaveBeenCalled();
  });

  it("stops reading a chunked HTML body once it crosses the byte cap", async () => {
    mockTransportResponse({
      headers: { "content-type": "text/html; charset=utf-8" },
      body: "<!doctype html>" + "x".repeat(1024 * 1024),
    });

    expect((await GET(request("https://community.example.test/chunked"))).status).toBe(413);
  });

  it("reports outbound timeouts without retrying", async () => {
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const outbound = mockTransportError(timeout);

    expect((await GET(request("https://community.example.test/slow"))).status).toBe(504);
    expect(outbound).toHaveBeenCalledTimes(1);
  });

  it("rejects non-HTTP schemes without an outbound request", async () => {
    expect((await GET(request("file:///etc/passwd"))).status).toBe(400);
    expect(transportMock.httpsRequest).not.toHaveBeenCalled();
    expect(transportMock.httpRequest).not.toHaveBeenCalled();
  });

  it("returns metadata for a bounded public HTML response", async () => {
    const outbound = mockTransportResponse({
      headers: { "content-type": "text/html; charset=utf-8" },
      body: '<html><head><meta property="og:title" content="Campfire page"><meta property="og:description" content="A warm place"></head></html>',
    });

    const response = await GET(request("https://community.example.test/page"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      title: "Campfire page",
      description: "A warm place",
      url: "https://community.example.test/page",
    });
    const [requestedUrl, options] = outbound.mock.calls[0] as [
      URL,
      RequestOptions,
    ];
    expect(requestedUrl).toEqual(
      new URL("https://community.example.test/page"),
    );
    expect(options.headers).toEqual({
      "User-Agent": "Campfire/1.0 (link preview bot)",
    });
    expect(options).not.toHaveProperty("hostname");
    expect(options).not.toHaveProperty("servername");
    expect(options.agent).toBe(false);

    const lookupCallback = vi.fn();
    options.lookup?.("community.example.test", {}, lookupCallback);
    expect(lookupCallback).toHaveBeenCalledWith(
      null,
      "93.184.216.34",
      4,
    );
  });

  it("never sends a rebinding request to a private listener", async () => {
    const actualHttp = await vi.importActual<typeof import("node:http")>(
      "node:http",
    );
    transportMock.httpRequest.mockImplementation(actualHttp.request);
    let privateRequests = 0;
    const server = createServer((_request, response) => {
      privateRequests += 1;
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<title>internal</title>");
    });
    servers.add(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Listener did not bind");

    // Validation sees a public address, while the system resolver used by a
    // hostname-based connection still resolves localhost to the private listener.
    dnsMock.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);

    const response = await GET(request("http://localhost:" + address.port + "/rebinding"));

    expect([502, 504]).toContain(response.status);
    expect(privateRequests).toBe(0);
  }, 10_000);
});
