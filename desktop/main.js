/**
 * Campfire desktop — Electron main process.
 *
 * Boots the bundled Campfire server (Next.js + Socket.IO) as a child process of
 * Campfire.exe using Electron's embedded Node (ELECTRON_RUN_AS_NODE=1), so the
 * portable build runs with NO system Node install. The renderer just loads the
 * local server over a dynamically-chosen port (single-port mode).
 */
const { app, BrowserWindow, Tray, Menu, shell, dialog, nativeImage, screen, clipboard } = require("electron");
const path = require("path");
const fs = require("fs");
const net = require("net");
const os = require("os");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const { spawn } = require("child_process");

// ─── Resource locations ───
const SERVER_DIR = app.isPackaged
  ? path.join(process.resourcesPath, "server")
  : path.join(__dirname, "..", "squatch-chat", ".next", "standalone");
const MIGRATIONS_DIR = app.isPackaged
  ? path.join(process.resourcesPath, "db-migrations")
  : path.join(__dirname, "db-migrations");
const SERVER_ENTRY = path.join(SERVER_DIR, "server-desktop.js");

const MIN_WIDTH = 940;
const MIN_HEIGHT = 600;
const STARTUP_TIMEOUT_MS = 30000;
const LOG_MAX_BYTES = 2 * 1024 * 1024;
// Fixed preferred port for LAN sharing so the link friends use survives
// restarts. Falls back to a random port if something else owns it.
const LAN_PORT = 3939;
const UPDATE_REPO = "LouSputthole/Squatch-Bunker";

// ─── State ───
let mainWindow = null;
let splashWindow = null;
let tray = null;
let serverProcess = null;
let serverPort = 0;
let serverUrl = "";
let dataDir = "";
let jwtSecret = "";
let logStream = null;
let logFile = "";
const logRing = []; // last N server log lines for crash/startup dialogs
let settings = {};
let saveBoundsTimer = null;
let dataDirMode = "installed"; // "portable" | "installed" | "portable-fallback"
let bootComplete = false;
let expectedExit = false; // killServer() was called — the next server exit is not a crash
let rebinding = false;

app.isQuitting = false;

// ─── Data dir, secret, settings ───

/**
 * Portable when a `portable.txt` sits next to the exe AND `<exeDir>\data` is
 * writable — then all state lives beside the app so the folder is self-contained
 * and movable (USB). Otherwise fall back to the per-user app data dir.
 */
function resolveDataDir() {
  const exeDir = path.dirname(app.getPath("exe"));
  if (fs.existsSync(path.join(exeDir, "portable.txt"))) {
    const dd = path.join(exeDir, "data");
    try {
      fs.mkdirSync(dd, { recursive: true });
      fs.accessSync(dd, fs.constants.W_OK);
      dataDirMode = "portable";
      return dd;
    } catch {
      // exe dir not writable (e.g. read-only media) — fall through to userData.
      // Logged in boot(): the user's data will NOT travel with the folder.
      dataDirMode = "portable-fallback";
    }
  }
  const dd = app.getPath("userData");
  fs.mkdirSync(dd, { recursive: true });
  return dd;
}

/** Generate the server-side JWT secret once and reuse it (same posture as a
 * self-host .env JWT_SECRET). */
function getOrCreateSecret() {
  const p = path.join(dataDir, "secret");
  try {
    const s = fs.readFileSync(p, "utf8").trim();
    if (s.length >= 32) return s;
    logLine(`[main] secret file is truncated (${s.length} chars) — regenerating; all sessions will be logged out`);
  } catch (err) {
    // ENOENT is the normal first-run case; anything else (permissions, I/O)
    // must be visible — regenerating silently logs every user out.
    if (err.code !== "ENOENT") {
      logLine(`[main] could not read secret file (${err.message}) — regenerating; all sessions will be logged out`);
    }
  }
  const s = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(p, s, { mode: 0o600 });
  return s;
}

function loadSettings() {
  const p = path.join(dataDir, "settings.json");
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") {
      // Corrupt/unreadable — keep the evidence, because boot() saves defaults
      // right over this file.
      try {
        fs.copyFileSync(p, p + ".corrupt");
      } catch {
        /* nothing to back up */
      }
      logLine(`[main] settings.json unreadable (${err.message}) — backed up to settings.json.corrupt, using defaults`);
    }
    return { closeToTray: true };
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(path.join(dataDir, "settings.json"), JSON.stringify(settings, null, 2));
  } catch (err) {
    logLine(`[main] failed to save settings.json: ${err.message}`);
  }
}

