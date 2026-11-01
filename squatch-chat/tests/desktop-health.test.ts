import { createServer, type Server, type ServerResponse } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { isServerHealthy } from "@/desktop/health.cjs";

const servers: Server[] = [];

async function serve(handler: (response: ServerResponse, path?: string) => void) {
  const server = createServer((request, response) => handler(response, request.url));
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test port");
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
});

describe("desktop server readiness", () => {
  it("uses the database health route and accepts its healthy JSON", async () => {
    let requestedPath;
    const origin = await serve((response, path) => {
      requestedPath = path;
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end('{"status":"ok"}');
    });
    expect(await isServerHealthy(origin)).toBe(true);
    expect(requestedPath).toBe("/api/health");
  });

  it.each([
    [503, "application/json", '{"status":"unavailable"}'],
    [500, "application/json", '{"status":"ok"}'],
    [302, "application/json", '{"status":"ok"}'],
    [200, "text/html", '{"status":"ok"}'],
    [200, "application/json", '{"status":"unavailable"}'],
    [200, "application/json", "not json"],
    [200, "application/json", "null"],
    [200, "application/json", ""],
    [200, "application/json", JSON.stringify({ status: "ok", padding: "x".repeat(16_384) })],
  ])("rejects HTTP %s with %s and an invalid health response", async (status, contentType, body) => {
    const origin = await serve((response) => {
      response.writeHead(status, { "content-type": contentType });
      response.end(body);
    });
    expect(await isServerHealthy(origin)).toBe(false);
  });

  it("bounds a response that starts but never completes", async () => {
    const origin = await serve((response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.write('{"status":');
    });
    expect(await isServerHealthy(origin, { timeoutMs: 100 })).toBe(false);
  });

  it("rejects a server that drops the connection", async () => {
    const origin = await serve((response) => response.destroy());
    expect(await isServerHealthy(origin)).toBe(false);
  });

  it("rejects a stopped server", async () => {
    const origin = await serve((response) => response.end());
    const server = servers.pop()!;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(await isServerHealthy(origin)).toBe(false);
  });
});
