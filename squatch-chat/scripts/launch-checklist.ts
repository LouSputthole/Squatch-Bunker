#!/usr/bin/env -S npx tsx
// `npm run launch:check`: would this environment start as a production
// Campfire? Runs the same checks server.ts runs at boot (no copy of their
// rules), plus launch advice. Exit 1 only for what would stop the server.
// Reads process.env only: `npx tsx --env-file=<file> scripts/launch-checklist.ts`.
// On Fly it runs as the release command (`npm run deploy:release`), so a
// missing secret fails `fly deploy` before the live machine is replaced.

import { assertBetaAccessConfig } from "../lib/betaAccess";
import { validateEditionConfig } from "../lib/edition";
import { assertTurnConfiguration } from "../lib/turnCredentials";

type Environment = Record<string, string | undefined>;

export function launchChecklist(source: Environment = process.env) {
  const env: Environment = { ...source, NODE_ENV: "production" };
  const errors: string[] = [];
  const advice: string[] = [];
  let edition = "community";
  try {
    const result = validateEditionConfig(env);
    edition = result.edition;
    errors.push(...result.errors);
    advice.push(...result.warnings);
  } catch (error) {
    errors.push((error as Error).message);
  }
  try {
    assertBetaAccessConfig(env);
  } catch (error) {
    errors.push((error as Error).message);
  }
  try {
    if (assertTurnConfiguration(env).mode !== "ephemeral") {
      advice.push("No TURN_URLS + TURN_AUTH_SECRET: voice fails between many home, office, and mobile networks");
    }
  } catch (error) {
    errors.push((error as Error).message);
  }
  if (!env.INSTANCE_ADMIN_USER_IDS?.trim()) {
    advice.push("INSTANCE_ADMIN_USER_IDS is empty: /admin (user counts) stays locked until you add your user id");
  }
  if (!env.CAMPFIRE_TRUST_PROXY_HOPS?.trim()) {
    advice.push("CAMPFIRE_TRUST_PROXY_HOPS is unset: behind a proxy, every visitor shares one rate-limit bucket");
  }
  return { edition, errors, advice };
}

if (process.argv[1] && /launch-checklist\.ts$/.test(process.argv[1])) {
  const { edition, errors, advice } = launchChecklist();
  console.log(`[Campfire] Launch check (${edition} edition, production rules)`);
  for (const line of advice) console.log(`  advice: ${line}`);
  for (const line of errors) console.error(`  FIX: ${line}`);
  if (errors.length) {
    console.error("[Campfire] The server would refuse to start. Fix the FIX lines (on Fly: fly secrets set ...).");
    process.exitCode = 1;
  } else {
    console.log("[Campfire] Required settings present.");
  }
}