// ─── Logging ───

function openLog() {
  const logDir = path.join(dataDir, "logs");
  fs.mkdirSync(logDir, { recursive: true });
  logFile = path.join(logDir, "server.log");
  try {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > LOG_MAX_BYTES) {
      fs.renameSync(logFile, logFile + ".old");
    }
  } catch {
    /* ignore rotation errors */
  }
  logStream = fs.createWriteStream(logFile, { flags: "a" });
}

function logLine(line) {
  const text = line.toString();
  for (const l of text.split(/\r?\n/)) {
    if (!l) continue;
    logRing.push(l);
    if (logRing.length > 200) logRing.shift();
  }
  if (logStream) logStream.write(text.endsWith("\n") ? text : text + "\n");
}

// ─── Server lifecycle ───

function listenProbe(port, host) {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(port, host, () => {
      const chosen = srv.address().port;
      srv.close(() => resolve(chosen));
    });
  });
}

async function pickPort() {
  if (settings.lanSharing) {
    try {
      return await listenProbe(LAN_PORT, "0.0.0.0");
    } catch {
      logLine(`[main] preferred LAN port ${LAN_PORT} is busy — using a random port (the LAN link will change)`);
    }
    return listenProbe(0, "0.0.0.0");
  }
  return listenProbe(0, "127.0.0.1");
}

/** Best LAN address to hand to friends: prefer private-range IPv4 so a VPN or
 * virtual adapter doesn't win. ponytail: first match, no NIC ranking beyond this. */
function lanUrl() {
  const all = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === "IPv4" && !ni.internal) all.push(ni.address);
    }
  }
  const pick =
    all.find((a) => a.startsWith("192.168.")) ||
    all.find((a) => a.startsWith("10.")) ||
    all[0];
  return pick ? `http://${pick}:${serverPort}` : null;
}

function writeRuntimeJson(status) {
  try {
    fs.writeFileSync(
      path.join(dataDir, "runtime.json"),
      JSON.stringify(
        { status, port: serverPort, url: serverUrl, lan: !!settings.lanSharing, lanUrl: settings.lanSharing ? lanUrl() : null, pid: serverProcess ? serverProcess.pid : null, dataDir, dataDirMode, updatedAt: new Date().toISOString() },
        null,
        2,
      ),
    );
  } catch {
    /* best effort — used for debugging/tests */
  }
}

function startServer() {
  const dbPath = path.join(dataDir, "campfire.db").replace(/\\/g, "/");
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    NODE_ENV: "production",
    CAMPFIRE_PARENT_PID: String(process.pid),
    PORT: String(serverPort),
    CAMPFIRE_HOST: settings.lanSharing ? "0.0.0.0" : "127.0.0.1",
    DATABASE_URL: `file:${dbPath}`,
    JWT_SECRET: jwtSecret,
    CAMPFIRE_UPLOAD_DIR: dataDir,
    CAMPFIRE_MIGRATIONS_DIR: MIGRATIONS_DIR,
  };
  // Never let a stale two-port dev URL leak into the single-port desktop client.
  delete env.NEXT_PUBLIC_SOCKET_URL;
  delete env.NEXT_PUBLIC_APP_URL;

  serverProcess = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: SERVER_DIR,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProcess.stdout.on("data", logLine);
  serverProcess.stderr.on("data", logLine);
  serverProcess.on("error", (err) => logLine(`[main] server spawn error: ${err.message}`));
  serverProcess.on("exit", (code, signal) => {
    logLine(`[main] server exited (code=${code}, signal=${signal})`);
    const crashed = !app.isQuitting && !expectedExit;
    expectedExit = false;
    serverProcess = null;
    // During boot, waitForHttp's timeout owns error reporting — two competing
    // dialogs (crash + startup) would race and double-restart the server.
    if (crashed && bootComplete) handleServerCrash(code);
  });

  writeRuntimeJson("starting");
}

function killServer() {
  const proc = serverProcess;
  serverProcess = null;
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
  expectedExit = true;
  proc.kill();
  // Windows: if it hasn't died in 3s, force-kill the whole tree.
  setTimeout(() => {
    if (proc.exitCode === null && proc.signalCode === null && proc.pid) {
      if (process.platform === "win32") {
        try {
          spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { windowsHide: true });
        } catch {
          /* ignore */
        }
      } else {
        try {
          proc.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }
    }
  }, 3000);
}

