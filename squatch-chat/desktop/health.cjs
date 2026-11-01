"use strict";

const http = require("node:http");

/** Wait for the database-backed health route, never a redirect or error page. */
function isServerHealthy(origin, { timeoutMs = 1_000 } = {}) {
  return new Promise((resolve) => {
    let request;
    let settled = false;
    const finish = (healthy) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve(healthy);
      request?.destroy();
    };
    // A total deadline also bounds a server that keeps trickling response bytes.
    const deadline = setTimeout(() => finish(false), timeoutMs);
    try {
      request = http.get(new URL("/api/health", origin), (response) => {
        if (
          response.statusCode !== 200 ||
          !/^application\/json(?:\s*;|$)/i.test(response.headers["content-type"] || "")
        ) {
          response.resume();
          finish(false);
          return;
        }
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > 16_384) return finish(false);
          chunks.push(chunk);
        });
        response.once("error", () => finish(false));
        response.once("aborted", () => finish(false));
        response.once("end", () => {
          try {
            finish(JSON.parse(Buffer.concat(chunks).toString("utf8"))?.status === "ok");
          } catch {
            finish(false);
          }
        });
      });
      request.once("error", () => finish(false));
    } catch {
      finish(false);
    }
  });
}

module.exports = { isServerHealthy };
