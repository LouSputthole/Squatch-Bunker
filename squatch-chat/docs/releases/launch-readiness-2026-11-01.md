# Campfire launch readiness — 2026-11-01

Status: stabilization in progress; **not public-beta or desktop release sign-off**.

## Source and published state

Reviewed base: `b3e51ac747e11f1a4d3cde65bdc4bd33c76b360a` in `LouSputthole/Squatch-Bunker`.
PRs [#16](https://github.com/LouSputthole/Squatch-Bunker/pull/16) and [#17](https://github.com/LouSputthole/Squatch-Bunker/pull/17) are merged. PR #18 adds a separate game server; it does not replace Campfire.
Latest published download remains [v0.0.3](https://github.com/LouSputthole/Squatch-Bunker/releases/tag/v0.0.3).

Verified GitHub results for the **base SHA**, not the modified candidate:

| Job | Result / immutable job link |
| --- | --- |
| Build, lint, types, tests, audit, reproducible generation/build | [Passed](https://github.com/LouSputthole/Squatch-Bunker/actions/runs/39605543180/job/119240670349) |
| SQLite fresh install, upgrade, restart, restore | [Passed](https://github.com/LouSputthole/Squatch-Bunker/actions/runs/39605543231/job/119240670815) |
| PostgreSQL previous-version upgrade | [Passed](https://github.com/LouSputthole/Squatch-Bunker/actions/runs/39605543231/job/119240671477) |
| Production container, persistence, backup, restore | [Passed](https://github.com/LouSputthole/Squatch-Bunker/actions/runs/39605543231/job/119240671115) |

## Work completed in this candidate

- Next.js / eslint-config-next 16.4.3; Electron pinned to 43.8.6.
- Compatible lockfile updates for fast-uri, hono, undici, vite, zod, and related dependencies.
- Release audit covers Electron regardless of npm's dev flag. A regression test failed before the change (exit 0 for a high Electron advisory) and passes after it (exit 1).
- Desktop waits for the real database health response, with a bounded body and total timeout. The helper is explicitly included in installer/portable packaging.
- Packaged smoke testing found a missing `next/headers` dependency closure. Staging now traces/copies that closure with Next's bundled file tracer, and staging/verification require the real module. The added gate failed on the old stage and passed after the fix.
- Stale roadmap handoff corrected: the completion work is already merged.
- Build script forwards Next CLI flags, preserving Prisma setup for the documented `npm run build -- --webpack` alternative. The realtime verifier now loads `.env` like the unified server.

## Local verification

Windows x64, Node 24.14.1, npm 11.11.0. Full supported Node 22 CI remains required for the final candidate.

| Check | Result |
| --- | --- |
| Full regression suite | 92 files passed, 1 skipped; 642 tests passed, 1 skipped |
| New desktop health + dependency gate cases | 17 passed |
| ESLint / TypeScript | Passed |
| Release metadata / provider schema consistency | Passed |
| Desktop packaging configuration | Passed; this alone is not artifact validation |
| Online dependency audit | 7 moderate advisories, 0 high/critical, 0 high gate failures |
| Production build | Next.js 16.4.3 Webpack production build passed; Turbopack CSS worker exits early on this Windows host with both Node 22 and 24 |
| Running application / browser smoke | Guest login, create camp, send message, reload, full server restart/session/message persistence passed; no browser console errors observed |
| Authenticated realtime / Origin isolation | Passed against the production unified server on loopback |
| Desktop stage / native module / stage validation | Passed with Electron 43.8.6, a SQLite query under Electron's actual ABI, and a real next/headers import |
| Packaged runtime smoke | Corrected win-unpacked app: database health and login HTTP 200; guest creation and authenticated browser realtime passed; no browser errors observed |
| Packaged parent watchdog | Force-stopped the identified test parent; its child server exited within 8 seconds |
| Current desktop artifacts | Portable/installer being rebuilt with the packaging fix; unsigned; installer lifecycle and full artifact acceptance remain open |

The initial local install failed because the agent environment inherited `RUST_LOG=warn`. Fresh SQLite creation failed with that value on Node 24 and 22, and succeeded with `RUST_LOG=info` or with the variable removed. This matches [Prisma issue 29355](https://github.com/prisma/prisma/issues/29355). Validation uses a process-local environment correction; no user/system setting or schema was changed. Vitest also requires unsandboxed execution here because Windows sandbox temp-file renames return EPERM.

Windows reproduction commands (PowerShell, with the inherited logging setting removed only for this process):

```powershell
$env:RUST_LOG = $null
npm run build -- --webpack
npm run desktop:stage -- --skip-next-build
npm run desktop:verify -- --require-stage
node node_modules/electron-builder/cli.js --config packaging/electron-builder.json --win portable nsis --x64
```

The regular build keeps Next's default bundler. A passing Webpack build does not imply the local Turbopack failure is fixed. Candidate Linux CI must test the normal build, and Windows artifacts must retain the selected bundler in their provenance.

The initial executable build passed but the portable runtime crashed with `Cannot find module './dist/server/request/cookies'`. Those initial files are superseded. The corrected unpacked runtime passed the checks above; an unpacked pass alone is not portable or installer lifecycle sign-off. Do not publish an artifact based only on electron-builder's successful exit or its "signing" log lines: Authenticode status must be checked separately.

## Remaining dependency review

The initial fresh audit found 36 matching advisories, including two critical Next.js advisories and a high Electron advisory. Updating the lockfile removed all high/critical findings, including build-only packages.

Seven moderate findings remain, **not accepted release exceptions**:

| Package | Advisory | Required disposition |
| --- | --- | --- |
| @hono/node-server 1.19.17 | [GHSA-rmxm-3fg6-px4f](https://github.com/advisories/GHSA-rmxm-3fg6-px4f) | Reached through prisma 7.8.0 -> @prisma/dev 0.24.3 (also retained by @prisma/client's optional peer); assess tooling exposure and test a compatible major upgrade or record explicit owner acceptance before release |
| minimatch 3.1.5, 5.1.9, 9.0.9, 10.2.6 (dev) | [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) | Build-tool review / upstream compatible fixes |
| @vitest/mocker 4.1.11 (dev) | [GHSA-qxg6-89mg-rqv8](https://github.com/advisories/GHSA-qxg6-89mg-rqv8), [GHSA-xp26-3454-mjgp](https://github.com/advisories/GHSA-xp26-3454-mjgp) | Review isolated test-run exposure and upgrade path |

Review deadline: before any beta publication. No historical advisory acceptance carries forward automatically.

## Next launch gates, in order

1. Freeze the final candidate and pass its CI and database/container release workflows; retain exact job/artifact links.
2. Build and smoke-test candidate Windows artifacts, record hashes, and validate signing/upgrade/persistence. Keep release assets in a draft until the required acceptance is complete.
3. Identify/provision the invited-beta HTTPS origin and TURN host. Run `staging:verify` against that exact deployed SHA; keep secrets out of evidence.
4. Prove two-device cross-network audio with UDP and TLS relay, plus permission denial, reconnect, PTT, deafen, Fireside Stage, camera, and screen share. Local socket tests cannot substitute for this.
5. Rehearse encrypted off-host recovery and rollback; finish browser/device acceptance and name operational/support owners.
6. Complete the [release evidence manifest](0.1.0-beta.1-evidence.md) and final go/no-go decision before publishing the beta tag. Paid hosting and large-room SFU claims remain outside this release.