function waitForHttp(port, timeout) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const attempt = () => {
      const req = http.get({ host: "127.0.0.1", port, path: "/", timeout: 2000 }, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", retry);
      req.on("timeout", () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - start > timeout) return reject(new Error(`Server did not respond within ${timeout}ms`));
      setTimeout(attempt, 300);
    };
    attempt();
  });
}

function restartServer() {
  killServer();
  setTimeout(() => {
    startServer();
    waitForHttp(serverPort, STARTUP_TIMEOUT_MS)
      .then(() => {
        writeRuntimeJson("ready");
        if (mainWindow) mainWindow.reload();
      })
      .catch(() => showStartupError());
  }, 500);
}

/** Restart the server on a freshly-picked port/interface after the LAN toggle
 * changed. Unlike restartServer(), the port can change, so the window must
 * loadURL rather than reload. */
async function rebindServer() {
  if (rebinding) return;
  rebinding = true;
  refreshTrayMenu();
  killServer();
  await new Promise((r) => setTimeout(r, 500));
  try {
    serverPort = await pickPort();
  } catch (err) {
    logLine(`[main] could not allocate a local port: ${err.message}`);
    rebinding = false;
    showStartupError();
    return;
  }
  serverUrl = `http://127.0.0.1:${serverPort}`;
  startServer();
  try {
    await waitForHttp(serverPort, STARTUP_TIMEOUT_MS);
  } catch {
    rebinding = false;
    showStartupError();
    return;
  }
  rebinding = false;
  writeRuntimeJson("ready");
  if (mainWindow) mainWindow.loadURL(serverUrl);
  refreshTrayMenu(); // port may have changed → copy-link label
}

function toggleLanSharing() {
  settings.lanSharing = !settings.lanSharing;
  saveSettings();
  const turnedOn = settings.lanSharing;
  rebindServer().then(() => {
    if (!turnedOn || !settings.lanSharing) return;
    const url = lanUrl();
    dialog.showMessageBox(mainWindow || undefined, {
      type: "info",
      title: "Campfire",
      message: "LAN sharing is on.",
      detail:
        `${url ? `Friends on your network can join at:\n${url}\n\n` : "No network address found — check your connection.\n\n"}` +
        "If Windows asks to allow Campfire through the firewall, click Allow.\n\n" +
        "Anyone on your local network can reach this Campfire's login page while sharing is on.",
      buttons: url ? ["Copy link", "OK"] : ["OK"],
      defaultId: 0,
      noLink: true,
    }).then(({ response }) => {
      if (url && response === 0) clipboard.writeText(url);
    });
  });
}

