# Anonymous usage ping

Campfire sends one small, anonymous "I'm still here" ping so the project can
count how many installs exist, which versions they run, and whether people use
the Windows app as an online client or to host their own camp. It never
contains names, emails, IP addresses, hostnames, server or channel names, or
anything anyone wrote. You can turn it off at any time.

The wire contract is [`lib/telemetryProtocol.ts`](../lib/telemetryProtocol.ts);
this page and that file change together.

## Who sends it, and when

| Sender | When | `kind` |
|---|---|---|
| Windows app (the desktop launcher) | About 20 seconds after launch, then once a day while it runs | `desktop` |
| A self-hosted server (`npm run host:prod`, Docker) in production | About a minute after start, then once a day | `server` |
| Campfire Online itself (the collector) | Never. It counts its own users directly. | none |

- The server bundled inside the Windows app does not ping on its own; the
  launcher's ping (with `mode: "host"`) already counts it.
- Development runs (a server whose `NODE_ENV` is not `production`, or an
  unpackaged `electron desktop`) stay silent unless `CAMPFIRE_TELEMETRY_URL`
  is set, which is how you test a collector locally.
- A self-hosted server prints one line at startup when the ping is on, naming
  this page and the opt-out.
- A failed ping logs one short line and is not retried until the next day.

## Where it goes

