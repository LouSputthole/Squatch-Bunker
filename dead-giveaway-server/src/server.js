// Dead Giveaway — authoritative game server.
//
// One HTTP server: socket.io on /dg/socket, GET /dg/health, and (optionally)
// static files from DG_STATIC_DIR so LAN play is same-origin. All game state
// lives in memory in src/rooms.js + src/rules.js. One 250 ms interval drives
// every timed phase and the disconnect grace. Wire contract: PROTOCOL.md.

import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Server } from 'socket.io';

import * as rules from './rules.js';
import { createRegistry, normalizeCode, DEFAULT_GRACE_MS, DEFAULT_MAX_ROOMS } from './rooms.js';
import { loadDeck, DEFAULT_CARDS_DIR } from './cards.js';
import { assertTurnConfiguration, iceServersFor } from './turn.js';
import { isPlainObject, isFiniteNumber, jsonSize, createLimiter, safe } from './guards.js';

export const SOCKET_PATH = '/dg/socket';
export const HEALTH_PATH = '/dg/health';
export const TICK_MS = 250;
export const MAX_SIGNAL_BYTES = 64 * 1024;
export const MAX_PACKET_BYTES = 100 * 1024;

// Events per second (rate) and burst per player (or per socket before it has
// joined a room). PROTOCOL.md "Rate limits".
export const LIMITS = Object.freeze({
  pose: [15, 15],
  act: [2, 2],
  chat: [3, 3],
  'media:state': [5, 5],
  'media:speaking': [10, 10],
  'rtc:hello': [1, 1],
  'rtc:signal': [60, 60],
  'room:create': [0.5, 5],
  'room:join': [0.5, 5],
  'room:leave': [2, 5],
  'turn:get': [1, 5],
  intent: [10, 10], // every player:* and game:* event, each its own bucket
});

export const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
});

const fail = (error, message) => ({ ok: false, error, message: message || error });
const roomKey = (code) => `dg:${code}`;

function defaultLog(line) {
  console.log(`[dg] ${new Date().toISOString()} ${line}`);
}

function intEnv(value, fallback) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * DG_TIMINGS: a JSON object of phase clocks in ms over rules.TIMINGS, e.g.
 * {"CLUE":300000,"LAST_WORD":300000}. For slow automated runs: the
 * three-browser verifier drives a software rasteriser where one screenshot
 * outlasted both the 40 s clue clock and the 60 s Last Word. Unknown keys and
 * non-positive values are dropped; bad JSON is logged and ignored.
 */
export function envTimings(raw, log = () => {}) {
  if (!raw) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    log('DG_TIMINGS is not JSON; using the default timings');
    return {};
  }
  const out = {};
  for (const [key, value] of Object.entries(parsed && typeof parsed === 'object' ? parsed : {})) {
    if (key in rules.TIMINGS && Number.isFinite(value) && value > 0) out[key] = value;
  }
  return out;
}

// ─── static files ─────────────────────────────────────────────────────────

/** Resolve a request path inside `root`, or null. Rejects traversal, NULs and dotfiles. */
export async function resolveStatic(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const segments = decoded.split('/').filter(Boolean);
  // No "..", no hidden files or directories (a checkout's .git must not be served).
  if (segments.some((s) => s === '..' || s.startsWith('.'))) return null;
  let full = path.resolve(root, ...segments);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  try {
    let st = await stat(full);
    if (st.isDirectory()) {
      full = path.join(full, 'index.html');
      st = await stat(full);
    }
    if (!st.isFile()) return null;
    // A symlink must not lead out of the root.
    const real = await realpath(full);
    if (real !== root && !real.startsWith(root + path.sep)) return null;
    return { file: real, size: st.size };
  } catch {
    return null;
  }
}

