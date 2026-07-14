# Public staging verification

Run the public-only gate after deploying the exact beta candidate behind its
final HTTPS reverse proxy:

```bash
npm run staging:verify -- https://campfire.example.com
```

The argument must be an HTTPS origin with no path. The verifier needs no SSH,
database access, operator account, or secrets. It uses only Campfire's public
HTTP APIs and Socket.IO. Output contains check names and the public origin, but
never the session cookie or TURN values.

When `CAMPFIRE_BETA_ACCESS_CODE` protects invited signups, set the matching
code in the verifier process as `CAMPFIRE_STAGING_BETA_ACCESS_CODE` before
running the command. The verifier sends it only in the HTTPS guest request body
and never prints it. Clear the verifier environment variable after the run.

The automated gate fails closed unless all of these are true:

- TLS is trusted, requests do not redirect, the database health route is
  healthy JSON, sensitive responses are `no-store`, and the proxy sends HSTS.
- Runtime app and Socket.IO URLs resolve to the same public HTTPS host, the
  Community edition has billing disabled, and anonymous callers receive no
  `turnUrls`, deprecated `turnUrl`, username, credential, or expiry.
- A disposable guest is persisted through the database write path, receives a
  host-only `Secure`, `HttpOnly`, `SameSite=Lax` cookie, and that cookie
  authenticates both HTTP and Socket.IO.
- Authenticated config contains unique, individually encoded `turnUrls`: at
  least one explicit `turn:` URL with `transport=udp`, plus a secure `turns:`
  URL using `transport=tcp` or the secure default. The deprecated `turnUrl`
  must match the first array entry. Comma-delimited pseudo-URLs, malformed
  schemes or transports, duplicates, and the legacy static-credential
  fallback are rejected. Credentials must have a future bounded expiry.
- A hostile Origin and a missing session are rejected by Socket.IO; a second
  allowed-origin connection proves those rejections were not a transient
  outage.
- Logout returns a valid cookie-clearing directive.

The verifier creates one guest record whose authentication expires after 24
hours, then logs out and discards its cookie. Campfire currently has no public
self-delete API, so the expired database row remains; do not schedule this
probe at high frequency.

For Caddy, add HSTS to the public site block before running the gate:

```caddyfile
campfire.example.com {
    header Strict-Transport-Security "max-age=31536000"
    reverse_proxy 127.0.0.1:3000
}
```

## Manual gates that remain

Passing the script does **not** prove that coturn can allocate and relay real
media. Preserve evidence from two completed calls between two real devices on
separate external networks:

1. Force TURN-only use of the explicit UDP URL, confirm bidirectional media,
   and capture the selected relay candidate pair with `relayProtocol` `udp`.
2. Force TURN-only use of the secure `turns:` URL, confirm bidirectional media,
   and capture the selected relay candidate pair with `relayProtocol` `tls`.

An allocated candidate without a working two-device call is not sufficient.
The script also cannot grant or validate real browser hardware permissions. On
both physical devices, exercise microphone, camera, screen sharing, device
unplug/replug, and reconnect before the beta go/no-go decision.