Each ping is one HTTPS `POST` of JSON (at most 2 KB) to Campfire Online's
`/api/telemetry/ping`, which answers `204 No Content`, or `200` with a
broadcast notice (see [The answer](#the-answer-broadcast-notices)). The target
is chosen in this order:

1. `CAMPFIRE_TELEMETRY_URL`, a full URL (for example
   `http://localhost:3000/api/telemetry/ping` when testing);
2. `CAMPFIRE_CLOUD_URL`, an origin, plus `/api/telemetry/ping`;
3. the official Campfire Online origin built into the release.

If none is known, nothing is sent. An origin must be `https://` (or
`http://localhost` for testing).

## Exactly what is sent

| Field | Example | Meaning |
|---|---|---|
| `v` | `1` | Protocol version. |
| `installId` | `b3e1c7a0-5d2f-4c55-9e3b-0a6f1d2c9b84` | Anonymous install identifier (see below). 16-64 letters, digits, `-` or `_`. |
| `kind` | `"desktop"` | `"desktop"` (Windows app) or `"server"` (self-hosted server). |
| `mode` | `"cloud"` | Desktop only: `"cloud"` = online client of Campfire Online, `"host"` = "Host on this PC". `null` for servers. |
| `version` | `"0.1.0-beta.1"` | Campfire version. |
| `edition` | `"community"` | Server only: `"community"` or `"cloud"`. `null` for desktop. |
| `platform` | `"win32-x64"` | Operating system and CPU architecture. |
| `users` | `42` | Server only: number of registered (non-guest) accounts. `null` for desktop. |
| `activeUsers` | `9` | Server only: number of accounts that posted at least one message in the last 7 days. `null` for desktop. |

A desktop ping looks like this:

```json
{"v":1,"installId":"b3e1c7a0-5d2f-4c55-9e3b-0a6f1d2c9b84","kind":"desktop","mode":"cloud","version":"0.1.0-beta.1","edition":null,"platform":"win32-x64","users":null,"activeUsers":null}
```

The collector validates every field strictly. Unknown fields are ignored and a
ping with any invalid field is rejected without storing anything.

## The answer: broadcast notices

A recorded ping gets `204 No Content`, unless Campfire Online has a broadcast
notice set (`CAMPFIRE_NOTICE`, see [LAUNCH.md](./LAUNCH.md#announcing-a-new-version-or-campfire-pro)).
Then it gets `200` with that notice and nothing else:

```json
{"notice":{"id":"v0-2","text":"Campfire 0.2 is out.","url":"https://github.com/LouSputthole/Squatch-Bunker/releases/latest","urlLabel":"Get it"}}
```

| Field | Meaning |
|---|---|
| `id` | 1-64 letters, digits, `-` or `_`. Clients remember the id they dismissed, so a new id shows again. |
| `text` | The message, at most 280 characters. |
| `url` | An `https://` link, or `null`. |
| `urlLabel` | Link button text (at most 40 characters), or `null`; always `null` without a `url`. |

The notice is the same for every caller and says nothing about the caller.
Clients check it with the same rules as `parseTelemetryNotice` in
`lib/telemetryProtocol.ts` and treat anything invalid as no notice; a client
that ignores the body keeps working. Errors
(`400`, `404`, `413`, `429`, `500`) never carry a notice.

A self-hosted server's reporter ignores the body: our announcements are never
shown on someone else's server. Each instance's own web users see only that
instance's own `CAMPFIRE_NOTICE`, read from `GET /api/notice` (public,
`{"notice": ... }` or `{"notice": null}`).

The Windows app shows a notice only in **Host on this PC** mode (in Campfire
Online mode the window already shows the web banner). It shows each id once,
as a small dialog, and remembers the last 50 shown ids in
`desktop-settings.json` (`dismissedNoticeIds`). Turning the usage ping off
also turns these notices off, since they ride its answer.

## Update checks (separate from the ping)

Packaged Windows builds also contact GitHub to look for new versions, whether
or not the usage ping is on, so GitHub sees the IP address like any download.
Installed copies fetch the release feed (`releases.atom`, `releases/latest`,
and the release's `latest.yml`) about 15 seconds after launch and then every 6
hours; portable copies call `api.github.com` once per launch. Nothing about
the install is sent.

## How install IDs are made

- **Windows app:** a random UUID generated on first launch and saved in
  `desktop-settings.json` in the app's data folder. It is not derived from the
  machine, the user, or the network. Deleting that file makes a new ID.
- **Self-hosted server:** an HMAC-SHA256 of a fixed label keyed with the
  server's own `JWT_SECRET`, shortened to 32 characters. It stays the same
  across restarts and upgrades without storing anything, and it cannot be
  reversed to the secret or to the server. Rotating `JWT_SECRET` makes the
  server look like a new install.

## What is stored

Only Campfire Online stores pings, as one row per install ID (the
`TelemetryInstall` table): install ID, kind, mode, version, edition, platform,
user counts, and first-seen / last-seen times. A newer ping updates that row,
so there is no ping history. The collector uses the caller's IP address only
as an in-memory rate-limit key (20 pings an hour) and never writes it to the
database. Like any web request, the hosting provider's network logs can still
see the connecting address.

## How to opt out

- **Windows app:** right-click the Campfire tray icon and untick
  **Send anonymous usage ping**.
- **Self-hosted server:** set `CAMPFIRE_TELEMETRY=off` (`0`, `false` and `no`
  also work, in any case) in `.env` or the service environment and restart.
- **Anywhere:** `DO_NOT_TRACK=1` (or `true`) disables it too. The Windows app
  honours both variables as well.

## The dashboard

On Campfire Online (`CAMPFIRE_TELEMETRY_COLLECTOR=1`), the instance-admin page
`/admin` shows the counts. **People on this instance** counts Campfire
Online's own web users directly (distinct people who posted). **Campfire in
the wild** counts installs seen in the last day, 7 days, and 30 days, split into desktop online, desktop
host-on-PC, and self-hosted servers, plus self-hosted account totals, new
installs per day, versions in use, and GitHub release download counts. Only
users whose IDs are listed in `INSTANCE_ADMIN_USER_IDS` can open it.

To try the whole loop locally, run a server with
`CAMPFIRE_TELEMETRY_COLLECTOR=1` on port 3000, then start another Campfire (a
second checkout on a different `PORT`, or the Windows app) with
`CAMPFIRE_TELEMETRY_URL=http://localhost:3000/api/telemetry/ping`.