function handleServerCrash(code) {
  const detail = `The Campfire server stopped unexpectedly (exit code ${code}).\n\nLog file:\n${logFile}\n\nRecent log:\n${logRing.slice(-20).join("\n")}`;
  const choice = dialog.showMessageBoxSync(mainWindow || undefined, {
    type: "error",
    title: "Campfire",
    message: "Campfire's local server stopped.",
    detail,
    buttons: ["Restart Campfire", "Quit"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (choice === 0) restartServer();
  else {
    app.isQuitting = true;
    app.quit();
  }
}

function showStartupError() {
  writeRuntimeJson("error");
  if (splashWindow) {
    splashWindow.close();
    splashWindow = null;
  }
  dialog.showMessageBoxSync({
    type: "error",
    title: "Campfire",
    message: "Campfire could not start.",
    detail: `The local server did not come up in time.\n\nLog file:\n${logFile}\n\nRecent log:\n${logRing.slice(-20).join("\n")}`,
    buttons: ["Quit"],
    noLink: true,
  });
  app.isQuitting = true;
  app.quit();
}

// ─── Windows ───

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 300,
    height: 350,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    show: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  splashWindow.loadFile(path.join(__dirname, "splash.html"));
  splashWindow.center();
}

function iconPath() {
  const dir = path.join(__dirname, "icons");
  if (process.platform === "win32") return path.join(dir, "icon.ico");
  if (process.platform === "darwin") return path.join(dir, "icon.png");
  return path.join(dir, "icon.png");
}

function isLocalUrl(url) {
  try {
    const u = new URL(url);
    return (
      (u.hostname === "127.0.0.1" || u.hostname === "localhost") &&
      Number(u.port) === serverPort &&
      (u.protocol === "http:" || u.protocol === "https:")
    );
  } catch {
    return false;
  }
}

function openExternalSafe(url) {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
}

function createMainWindow() {
  let b = settings.bounds || {};
  // Saved position may be on a monitor that's gone (undocked laptop). Electron
  // restores it verbatim → invisible window with no recovery UI. Drop x/y and
  // let Electron center if the saved rect doesn't intersect any display.
  const onScreen =
    b.width &&
    b.height &&
    screen.getAllDisplays().some((d) => {
      const wa = d.workArea;
      return b.x < wa.x + wa.width && b.x + b.width > wa.x && b.y < wa.y + wa.height && b.y + b.height > wa.y;
    });
  if (!onScreen) b = { width: b.width, height: b.height };
  mainWindow = new BrowserWindow({
    width: b.width || 1280,
    height: b.height || 800,
    x: b.x,
    y: b.y,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: "Campfire",
    icon: iconPath(),
    show: false,
    backgroundColor: "#17110d",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  mainWindow.removeMenu();

  mainWindow.loadURL(serverUrl);

  mainWindow.once("ready-to-show", () => {
    if (splashWindow) {
      splashWindow.close();
      splashWindow = null;
    }
    if (settings.maximized) mainWindow.maximize();
    mainWindow.show();
    mainWindow.focus();
  });

  // Keep the app to the local server; open anything else in the real browser.
  mainWindow.webContents.on("will-navigate", (e, url) => {
    if (!isLocalUrl(url)) {
      e.preventDefault();
      openExternalSafe(url);
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: "deny" };
  });

  const persistBounds = () => {
    if (!mainWindow) return;
    clearTimeout(saveBoundsTimer);
    saveBoundsTimer = setTimeout(() => {
      if (!mainWindow) return;
      settings.maximized = mainWindow.isMaximized();
      if (!mainWindow.isMaximized() && !mainWindow.isMinimized()) {
        settings.bounds = mainWindow.getBounds();
      }
      saveSettings();
    }, 400);
  };
  mainWindow.on("resize", persistBounds);
  mainWindow.on("move", persistBounds);

  mainWindow.on("close", (e) => {
    if (settings.closeToTray && !app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ─── Tray ───

function createTray() {
  try {
    const img = nativeImage.createFromPath(path.join(__dirname, "icons", "tray-icon.png"));
    tray = new Tray(img.isEmpty() ? iconPath() : img);
  } catch (err) {
    // No tray = no way to unhide or quit a hidden window. Make close actually
    // quit for this session (don't persist — the user's preference stands).
    logLine(`[main] tray unavailable (${err.message}) — close button will quit`);
    settings.closeToTray = false;
    return;
  }
  tray.setToolTip("Campfire");
  refreshTrayMenu();
  tray.on("double-click", showMainWindow);
}

function refreshTrayMenu() {
  if (!tray) return;
  const items = [
    { label: "Open Campfire", click: showMainWindow },
    { type: "separator" },
    {
      label: "Share on this network",
      type: "checkbox",
      checked: !!settings.lanSharing,
      enabled: !rebinding,
      click: toggleLanSharing,
    },
  ];
  if (settings.lanSharing) {
    const url = lanUrl();
    items.push({
      label: url ? `Copy LAN link  (${url})` : "LAN link unavailable (no network)",
      enabled: !!url && !rebinding,
      click: () => {
        const u = lanUrl(); // re-read at click time — the menu label may be stale
        if (u) clipboard.writeText(u);
      },
    });
  }
  items.push(
    { type: "separator" },
    { label: "Check for updates…", click: () => checkForUpdates(true) },
    {
      label: "Close button quits",
      type: "checkbox",
      checked: settings.closeToTray === false,
      click: (item) => {
        settings.closeToTray = !item.checked;
        saveSettings();
        refreshTrayMenu();
      },
    },
    { type: "separator" },
    {
      label: "Quit Campfire",
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  );
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

function showMainWindow() {
  if (!mainWindow) {
    createMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// ─── Update check ───

function fetchLatestRelease() {
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        host: "api.github.com",
        path: `/repos/${UPDATE_REPO}/releases/latest`,
        headers: { "User-Agent": "Campfire", Accept: "application/vnd.github+json" },
        timeout: 10000,
      },
      (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => {
          if (res.statusCode === 404) return resolve(null); // no releases published yet
          if (res.statusCode !== 200) return reject(new Error(`GitHub API responded ${res.statusCode}`));
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("update check timed out")));
  });
}

/** Numeric dotted compare; ignores a leading "v". Returns >0 if a is newer. */
function cmpVersions(a, b) {
  const parse = (v) => String(v).replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

async function checkForUpdates(interactive) {
  let rel;
  try {
    rel = await fetchLatestRelease();
  } catch (err) {
    logLine(`[main] update check failed: ${err.message}`);
    if (interactive) {
      dialog.showMessageBox(mainWindow || undefined, {
        type: "warning",
        title: "Campfire",
        message: "Could not check for updates.",
        detail: err.message,
        buttons: ["OK"],
        noLink: true,
      });
    }
    return;
  }
  const current = app.getVersion();
  const latest = rel && rel.tag_name;
  if (!latest || cmpVersions(latest, current) <= 0) {
    logLine(`[main] update check: up to date (current ${current}, latest ${latest || "none published"})`);
    if (interactive) {
      dialog.showMessageBox(mainWindow || undefined, {
        type: "info",
        title: "Campfire",
        message: "You're up to date.",
        detail: `Campfire ${current} is the latest version.`,
        buttons: ["OK"],
        noLink: true,
      });
    }
    return;
  }
  if (!interactive && settings.skipUpdateVersion === latest) return;
  const { response } = await dialog.showMessageBox(mainWindow || undefined, {
    type: "info",
    title: "Campfire",
    message: `Campfire ${latest.replace(/^v/i, "")} is available`,
    detail: `You have ${current}. Your messages and settings are kept across updates.`,
    buttons: ["Download", "Later", "Skip this version"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (response === 0) openExternalSafe(rel.html_url);
  if (response === 2) {
    settings.skipUpdateVersion = latest;
    saveSettings();
  }
}

// ─── Boot ───

async function boot() {
  Menu.setApplicationMenu(null);
  dataDir = resolveDataDir();
  openLog(); // first, so everything after has a log to land in
  logLine(`[main] data dir: ${dataDir} (${dataDirMode})`);
  if (dataDirMode === "portable-fallback") {
    logLine("[main] WARNING: portable.txt is present but the app folder is not writable — data is stored per-user and will NOT move with the folder");
  }
  jwtSecret = getOrCreateSecret();
  settings = loadSettings();
  if (typeof settings.closeToTray !== "boolean") settings.closeToTray = true;
  if (typeof settings.lanSharing !== "boolean") settings.lanSharing = false;
  saveSettings(); // persist resolved defaults on first run; bounds are added later

  createSplash();

  try {
    serverPort = await pickPort();
  } catch (err) {
    // listen(0) basically never fails; a hardcoded fallback port could belong
    // to a foreign server the window would then happily load. Fail visibly.
    logLine(`[main] could not allocate a local port: ${err.message}`);
    showStartupError();
    return;
  }
  serverUrl = `http://127.0.0.1:${serverPort}`;
  writeRuntimeJson("starting");

  startServer();

  try {
    await waitForHttp(serverPort, STARTUP_TIMEOUT_MS);
  } catch {
    showStartupError();
    return;
  }

  bootComplete = true;
  writeRuntimeJson("ready");
  createTray();
  createMainWindow();

  // Auto-check only when packaged: in dev app.getVersion() is Electron's own
  // version, so the compare would be nonsense. Manual tray check still works.
  if (app.isPackaged) setTimeout(() => checkForUpdates(false), 15000);
}

function bootFailed(err) {
  // Pre-splash failures would otherwise be an app that "just doesn't launch".
  try {
    logLine(`[main] boot failed: ${err.stack || err.message}`);
  } catch {
    /* logging may itself be what failed */
  }
  dialog.showMessageBoxSync({
    type: "error",
    title: "Campfire",
    message: "Campfire could not start.",
    detail: `${err.message}\n\n${logFile ? `Log file:\n${logFile}` : "No log file could be created."}`,
    buttons: ["Quit"],
    noLink: true,
  });
  app.isQuitting = true;
  app.quit();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", showMainWindow);

  app.whenReady().then(() => boot().catch(bootFailed));

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    else showMainWindow();
  });

  app.on("window-all-closed", () => {
    // With closeToTray the window only hides, so this fires only when the user
    // actually chose to quit (closeToTray off, or quitting via tray).
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    app.isQuitting = true;
    killServer();
  });
}
