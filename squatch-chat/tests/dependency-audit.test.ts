import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

async function auditAdvisory(name: string, args: string[] = []) {
  const registry = createServer((request, response) => {
    request.resume();
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      [name]: [{ severity: "high", vulnerable_versions: "*", title: "Test advisory", url: "https://example.invalid/advisory" }],
    }));
  });
  registry.listen(0, "127.0.0.1");
  await once(registry, "listening");
  try {
    const address = registry.address();
    if (!address || typeof address === "string") throw new Error("Missing registry port");
    const child = spawn(process.execPath, [resolve("scripts/audit-dependencies.mjs"), ...args], {
      env: { ...process.env, npm_config_registry: `http://127.0.0.1:${address.port}` },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    const [code] = await once(child, "close");
    return { code, output };
  } finally {
    registry.closeAllConnections();
    await new Promise<void>((done) => registry.close(() => done()));
  }
}

describe("release dependency gate", () => {
  it("blocks vulnerable Electron even though npm marks it dev-only", async () => {
    const result = await auditAdvisory("electron");
    expect(result.output).toContain("electron@");
    expect(result.code).toBe(1);
  });

  it("continues to block vulnerable web runtime dependencies", async () => {
    expect((await auditAdvisory("next")).code).toBe(1);
  });

  it("reports a build-only dependency without blocking the runtime gate", async () => {
    const result = await auditAdvisory("eslint");
    expect(result.output).toContain("eslint@");
    expect(result.code).toBe(0);
  });

  it("blocks build-only dependencies when explicitly requested", async () => {
    expect((await auditAdvisory("eslint", ["--include-dev"])).code).toBe(1);
  });
});
