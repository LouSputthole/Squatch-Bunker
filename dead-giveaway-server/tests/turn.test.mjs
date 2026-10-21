import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { assertTurnConfiguration, iceServersFor, mintTurnCredentials, STUN_URL } from '../src/turn.js';

const SECRET = 'a'.repeat(64);

test('STUN only when TURN is not configured', () => {
  const config = assertTurnConfiguration({});
  assert.equal(config.mode, 'disabled');
  assert.deepEqual(iceServersFor(config, 'p_1'), { iceServers: [{ urls: STUN_URL }], expiresAt: null });
});

test('TURN_URLS + TURN_AUTH_SECRET mint coturn REST credentials', () => {
  const config = assertTurnConfiguration({
    TURN_URLS: '["turn:turn.example.com:3478?transport=udp","turns:turn.example.com:5349?transport=tcp"]',
    TURN_AUTH_SECRET: SECRET,
    TURN_CREDENTIAL_TTL_SECONDS: '900',
  });
  assert.equal(config.mode, 'ephemeral');
  const now = 1_700_000_000_000;
  const { iceServers, expiresAt } = iceServersFor(config, 'p_abc', now);
  assert.equal(iceServers[0].urls, STUN_URL);
  const turn = iceServers[1];
  assert.deepEqual(turn.urls, config.urls);
  const [expiry, user] = turn.username.split(':');
  assert.equal(user, 'p_abc');
  assert.equal(Number(expiry) * 1000, expiresAt);
  assert.ok(expiresAt > now && expiresAt <= now + 900_000);
  assert.equal(turn.credential, createHmac('sha1', SECRET).update(turn.username).digest('base64'));
  // Same bucket, same username.
  assert.equal(mintTurnCredentials(SECRET, 'p_abc', { nowMs: now + 1000, ttlSeconds: 900 }).username, turn.username);
});

test('TURN_URL singular, and the guards Campfire has', () => {
  assert.equal(assertTurnConfiguration({ TURN_URL: 'turn:1.2.3.4:3478', TURN_AUTH_SECRET: SECRET }).urls[0], 'turn:1.2.3.4:3478');
  assert.throws(() => assertTurnConfiguration({ TURN_URL: 'turn:x.example', TURN_AUTH_SECRET: 'short' }), /32/);
  assert.throws(() => assertTurnConfiguration({ TURN_URLS: 'not json', TURN_AUTH_SECRET: SECRET }), /JSON/);
  assert.throws(() => assertTurnConfiguration({ TURN_URL: 'http://x', TURN_AUTH_SECRET: SECRET }), /Invalid TURN URL/);
  assert.throws(() => assertTurnConfiguration({ TURN_URL: 'turns:x.example?transport=udp', TURN_AUTH_SECRET: SECRET }), /TCP/);
  assert.throws(() => assertTurnConfiguration({ NODE_ENV: 'production', TURN_URL: 'turn:x.example' }), /Incomplete/);
  assert.equal(assertTurnConfiguration({ TURN_URL: 'turn:x.example' }).mode, 'disabled');
});