function createHttpHandler({ staticRoot }) {
  return safe('http', async (req, res) => {
    const send = (status, body, type = 'text/plain; charset=utf-8') => {
      res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), 'X-Content-Type-Options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    let pathname;
    try {
      pathname = new URL(req.url || '/', 'http://localhost').pathname;
    } catch {
      return send(400, 'Bad request\n');
    }
    if (pathname === HEALTH_PATH) {
      res.setHeader('Cache-Control', 'no-store');
      return send(200, JSON.stringify({ ok: true }), 'application/json; charset=utf-8');
    }
    if (!staticRoot) return send(404, 'Not found\n');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      return send(405, 'Method not allowed\n');
    }
    const hit = await resolveStatic(staticRoot, pathname);
    if (!hit) return send(404, 'Not found\n');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(hit.file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': hit.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    const stream = createReadStream(hit.file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }, (err) => {
    console.error('[dg] http handler failed:', err);
  });
}

// ─── the server ───────────────────────────────────────────────────────────

/**
 * Start listening. Every option falls back to its environment variable.
 * Resolves to { httpServer, io, registry, port, host, close() }.
 */
export async function startServer(options = {}) {
  const env = options.env || process.env;
  const log = options.log || defaultLog;
  const port = options.port ?? intEnv(env.DG_PORT, 3100);
  const host = options.host ?? (env.DG_HOST || '0.0.0.0');
  const graceMs = options.graceMs ?? intEnv(env.DG_DISCONNECT_GRACE_MS, DEFAULT_GRACE_MS);
  const maxRooms = options.maxRooms ?? intEnv(env.DG_MAX_ROOMS, DEFAULT_MAX_ROOMS);
  const tickMs = options.tickMs ?? TICK_MS;
  const corsRaw = options.corsOrigins ?? env.DG_CORS_ORIGINS ?? '';
  const corsList = corsRaw.split(',').map((s) => s.trim()).filter(Boolean);
  const corsAny = corsList.length === 0 || corsList.includes('*');
  const staticDirRaw = options.staticDir ?? env.DG_STATIC_DIR ?? '';
  const staticRoot = staticDirRaw ? await realpath(path.resolve(staticDirRaw)) : null;

  const turnConfig = assertTurnConfiguration(env);
  if (turnConfig.mode === 'disabled' && turnConfig.partial) {
    log('turn: incomplete TURN configuration ignored (set TURN_URLS or TURN_URL and TURN_AUTH_SECRET); STUN only');
  }

  const deckResult = options.deck ? { cards: options.deck, errors: [] } : loadDeck(options.cardsDir ?? env.DG_CARDS_DIR ?? DEFAULT_CARDS_DIR);
  for (const e of deckResult.errors) log(`cards: skipped ${e.source}${e.id ? ` (${e.id})` : ''}: ${e.errors.join('; ')}`);
  if (!deckResult.cards.length) throw new Error('No valid cards loaded; refusing to start.');

  const registry = createRegistry({
    deck: deckResult.cards,
    graceMs,
    maxRooms,
    random: options.random,
    timings: { ...envTimings(env.DG_TIMINGS, log), ...options.timings },
    settings: options.settings,
  });
  const limiter = createLimiter();

  const httpServer = http.createServer(createHttpHandler({ staticRoot }));
  const io = new Server(httpServer, {
    path: SOCKET_PATH,
    serveClient: false,
    maxHttpBufferSize: MAX_PACKET_BYTES,
    // A tab rendering a 3D room on a slow GPU can stall its event loop past
    // engine.io's 20 s default; a seat is worth a minute of patience.
    pingTimeout: 60000,
    cors: corsAny ? { origin: '*' } : { origin: corsList },
    // CORS headers do not cover WebSocket upgrades, so enforce the list here
    // too. No Origin (a native client) and same-origin pages always pass.
    allowRequest: (req, cb) => {
      if (corsAny) return cb(null, true);
      const origin = req.headers.origin;
      if (!origin || corsList.includes(origin)) return cb(null, true);
      try {
        if (new URL(origin).host === req.headers.host) return cb(null, true);
      } catch {
        /* fall through */
      }
      cb('origin not allowed', false);
    },
  });

  /** socket.id → { code, playerId } */
  const contexts = new Map();
  /** code → last phase logged */
  const lastPhase = new Map();

  function broadcastState(code) {
    const entry = registry.get(code);
    if (!entry) return;
    const game = entry.game;
    if (lastPhase.get(code) !== game.phase) {
      lastPhase.set(code, game.phase);
      log(`${code} phase ${game.phase}${game.round ? ` round ${game.round}` : ''}`);
    }
    for (const p of game.players) {
      const sid = entry.sockets.get(p.id);
      if (sid) io.to(sid).emit('state', rules.snapshotFor(game, p.id));
    }
  }

  function closeRoomSockets(code, reason) {
    io.to(roomKey(code)).emit('room:closed', { reason });
    io.in(roomKey(code)).socketsLeave(roomKey(code));
    for (const ctx of contexts.values()) {
      if (ctx.code === code) {
        ctx.code = null;
        ctx.playerId = null;
      }
    }
    lastPhase.delete(code);
  }

  io.on('connection', (socket) => {
    const ctx = { code: null, playerId: null };
    contexts.set(socket.id, ctx);
    const lastSoftError = new Map();

    const limitKey = (event) => `${ctx.playerId || socket.id}:${event}`;
    const allowed = (event, limitName = event) => {
      const [rate, burst] = LIMITS[limitName];
      return limiter.allow(limitKey(event), rate, burst);
    };

    // Rejections of fire-and-forget events: an `error` event, at most once a
    // second per event and code so a flood is not answered with a flood.
    function softError(event, code, message) {
      const key = `${event}:${code}`;
      const t = Date.now();
      if ((lastSoftError.get(key) || 0) > t - 1000) return;
      lastSoftError.set(key, t);
      socket.emit('error', { code, message: message || `${event}: ${code}` });
    }

    function current() {
      if (!ctx.code) return null;
      const entry = registry.get(ctx.code);
      const player = entry && rules.findPlayer(entry.game, ctx.playerId);
      if (!player) {
        ctx.code = null;
        ctx.playerId = null;
        return null;
      }
      return { entry, player, code: ctx.code, playerId: ctx.playerId };
    }

    function withAck(event, limitName, fn) {
      socket.on(event, (payload, ack) => {
        if (typeof payload === 'function' && ack === undefined) {
          ack = payload;
          payload = undefined;
        }
        const reply = typeof ack === 'function' ? ack : () => {};
        let answer;
        try {
          if (!allowed(event, limitName)) answer = fail('rate_limited', 'Slow down.');
          else if (payload !== undefined && payload !== null && !isPlainObject(payload)) answer = fail('invalid', 'Payload must be an object.');
          else answer = fn(payload || {}) || { ok: true };
        } catch (err) {
          console.error(`[dg] handler ${event} failed:`, err);
          answer = fail('invalid', 'Server error.');
        }
        try {
          reply(answer);
        } catch (err) {
          console.error(`[dg] ack ${event} failed:`, err);
        }
      });
    }

    function fire(event, fn) {
      socket.on(event, safe(event, (payload) => {
        const here = current();
        if (!here) return softError(event, 'room_not_found', 'Not in a room.');
        if (!allowed(event)) return softError(event, 'rate_limited', 'Slow down.');
        if (!isPlainObject(payload)) return softError(event, 'invalid', 'Payload must be an object.');
        fn(payload, here);
      }));
    }

    function bind(res) {
      ctx.code = res.code;
      ctx.playerId = res.playerId;
      registry.attachSocket(res.code, res.playerId, socket.id);
      socket.join(roomKey(res.code));
      const prev = res.previousSocketId;
      if (prev && prev !== socket.id) {
        const old = io.sockets.sockets.get(prev);
        const oldCtx = contexts.get(prev);
        if (oldCtx) {
          oldCtx.code = null;
          oldCtx.playerId = null;
        }
        if (old) {
          old.leave(roomKey(res.code));
          old.emit('room:closed', { reason: 'replaced' });
        }
      }
    }

    function leaveCurrent(why) {
      const here = current();
      if (!here) return;
      const result = registry.leave(here.code, here.playerId, Date.now());
      socket.leave(roomKey(here.code));
      log(`${here.code} leave ${here.playerId} (${why})`);
      ctx.code = null;
      ctx.playerId = null;
      if (result.closed) {
        log(`${here.code} closed (empty)`);
        closeRoomSockets(here.code, 'empty');
      } else broadcastState(here.code);
    }

    function clientIdOk(clientId) {
      return clientId === undefined || (typeof clientId === 'string' && clientId.length <= 128);
    }

    withAck('room:create', 'room:create', (p) => {
      if (!clientIdOk(p.clientId)) return fail('invalid', 'Bad clientId.');
      leaveCurrent('switching tables');
      const res = registry.create({ name: p.name, character: p.character }, Date.now());
      if (!res.ok) return res;
      bind(res);
      log(`${res.code} create by ${res.playerId} "${res.player.name}" seat ${res.player.seat}`);
      broadcastState(res.code);
      return { ok: true, code: res.code, playerId: res.playerId, token: res.token, state: rules.snapshotFor(res.entry.game, res.playerId) };
    });

    withAck('room:join', 'room:join', (p) => {
      if (!clientIdOk(p.clientId)) return fail('invalid', 'Bad clientId.');
      if (p.token !== undefined && p.token !== null && typeof p.token !== 'string') return fail('invalid', 'Bad token.');
      const code = normalizeCode(p.code);
      if (!code || !registry.get(code)) return fail('room_not_found', 'No table with that code.');
      const here = current();
      const sameSeat = here && here.code === code && p.token && here.entry.tokens.get(here.playerId) === p.token;
      if (here && !sameSeat) leaveCurrent('switching tables');
      const res = registry.join({ code, name: p.name, character: p.character, token: p.token || null }, Date.now());
      if (!res.ok) return res;
      bind(res);
      log(`${res.code} ${res.rejoined ? 'rejoin' : 'join'} ${res.playerId} "${res.player.name}" seat ${res.player.seat}`);
      broadcastState(res.code);
      return { ok: true, playerId: res.playerId, token: res.token, state: rules.snapshotFor(res.entry.game, res.playerId) };
    });

    withAck('room:leave', 'room:leave', () => {
      leaveCurrent('left');
      return { ok: true };
    });

    for (const event of rules.INTENT_EVENTS) {
      withAck(event, 'intent', (p) => {
        const here = current();
        if (!here) return fail('room_not_found', 'Not in a room.');
        const res = rules.applyIntent(here.entry.game, here.playerId, event, p, Date.now());
        if (!res.ok) return { ok: false, error: res.error, message: res.message };
        log(`${here.code} ${event} by ${here.playerId}`);
        broadcastState(here.code);
        return { ok: true };
      });
    }

    withAck('turn:get', 'turn:get', () => {
      const here = current();
      if (!here) return fail('room_not_found', 'turn:get is answered only inside a room.');
      const { iceServers, expiresAt } = iceServersFor(turnConfig, here.playerId);
      return { ok: true, iceServers, expiresAt };
    });

    fire('pose', (p, here) => {
      const { yaw, pitch } = p;
      if (!isFiniteNumber(yaw) || !isFiniteNumber(pitch) || Math.abs(yaw) > 1000 || Math.abs(pitch) > 1000) {
        return softError('pose', 'invalid', 'yaw and pitch must be finite radians.');
      }
      socket.to(roomKey(here.code)).volatile.emit('pose', { playerId: here.playerId, yaw, pitch });
    });

    fire('act', (p, here) => {
      if (!rules.ACT_KINDS.includes(p.kind)) return softError('act', 'invalid', 'Unknown action.');
      const out = { playerId: here.playerId, kind: p.kind, ts: Date.now() };
      /* An aimed gesture (a spit that lands on somebody) names its target. A
       * target that is not another player at this table is dropped, never
       * refused: the gesture still plays, just at nobody. */
      if (typeof p.target === 'string' && p.target !== here.playerId && rules.findPlayer(here.entry.game, p.target)) {
        out.target = p.target;
      }
      socket.to(roomKey(here.code)).emit('act', out);
    });

    fire('chat', (p, here) => {
      const text = typeof p.text === 'string' && p.text.length <= rules.CHAT_MAX_LEN * 4 ? rules.cleanText(p.text) : null;
      if (!text || text.length > rules.CHAT_MAX_LEN) {
        return softError('chat', 'invalid', `Chat is 1-${rules.CHAT_MAX_LEN} characters.`);
      }
      io.to(roomKey(here.code)).emit('chat', { playerId: here.playerId, name: here.player.name, text, ts: Date.now() });
    });

    fire('media:state', (p, here) => {
      const res = rules.setMedia(here.entry.game, here.playerId, p);
      if (!res.ok) return softError('media:state', res.error, res.message);
      if (res.changed) broadcastState(here.code);
    });

    fire('media:speaking', (p, here) => {
      if (typeof p.speaking !== 'boolean') return softError('media:speaking', 'invalid', 'speaking must be a boolean.');
      socket.to(roomKey(here.code)).emit('media:speaking', { playerId: here.playerId, speaking: p.speaking });
    });

    fire('rtc:hello', (_p, here) => {
      socket.to(roomKey(here.code)).emit('rtc:hello', { playerId: here.playerId, joinSeq: here.player.joinSeq });
    });

    fire('rtc:signal', (p, here) => {
      if (typeof p.to !== 'string' || p.to === here.playerId || !isPlainObject(p.data)) {
        return softError('rtc:signal', 'invalid', 'rtc:signal needs {to, data}.');
      }
      if (jsonSize(p.data) > MAX_SIGNAL_BYTES) return softError('rtc:signal', 'invalid', 'Signal too large.');
      // Only relay to a player seated in the SAME room, at their current socket.
      if (!rules.findPlayer(here.entry.game, p.to)) return softError('rtc:signal', 'bad_target', 'No such player here.');
      const sid = registry.socketOf(here.code, p.to);
      if (!sid) return softError('rtc:signal', 'bad_target', 'That player is not connected.');
      io.to(sid).emit('rtc:signal', { from: here.playerId, data: p.data });
    });

    socket.on('disconnect', safe('disconnect', () => {
      contexts.delete(socket.id);
      if (!ctx.code) return;
      const res = registry.disconnect(ctx.code, ctx.playerId, socket.id, Date.now());
      if (res.changed) {
        log(`${ctx.code} disconnect ${ctx.playerId} (grace ${graceMs} ms)`);
        broadcastState(ctx.code);
      }
    }));
  });

  const timer = setInterval(safe('tick', () => {
    const now = Date.now();
    for (const rec of registry.tick(now)) {
      for (const pid of rec.expired) log(`${rec.code} grace expired ${pid}`);
      if (rec.closed) {
        log(`${rec.code} closed (reaped)`);
        closeRoomSockets(rec.code, 'expired');
      } else broadcastState(rec.code);
    }
    limiter.prune();
  }), tickMs);

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });
  const actualPort = httpServer.address().port;

  let closing = null;
  function close() {
    if (closing) return closing;
    clearInterval(timer);
    io.emit('room:closed', { reason: 'shutdown' });
    closing = new Promise((resolve) => {
      io.close(() => resolve());
      // Clients that ignore the close must not hold the process open.
      setTimeout(resolve, 3000).unref();
    });
    return closing;
  }

  return { httpServer, io, registry, port: actualPort, host, staticRoot, turnMode: turnConfig.mode, cards: deckResult.cards.length, close };
}

// ─── run as a program ─────────────────────────────────────────────────────

const isMain = (() => {
  try {
    return process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  process.on('uncaughtException', (err) => console.error('[dg] uncaughtException:', err));
  process.on('unhandledRejection', (err) => console.error('[dg] unhandledRejection:', err));
  startServer()
    .then((srv) => {
      defaultLog(
        `listening on http://${srv.host}:${srv.port} socket ${SOCKET_PATH} cards ${srv.cards} turn ${srv.turnMode}` +
          (srv.staticRoot ? ` static ${srv.staticRoot}` : ''),
      );
      let stopping = false;
      const stop = (signal) => {
        if (stopping) process.exit(1);
        stopping = true;
        defaultLog(`${signal}: closing`);
        srv.close().then(() => process.exit(0));
      };
      process.on('SIGINT', () => stop('SIGINT'));
      process.on('SIGTERM', () => stop('SIGTERM'));
    })
    .catch((err) => {
      console.error('[dg] failed to start:', err.message);
      process.exit(1);
    });
}

