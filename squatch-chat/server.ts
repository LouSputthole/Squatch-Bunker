/**
 * Campfire Unified Server
 * Runs Next.js + Socket.IO on a single port.
 * Usage: npx tsx server.ts
 */
import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { attachSocketIO } from "./realtime/server";
import { networkInterfaces } from "os";

const PORT = parseInt(process.env.PORT || "3000", 10);
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

async function main() {
  const app = next({ dev, hostname: "0.0.0.0", port: PORT });
  const handle = app.getRequestHandler();

  await app.prepare();

  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url || "/", true);
    handle(req, res, parsedUrl);
  });

  // Attach Socket.IO to the same HTTP server — single port for everything
  attachSocketIO(httpServer);

  httpServer.listen(PORT, "0.0.0.0", () => {
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
