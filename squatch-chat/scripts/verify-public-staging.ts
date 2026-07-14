#!/usr/bin/env -S npx tsx

import {
  PublicStagingVerificationError,
  verifyPublicStaging,
} from "./public-staging-verifier";

const baseUrl = process.argv[2];

if (!baseUrl || process.argv.length !== 3) {
  console.error(
    "Usage: npm run staging:verify -- https://campfire.example.com",
  );
  process.exitCode = 1;
} else {
  verifyPublicStaging(baseUrl, {
    betaAccessCode:
      process.env.CAMPFIRE_STAGING_BETA_ACCESS_CODE || undefined,
    report: (message) => console.log(`[Campfire staging] ${message}`),
  })
    .then((result) => {
      console.log(
        `[Campfire staging] PASS ${result.checks} automated checks against ${result.origin}`,
      );
      console.log("[Campfire staging] MANUAL gates still required:");
      for (const check of result.manualChecks) {
        console.log(`[Campfire staging] - ${check}`);
      }
    })
    .catch((error: unknown) => {
      const message =
        error instanceof PublicStagingVerificationError
          ? error.message
          : "Unexpected verifier failure; no response or credential data was printed.";
      console.error(`[Campfire staging] FAIL ${message}`);
      process.exitCode = 1;
    });
}
