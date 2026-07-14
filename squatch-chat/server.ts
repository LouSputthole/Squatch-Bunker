/**
 * Campfire Unified Server
 * Runs Next.js + Socket.IO on a single port.
 * Usage: npx tsx server.ts  (or `npm run host`)
 */
import "./lib/als-polyfill"; // must precede `next` — see file comment
import "dotenv/config"; // load .env before realtime/server.ts reads JWT_SECRET at import
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { parse } from "url";
import next from "next";
import { attachSocketIO } from "./realtime/server";
import { networkInterfaces } from "os";
import { deliverDueMessages } from "./lib/scheduledDelivery";
import { prisma } from "./lib/db";
import {
  sweepAbandonedPrivateUploads,
  sweepExpiredMessages,
} from "./lib/messageRetention";
import { assertEditionConfig } from "./lib/edition";
import { assertBetaAccessConfig } from "./lib/betaAccess";
import { assertTurnConfiguration } from "./lib/turnCredentials";
import {
  resolveUserMediaPath,
  userMediaCacheControl,
  userMediaContentType,
} from "./lib/userMedia";

import { DIRECT_CLIENT_IP_HEADER } from "./lib/clientIp";
const PORT = parseInt(process.env.PORT || "3000", 10);
const BIND_HOST = process.env.CAMPFIRE_BIND_HOST?.trim() || "0.0.0.0";
const dev = process.env.NODE_ENV !== "production";

function getLanIP(): string {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "localhost";
}

function serveUserMedia(
  request: IncomingMessage,
  response: ServerResponse,
): boolean {
  if (!process.env.CAMPFIRE_UPLOAD_DIR) return false;
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const pathname = parse(request.url || "").pathname;
  const filePath = pathname ? resolveUserMediaPath(pathname) : null;
  if (!filePath) return false;

  let stat;
  try {
    if (!existsSync(filePath)) return false;
    stat = statSync(filePath);
    if (!stat.isFile()) return false;
  } catch {
    return false;
  }
  response.writeHead(200, {
    "Cache-Control": userMediaCacheControl(pathname || ""),
    "Content-Length": String(stat.size),
    "Content-Type": userMediaContentType(filePath),
    "X-Content-Type-Options": "nosniff",
  });
  if (request.method === "HEAD") {
    response.end();
  } else {
    const stream = createReadStream(filePath);
    stream.once("error", () => response.destroy());
    stream.pipe(response);
  }
  return true;
}

async function main() {
  process.env.CAMPFIRE_UNIFIED_SERVER = "1";
  assertBetaAccessConfig();
  const turnConfiguration = assertTurnConfiguration();
  if (turnConfiguration.mode === "legacy") {
    console.warn(
      "[Campfire] Configuration warning: legacy static TURN credentials are enabled "
      + "for compatibility and do not satisfy public-beta readiness. Configure TURN_AUTH_SECRET.",
    );
  }
  const edition = assertEditionConfig();
  for (const warning of edition.warnings) {
    console.warn(`[Campfire] Configuration warning: ${warning}`);
  }
  const app = next({ dev, hostname: BIND_HOST, port: PORT });
  const handle = app.getRequestHandler();

  await app.prepare();

  const httpServer = createServer((req, res) => {
    delete req.headers[DIRECT_CLIENT_IP_HEADER];
    const directIp = req.socket.remoteAddress;
    if (directIp) req.headers[DIRECT_CLIENT_IP_HEADER] = directIp;
    if (serveUserMedia(req, res)) return;
    const parsedUrl = parse(req.url || "/", true);
    handle(req, res, parsedUrl);
  });

  // Attach Socket.IO to the same HTTP server — single port for everything
  const io = attachSocketIO(httpServer);

  async function runScheduledDelivery() {
    const result = await deliverDueMessages();
    for (const message of result.delivered) {
      io.to(`channel:${message.channelId}`).emit(`message:channel:${message.channelId}`, message);
    }
    if (result.failed.length > 0) {
      console.error(`[Campfire] ${result.failed.length} scheduled message(s) will be retried.`);
    }
  }

  const schedulerInterval = setInterval(() => {
    void runScheduledDelivery();
  }, 15_000);
  schedulerInterval.unref();
  void runScheduledDelivery();

  async function runRetentionSweep() {
    const [retention, abandoned] = await Promise.all([
      sweepExpiredMessages(),
      sweepAbandonedPrivateUploads(),
    ]);
    if (retention.deletedMessages > 0) {
      console.log(`[Campfire] Retention sweep removed ${retention.deletedMessages} expired message(s).`);
    }
    if (abandoned.deletedUploads > 0) {
      console.log(`[Campfire] Retention sweep removed ${abandoned.deletedUploads} abandoned upload(s).`);
    }
  }

  const retentionInterval = setInterval(() => {
    void runRetentionSweep().catch((error) => {
      console.error("[Campfire] Retention sweep failed:", error);
    });
  }, 60 * 60 * 1_000);
  retentionInterval.unref();
  void runRetentionSweep().catch((error) => console.error("[Campfire] Retention sweep failed:", error));

  let shuttingDown = false;
  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Campfire] ${signal} received; draining connections...`);
    clearInterval(schedulerInterval);
    clearInterval(retentionInterval);

    await new Promise<void>((resolve) => io.close(() => resolve()));
    if (httpServer.listening) {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await prisma.$disconnect();
    process.exitCode = 0;
  }

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  httpServer.listen(PORT, BIND_HOST, () => {
    const ip = getLanIP();
    console.log("");
    console.log("  ╔══════════════════════════════════════════╗");
    console.log("  ║          🏕️  Campfire is live              ║");
    console.log("  ╠══════════════════════════════════════════╣");
    console.log(`  ║  Local:   http://localhost:${PORT}`);
    console.log(`  ║  Network: http://${ip}:${PORT}`);
    console.log("  ║                                          ║");
    console.log("  ║  Share the Network URL with others!      ║");
    console.log("  ╚══════════════════════════════════════════╝");
    console.log("");
  });
}

main().catch((err) => {
  console.error("[Campfire] Failed to start:", err);
  process.exit(1);
});
