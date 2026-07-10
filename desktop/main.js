/**
 * Campfire desktop — Electron main process.
 *
 * Boots the bundled Campfire server (Next.js + Socket.IO) as a child process of
 * Campfire.exe using Electron's embedded Node (ELECTRON_RUN_AS_NODE=1), so the
 * portable build runs with NO system Node install. The renderer just loads the
 * local server over a dynamically-chosen port (single-port mode).
 */
const { app, BrowserWindow, Tray, Menu, shell, dialog, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const net = require("net");
const http = require("http");
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
      return dd;
    } catch {
      // exe dir not writable (e.g. read-only media) — fall through to userData.
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
  } catch {
    /* not created yet */
  }
  const s = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(p, s, { mode: 0o600 });
  return s;
}

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, "settings.json"), "utf8"));
  } catch {
    return { closeToTray: true };
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(path.join(dataDir, "settings.json"), JSON.stringify(settings, null, 2));
  } catch {
    /* best effort */
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

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function writeRuntimeJson(status) {
  try {
    fs.writeFileSync(
      path.join(dataDir, "runtime.json"),
      JSON.stringify(
        { status, port: serverPort, url: serverUrl, pid: serverProcess ? serverProcess.pid : null, dataDir, updatedAt: new Date().toISOString() },
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
    const crashed = !app.isQuitting;
    serverProcess = null;
    if (crashed) handleServerCrash(code);
  });

  writeRuntimeJson("starting");
}

function killServer() {
  const proc = serverProcess;
  serverProcess = null;
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
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
  const b = settings.bounds || {};
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
  } catch {
    return; // tray unavailable — app still works, close will just quit
  }
  tray.setToolTip("Campfire");
  refreshTrayMenu();
  tray.on("double-click", showMainWindow);
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Campfire", click: showMainWindow },
      { type: "separator" },
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
    ]),
  );
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

// ─── Boot ───

async function boot() {
  Menu.setApplicationMenu(null);
  dataDir = resolveDataDir();
  jwtSecret = getOrCreateSecret();
  settings = loadSettings();
  if (typeof settings.closeToTray !== "boolean") settings.closeToTray = true;
  saveSettings(); // persist resolved defaults on first run; bounds are added later
  openLog();

  createSplash();

  try {
    serverPort = await findFreePort();
  } catch {
    serverPort = 3000;
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

  writeRuntimeJson("ready");
  createTray();
  createMainWindow();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", showMainWindow);

  app.whenReady().then(boot);

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
