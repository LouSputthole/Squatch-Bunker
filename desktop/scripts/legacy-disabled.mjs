#!/usr/bin/env node

console.error(
  [
    "[Campfire] The repository-root desktop package is archived and cannot be built or run.",
    "Use the maintained pipeline from squatch-chat:",
    "  npm run desktop:stage",
    "  npm run desktop:verify",
    "  npm run desktop:dist",
    "See squatch-chat/docs/RELEASE_CHECKLIST.md before publishing artifacts.",
  ].join("\n"),
);

process.exitCode = 1;
