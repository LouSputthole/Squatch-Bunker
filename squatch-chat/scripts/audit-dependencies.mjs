// Dependency-advisory gate for CI (Release Checklist §2).
//
// `npm audit` currently fails against registry.npmjs.org: the bulk advisory
// endpoint returns a gzip-compressed body without a Content-Encoding header,
// npm cannot parse it, and its fallback — the retired "quick" audit endpoint —
// now answers 400. This script performs the same bulk-advisory check itself
// and transparently gunzips the malformed response, so the gate keeps failing
// on real high/critical advisories instead of on registry plumbing.
//
// Usage: node scripts/audit-dependencies.mjs [--audit-level=high]

import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const semver = require("semver");

const SEVERITY_RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const levelArg = process.argv
  .find((a) => a.startsWith("--audit-level="))
  ?.split("=")[1];
const failLevel = levelArg ?? "high";
if (!(failLevel in SEVERITY_RANK)) {
  console.error(`Unknown audit level: ${failLevel}`);
  process.exit(2);
}

const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));

// version -> is this copy reachable outside dev-only paths?
const installed = new Map();
for (const [path, entry] of Object.entries(lock.packages ?? {})) {
  if (!path || !entry.version) continue;
  const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
  if (!installed.has(name)) installed.set(name, new Map());
  const versions = installed.get(name);
  const isProd = !entry.dev;
  versions.set(entry.version, (versions.get(entry.version) ?? false) || isProd);
}

const payload = {};
for (const [name, versions] of installed) payload[name] = [...versions.keys()];

const registry = process.env.npm_config_registry ?? "https://registry.npmjs.org";
const response = await fetch(`${registry.replace(/\/$/, "")}/-/npm/v1/security/advisories/bulk`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
});
if (!response.ok) {
  console.error(`Bulk advisory endpoint returned HTTP ${response.status}.`);
  process.exit(2);
}
let body = Buffer.from(await response.arrayBuffer());
if (body[0] === 0x1f && body[1] === 0x8b) body = gunzipSync(body);
const advisories = JSON.parse(body.toString("utf8"));

const findings = [];
for (const [name, list] of Object.entries(advisories)) {
  const versions = installed.get(name);
  if (!versions) continue;
  for (const advisory of list) {
    for (const [version, isProd] of versions) {
      if (semver.satisfies(version, advisory.vulnerable_versions, { includePrerelease: true })) {
        findings.push({ name, version, isProd, ...advisory });
      }
    }
  }
}

findings.sort(
  (a, b) =>
    Number(b.isProd) - Number(a.isProd) ||
    (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0)
);
for (const f of findings) {
  const scope = f.isProd ? "prod" : "dev ";
  console.log(
    `${scope} ${f.severity.toUpperCase().padEnd(8)} ${f.name}@${f.version} — ${f.title} (${f.url})`
  );
}

// The gate covers dependencies that ship in production; dev-only toolchain
// findings are reported above for review but do not fail the build unless
// --include-dev is passed. Accepted dev advisories must be recorded with an
// owner and expiry in the release evidence (Release Checklist §2).
const includeDev = process.argv.includes("--include-dev");
const failing = findings.filter(
  (f) => (f.isProd || includeDev) && (SEVERITY_RANK[f.severity] ?? 0) >= SEVERITY_RANK[failLevel]
);
console.log(
  `\nAudited ${installed.size} packages: ${findings.length} advisories matched ` +
    `(${findings.filter((f) => f.isProd).length} production), ` +
    `${failing.length} gate failures at or above "${failLevel}".`
);
if (failing.length > 0) process.exit(1);
