# Launch handoff (2026-10-11)

How Campfire gets launched free (in the browser and as a Windows app), how we count the people using it and ship them updates, and the decisions the owner still has to make. Start with this file, then read [LAUNCH.md](./LAUNCH.md), the step-by-step go-live runbook.

## TL;DR

- **Built and verified:**
  - Campfire Online, one shared hosted instance.
  - The Windows app, which opens Campfire Online by default, with "Host on this PC" as the second mode.
  - Anonymous install counts on `/admin`.
  - Free for now: every feature unlocked until Stripe is configured.
  - A public `/download` page.
  - A Fly.io deploy kit (about $35/month).
  - Broadcast notices ("a better version is here").
  - Silent auto-update for the installed `.exe`.

  A real packaged `.exe` was smoke-tested in cloud mode, host mode and auto-update.
- **Merged on 2026-10-12** into the branch `claude/gifted-carson-ja99l1` (on GitHub, stacked on `main` after PRs #16 and #17), together with Ranger Desk and Trail Boards:
  - Terms of Service and Privacy Policy (with owner placeholders), rewritten where Ranger Desk changed the report flow.
  - Self-service account deletion.
  - Full suite green on the merged branch: 764 tests, lint, TypeScript, `db:check`.
- **Unfinished:** operator moderation tools (suspend or ban, remove content, evidence hold). `feat/launch-moderation` is pushed but still the untested WIP commit; it is not merged and has no PR.
- **Not done, owner-gated:** open and merge the PR for `claude/gifted-carson-ja99l1`, domain, hosting accounts, deploy ([docs/LAUNCH.md](./LAUNCH.md) runbook), publishing a desktop release.

## Branches and worktrees

All three `feat/launch-*` branches were pushed to GitHub on 2026-10-12. PRs #16 and #17 are merged on `main` (`88117c8`). The launch and legal branches are merged into `claude/gifted-carson-ja99l1`, which is the branch to PR into `main`.

| Branch | Worktree | Tip | State |
|---|---|---|---|
| `feat/launch-reach-telemetry` | `code\Squatch-Bunker-polish` | `639742c` | **The launch branch.** Online client mode, telemetry, free-for-now, `/download`, review fixes, and `feat/launch-ops` merged in (deploy kit, notices, auto-update) plus merge follow-ups. Full suite green at the merge (708 tests). |
| `feat/launch-ops` | `code\Squatch-Bunker-launch2` | `2aa4ab8` | Already merged into the launch branch at `0e2770a`. Its `desktop/dist` holds **smoke-test builds with `http://127.0.0.1:3871` baked in: never publish them.** |
| `feat/launch-legal` | `code\Squatch-Bunker-legal` | `7c132d4` | **Merged into `claude/gifted-carson-ja99l1` on 2026-10-12.** `/terms`, `/privacy` (cloud edition only), consent line with 13+ attestation, self-service account deletion, operator report list. Based on `99400e4`. 707 of 709 tests pass; the one failure is the known `sqlite-sync` timeout, which passes when run alone. |
| `feat/launch-moderation` | `code\Squatch-Bunker-mod` | `199f3bb` | **WIP, incomplete.** Operator moderation was cut short at wrap-up. Schema, migration `20261011010000_instance_moderation`, `lib/instanceModeration.ts`, `lib/serverDeletion.ts`, `/api/admin/moderation`. Tests were never run and the review never happened. Based on `feat/launch-legal`. |

Merge order to finish the stack:
1. ~~Merge `feat/launch-legal` into the launch branch.~~ Done 2026-10-12 (both are in `claude/gifted-carson-ja99l1`; `/admin` keeps the Ranger Desk operator panel and gained the 30-day message-report list the Terms promise).
2. Finish `feat/launch-moderation` (see "Next work"), rebase it onto `claude/gifted-carson-ja99l1` (or `main` once that is merged), then merge it in.
3. Run full checks (`db:check`, `tsc`, `lint`, `npm test`, `build`, `desktop:stage` + `desktop:verify -- --require-stage`), then push and open one PR against `main`, stacked after #17.

The other worktrees can be removed after merging. First check that `node_modules` are real directories, not junctions, before running `git worktree remove`.

## What was built, by the owner's original asks

| Ask | Delivered | Where |
|---|---|---|
| Launchable from the web | Campfire Online (`CAMPFIRE_EDITION=cloud`) and a public `/download` page. The login page links the desktop app, on cloud instances only. | `app/download/`, [LAUNCH.md](./LAUNCH.md) |
| Installable `.exe` | The Electron launcher opens Campfire Online by default; "Host on this PC" is the second mode. Existing installs that hold local communities stay in host mode. A host-start failure offers Campfire Online instead. The cloud URL is baked in at stage time (`CAMPFIRE_CLOUD_URL` / `desktop/package.json` `campfireCloudUrl`); blank means host-only. | `desktop/main.cjs`, `desktop/launcher-core.cjs` |
| Free to use | When the cloud edition has no Stripe configuration, every feature is unlocked. Setting the four Stripe variables switches paid tiers on. Abuse caps were added for the newly free features (scheduled messages, export). | `lib/features.ts`, [EDITIONS.md](./EDITIONS.md) |
| Client-hostable version (paid later) | Self-host is free and fully unlocked (`npm run host:prod`, Docker, desktop "Host on this PC"). **No paid self-host path exists in code.** Billing is cloud-only by design; see the options below. | [DEPLOY.md](./DEPLOY.md), [EDITIONS.md](./EDITIONS.md) |
| Know how many people | An anonymous install ping (contract: `lib/telemetryProtocol.ts`) from desktop launchers and production self-hosted servers to the hosted collector (`CAMPFIRE_TELEMETRY_COLLECTOR=1`). `/admin` shows active installs over 1/7/30 days by kind, versions, new installs per day, self-hosted user totals, this instance's active people, and GitHub downloads. Users can opt out via the tray toggle, `CAMPFIRE_TELEMETRY=off` or `DO_NOT_TRACK`. | [TELEMETRY.md](./TELEMETRY.md), `app/admin/page.tsx` |
| Push updates and a better version | Web: a redeploy updates everyone. Installed `.exe`: electron-updater checks 15 s after launch and every 6 h, downloads in the background and offers "Restart now"; the release must include `latest.yml` and the `.blockmap`. Portable copies get a download prompt. Self-hosted `/admin` shows when a newer release exists. **Broadcast notice:** `CAMPFIRE_NOTICE` shows a banner to every Campfire Online user and a one-time dialog to host-mode desktops, and never reaches self-hosted servers. | [LAUNCH.md#shipping-updates](./LAUNCH.md#shipping-updates), [LAUNCH.md#announcing-a-new-version-or-campfire-pro](./LAUNCH.md#announcing-a-new-version-or-campfire-pro) |

Verification evidence:
- **Full suite:** 708 tests green on `feat/launch-ops` before the merge. After the merge, focused suites were rerun.
- **Production build and `desktop:verify`:** green.
- **Collector:** smoke-tested end to end (204/400/413/415).
- **Real packaged `.exe` smoke:**
  - Cloud mode: a fresh profile opened the stand-in Campfire Online with no local server, and the ping arrived with mode `cloud`.
  - Host mode: with a seeded database, the bundled server booted, guest sign-in worked, and the ping arrived with mode `host`.
  - Auto-update: found 0.1.0-beta.2 on a local feed and downloaded it.
  - Cleanup: no orphan processes, and `%APPDATA%\Campfire` was untouched.
- **Merge check:** the launch-ops merge was adversarially checked against both parents; only 2 low issues were found, both fixed in `639742c`.
- **Bug found and fixed along the way:** v0.0.3 desktop databases upgraded without the Ember Inbox `Notification` table and the quiet-hours columns, which would have broken sign-in after an update. The desktop schema is now version 6, with a parity test.

## Next work (in order)

1. ~~**Merge `feat/launch-legal`**~~ Done 2026-10-12.
2. **Finish operator moderation** (`feat/launch-moderation`, WIP `199f3bb`). Goal: from `/admin`, an instance admin can
   - suspend or unsuspend an account (sessions and sockets killed; login, guest and OAuth refused);
   - block re-registration by email or OAuth identity hash;
   - remove any message, file or camp;
   - remove with a 1-year evidence hold for child-safety reports;
   - see an audit log.

   Then write `tests/instance-moderation.test.ts`, run full checks, and run a security review (authz on every action, suspended users fully locked out, held evidence unreachable by URL and never removed by other cleanup) and a correctness review (schema parity across SQLite, PostgreSQL and desktop; hidden messages everywhere they render). Until it lands, `feat/launch-legal`'s LAUNCH.md has an interim manual runbook in its "Publish the rules" go-live step: remove content and ban by hand with the database console, plus how to preserve child-safety evidence. Keep that runbook when merging; delete it once the moderation tools ship.
3. **Open the PR** (one PR, stacked after #17) once the checks are green.
4. **Remaining desktop smoke:** run the real NSIS install and the "Restart now" update in Windows Sandbox or on a spare account (RELEASE_CHECKLIST §7). This was never run on the owner's machine because it would replace the real install.
5. **Known gaps (documented):**
   - OAuth sign-in in the desktop cloud window finishes in the system browser.
   - Unsigned exe: SmartScreen warns, and the GitHub account is effectively the update-signing key.
   - Peer-to-peer voice works for about 6 people per room until there is an SFU.
   - The desktop writes Next caches inside the install directory, which breaks Program Files installs; per-user installs (the default) are fine.

## Owner decisions and actions

| # | Item | Notes / recommendation |
|---|---|---|
| 1 | **Domain** | Blocks the Resend sender, the TURN certificate and the desktop release, which bakes the URL in permanently. Campfire Online can start on `campfire-online.fly.dev`. |
| 2 | **Hosting spend (~$35/mo)** | Fly 1 GB machine in `iad` ~$8, Neon Launch ~$20, coturn on a $6 DigitalOcean droplet, Resend free tier. Neon Free will **not** work: polling every 15 s exhausts its compute hours around day 16. Set Neon history to 7 days (the default is 1). The volume auto-extends to 20 GB. |
| 3 | **Deploy** | Follow [LAUNCH.md](./LAUNCH.md#go-live) steps 1–13. Fly needs `CAMPFIRE_TRUST_PROXY_HOPS=2` (not 1); step 9 proves it live. |
| 4 | **Merge PRs #16 → #17**, then this launch PR | Merge with `gh pr merge --merge`. Auto-mode blocks agent merges to `main`. |
| 5 | **Publish the desktop release** | A normal release, not a pre-release, built with the real domain. Attach the setup exe, portable exe, `latest.yml` and `.blockmap`. `verify-desktop --require-package` now refuses non-https cloud URLs. v0.0.3 users need one manual update; after that, updates are automatic. |
| 6 | **Code signing and GitHub 2FA** | Until releases are signed, whoever can publish a GitHub release can push code to every installed copy within 6 hours. Turn on 2FA now; Azure Trusted Signing is the cheap route. |
| 7 | **Legal** | Fill every `[placeholder]` in `lib/legal.ts` (the server warns while any remain). Get a lawyer to review `/terms` and `/privacy` and the owner notes at the top of `app/terms/terms.ts` and `app/privacy/privacy.ts`. Register a DMCA agent (about $6) and an NCMEC CyberTipline account. Rewrite Terms §13 before setting Stripe keys. Material policy changes need an email 30 days ahead. Counsel should also decide on the desktop ping under ePrivacy for EU and UK users (opt-in vs. opt-out). |
| 8 | **Paid "client-hosted" version** | Not built. Options: (a) **managed private instances**: we host a dedicated Campfire per client, billed by Stripe (fits AGPL; the most work for operations); (b) **support or priority plans** for self-hosters (no code; contracts and Stripe Payment Links); (c) **commercial license or license keys** (needs a dual-license decision; AGPL code can't be closed, and keys in AGPL code are easy to remove). Recommendation: (b) first, then (a). |
| 9 | **Cleanup** | Delete the scratch Neon project `flat-leaf-31484496`, delete 4 stale merged branches, and remove the worktrees once merged. |

## Gotchas

- Only one vitest run per worktree at a time: the tests share `tests/.tmp/test.db`. `tests/sqlite-sync.test.ts` times out under memory pressure; rerun it alone with `--testTimeout=20000`.
- `desktop:stage` needs `npm ci` in `squatch-chat/desktop` and the Electron binary (`node node_modules/electron/install.js`) in a fresh worktree.
- `npm run host` is the dev server; real servers use `npm run host:prod`, which builds if needed and sets `COOKIE_SECURE=0` for plain-HTTP LAN.
- Schema changes need three things: `schema.prisma`, the regenerated PostgreSQL schema plus a migration, and a `desktop/database.cjs` upgrade with a version bump. `tests/desktop-database.test.ts` holds the desktop to the Prisma schema.
- Reusable packaged-exe smoke scripts from this session (`smoke.cjs cloud|host`, `autoupdate.cjs`) lived in the session scratchpad. RELEASE_CHECKLIST §7 has the recipe.

## Marketing site

The separate repo https://github.com/LouSputthole/campfire-site (private) has its own handoff at `docs/HANDOFF.md` and Vercel deploy steps in its README. It's a Three.js scroll film, "Closer to the Fire", that ports into sboxskins.gg as `/campfire`.
