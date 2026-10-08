"use strict";

const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  clipboard,
  desktopCapturer,
  dialog,
  nativeImage,
  session,
  shell,
} = require("electron");
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { upgradeDesktopDatabase } = require("./database.cjs");
const { importLegacyDesktopState } = require("./legacy-state.cjs");

const APP_NAME = "Campfire";
const STARTUP_TIMEOUT_MS = 45_000;
// Fixed port while sharing on the LAN so the link friends saved keeps working.
const LAN_PORT = 3939;
const UPDATE_REPO = "LouSputthole/Squatch-Bunker";

let appOrigin = null;
let mainWindow = null;
let tray = null;
let serverProcess = null;
let serverLog = null;
let serverPort = null;
let quitting = false;
// True while the server is deliberately restarted (LAN toggle) — its exit is expected.
let restarting = false;
let settings = {};
let launch = null;

function configureUserDataPath() {
  const portableDirectory = process.env.PORTABLE_EXECUTABLE_DIR;
  const userDataPath = portableDirectory
    ? path.join(portableDirectory, "CampfireData")
    : path.join(app.getPath("appData"), APP_NAME);
  app.setPath("userData", userDataPath);
}

configureUserDataPath();

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on("second-instance", () => showMainWindow());

function getServerRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "server")
    : path.join(__dirname, ".stage", "server");
}

function iconPath() {
  return path.join(getServerRoot(), "public", "Campfire-Icon.png");
}

function logDesktop(message) {
  const logDirectory = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(logDirectory, { recursive: true });
  fs.appendFileSync(
    path.join(logDirectory, "desktop.log"),
    new Date().toISOString() + " " + message + "\n",
  );
  console.log(message);
}

// ─── Desktop preferences (tray behaviour, LAN sharing, skipped update) ───

function settingsPath() {
  return path.join(app.getPath("userData"), "desktop-settings.json");
}

function loadSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // Missing or malformed — fall back to defaults.
  }
  return {};
}

function saveSettings() {
  try {
    const temporaryPath = `${settingsPath()}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`);
    fs.renameSync(temporaryPath, settingsPath());
  } catch (error) {
    logDesktop(`[desktop] could not save settings: ${error.message}`);
  }
}

function ensureDesktopConfig() {
  const configPath = path.join(app.getPath("userData"), "desktop-config.json");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });

  if (fs.existsSync(configPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (typeof existing.jwtSecret === "string" && existing.jwtSecret.length >= 64) {
        return existing;
      }
    } catch {
      // Replace malformed configuration atomically below.
    }
  }

  const config = { jwtSecret: randomBytes(48).toString("hex") };
  const temporaryPath = `${configPath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, configPath);
  return config;
}

function ensureDatabase(serverRoot) {
  const dataDirectory = path.join(app.getPath("userData"), "data");
  const databasePath = path.join(dataDirectory, "campfire.db");
  fs.mkdirSync(dataDirectory, { recursive: true });

  if (!fs.existsSync(databasePath)) {
    const templatePath = path.join(serverRoot, "campfire-template.db");
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Packaged database template is missing: ${templatePath}`);
    }
    fs.copyFileSync(templatePath, databasePath, fs.constants.COPYFILE_EXCL);
  }

  upgradeDesktopDatabase({ databasePath, serverRoot });

  return databasePath;
}

function ensureUserMediaDirectory() {
  const mediaRoot = path.join(app.getPath("userData"), "media");
  fs.mkdirSync(path.join(mediaRoot, "private-uploads"), { recursive: true });
  fs.mkdirSync(path.join(mediaRoot, "uploads"), { recursive: true });
  fs.mkdirSync(path.join(mediaRoot, "avatars"), { recursive: true });
  return mediaRoot;
}

function loadStandaloneConfig(serverRoot) {
  const requiredFilesPath = path.join(serverRoot, ".next", "required-server-files.json");
  if (!fs.existsSync(requiredFilesPath)) {
    throw new Error(`Packaged Next configuration is missing: ${requiredFilesPath}`);
  }

  const requiredFiles = JSON.parse(fs.readFileSync(requiredFilesPath, "utf8"));
  if (!requiredFiles.config || typeof requiredFiles.config !== "object") {
    throw new Error(`Packaged Next configuration is invalid: ${requiredFilesPath}`);
  }
  return JSON.stringify(requiredFiles.config);
}

function probePort(port, host) {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.unref();
    socket.once("error", reject);
    socket.listen(port, host, () => {
      const address = socket.address();
      if (!address || typeof address === "string") {
        socket.close();
        reject(new Error("Could not reserve a local port"));
        return;
      }
      socket.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

/** Loopback-only unless LAN sharing is on; LAN prefers the fixed port. */
async function reservePort(lanSharing) {
  if (!lanSharing) return probePort(0, "127.0.0.1");
  try {
    return await probePort(LAN_PORT, "0.0.0.0");
  } catch {
    logDesktop(`[desktop] LAN port ${LAN_PORT} is busy; using a random port (the LAN link will differ)`);
    return probePort(0, "0.0.0.0");
  }
}

/** Best address to hand to friends: prefer private-range IPv4 so a VPN adapter doesn't win.
 * ponytail: first match, no NIC ranking beyond this. */
function lanUrl() {
  const addresses = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const nic of list || []) {
      if (nic.family === "IPv4" && !nic.internal) addresses.push(nic.address);
    }
  }
  const pick =
    addresses.find((address) => address.startsWith("192.168.")) ||
    addresses.find((address) => address.startsWith("10.")) ||
    addresses[0];
  return pick && serverPort ? `http://${pick}:${serverPort}` : null;
}

function requestServer(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(true);
    });
    request.setTimeout(1_000, () => request.destroy());
    request.once("error", () => resolve(false));
  });
}

async function waitForServer(url) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!serverProcess || serverProcess.exitCode !== null) {
      throw new Error("Campfire server exited during startup");
    }
    if (await requestServer(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Campfire server did not start within ${STARTUP_TIMEOUT_MS / 1000} seconds`);
}

/** One-time state preparation; the server itself can be (re)spawned many times. */
async function prepareLaunch() {
  const serverRoot = getServerRoot();
  const serverEntry = path.join(serverRoot, "campfire-server.mjs");
  if (!fs.existsSync(serverEntry)) {
    throw new Error(`Desktop server bundle is missing: ${serverEntry}`);
  }

  const Database = require(
    path.join(serverRoot, "node_modules", "better-sqlite3"),
  );
  await importLegacyDesktopState({
    userDataPath: app.getPath("userData"),
    portableDirectory: process.env.PORTABLE_EXECUTABLE_DIR || null,
    Database,
    log: logDesktop,
  });

  const desktopConfig = ensureDesktopConfig();
  const databasePath = ensureDatabase(serverRoot);
  const logDirectory = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(logDirectory, { recursive: true });
  return {
    serverRoot,
    serverEntry,
    desktopConfig,
    databasePath,
    userMediaRoot: ensureUserMediaDirectory(),
    standaloneConfig: loadStandaloneConfig(serverRoot),
    logPath: path.join(logDirectory, "server.log"),
  };
}

async function startServer() {
  const lanSharing = settings.lanSharing === true;
  const port = await reservePort(lanSharing);
  serverLog = fs.createWriteStream(launch.logPath, { flags: "a" });

  const environment = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    NODE_ENV: "production",
    PORT: String(port),
    DATABASE_URL: `file:${launch.databasePath}`,
    CAMPFIRE_UPLOAD_DIR: launch.userMediaRoot,
    CAMPFIRE_BIND_HOST: lanSharing ? "0.0.0.0" : "127.0.0.1",
    // Plain HTTP on loopback/LAN: Secure cookies would lock LAN guests out.
    COOKIE_SECURE: "0",
    // Lets the server exit if this launcher is force-killed (no orphan holding the DB).
    CAMPFIRE_PARENT_PID: String(process.pid),
    JWT_SECRET: launch.desktopConfig.jwtSecret,
    __NEXT_PRIVATE_STANDALONE_CONFIG: launch.standaloneConfig,
  };

  const child = spawn(process.execPath, [launch.serverEntry], {
    cwd: launch.serverRoot,
    env: environment,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProcess = child;
  const log = serverLog;
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.once("error", (error) => log.write(`[desktop] ${error.stack || error}\n`));
  child.once("exit", (code, signal) => {
    log.write(`[desktop] server exited code=${code} signal=${signal}\n`);
    if (!quitting && !restarting && child === serverProcess) {
      void dialog.showErrorBox(
        "Campfire server stopped",
        `The local server exited unexpectedly. See ${launch.logPath} for details.`,
      );
      app.quit();
    }
  });

  serverPort = port;
  appOrigin = `http://127.0.0.1:${port}`;
  await waitForServer(appOrigin);
}

async function stopServer() {
  const child = serverProcess;
  if (child && child.exitCode === null) {
    child.kill();
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 3_000);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
  serverLog?.end();
}

// ─── LAN sharing ───

/** Restart the server on the requested binding. The setting is saved only once the
 * new binding works; on failure the previous binding is restored and the app keeps running. */
async function applyLanSetting(next) {
  if (restarting) return false;
  restarting = true;
  const previous = settings.lanSharing === true;
  refreshTrayMenu();
  try {
    settings.lanSharing = next;
    await stopServer();
    await startServer();
    saveSettings();
    return true;
  } catch (error) {
    logDesktop(`[desktop] switching LAN sharing ${next ? "on" : "off"} failed: ${error.message}`);
    settings.lanSharing = previous;
    try {
      await stopServer();
      await startServer();
    } catch (recoveryError) {
      dialog.showErrorBox("Campfire could not restart", recoveryError.message);
      app.quit();
      return false;
    }
    void dialog.showMessageBox(mainWindow ?? undefined, {
      type: "warning",
      title: APP_NAME,
      message: next ? "Couldn't turn on LAN sharing." : "Couldn't turn off LAN sharing.",
      detail: `${error.message}\n\nCampfire is still running with the previous setting.`,
      buttons: ["OK"],
      noLink: true,
    });
    return false;
  } finally {
    restarting = false;
    refreshTrayMenu();
    if (mainWindow && appOrigin) void mainWindow.loadURL(appOrigin);
  }
}

function toggleLanSharing() {
  const next = settings.lanSharing !== true;
  void applyLanSetting(next).then(async (ok) => {
    if (!ok || !next) return;
    const url = lanUrl();
    const { response } = await dialog.showMessageBox(mainWindow ?? undefined, {
      type: "info",
      title: APP_NAME,
      message: "LAN sharing is on.",
      detail:
        `${url ? `Friends on your network can join at:\n${url}\n\n` : "No network address found — check your connection.\n\n"}` +
        "If Windows asks to allow Campfire through the firewall, click Allow.\n\n" +
        "Anyone on your local network can reach this Campfire's login page while sharing is on. " +
        "Browsers only allow microphones on secure origins, so LAN guests can text but not join voice.",
      buttons: url ? ["Copy link", "OK"] : ["OK"],
      defaultId: 0,
      noLink: true,
    });
    if (url && response === 0) clipboard.writeText(url);
  });
}

// ─── Updates ───

function fetchLatestRelease() {
  return new Promise((resolve, reject) => {
    const request = https.get(
      {
        host: "api.github.com",
        path: `/repos/${UPDATE_REPO}/releases/latest`,
        headers: { "User-Agent": APP_NAME, Accept: "application/vnd.github+json" },
        timeout: 10_000,
      },
      (response) => {
        let body = "";
        response.on("error", reject);
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () => {
          if (response.statusCode === 404) return resolve(null);
          if (response.statusCode !== 200) return reject(new Error(`GitHub responded ${response.statusCode}`));
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on("error", reject);
    request.on("timeout", () => request.destroy(new Error("update check timed out")));
  });
}

/** Semver-ish compare ("v" optional); a prerelease sorts below its release. >0 if a is newer. */
function compareVersions(a, b) {
  const parse = (value) => {
    const [core, pre = ""] = String(value).replace(/^v/i, "").split("-", 2);
    return { core: core.split(".").map((part) => parseInt(part, 10) || 0), pre };
  };
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < 3; index++) {
    const diff = (left.core[index] || 0) - (right.core[index] || 0);
    if (diff !== 0) return diff;
  }
  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  return left.pre.localeCompare(right.pre, undefined, { numeric: true });
}

async function checkForUpdates(interactive) {
  let release;
  try {
    release = await fetchLatestRelease();
  } catch (error) {
    logDesktop(`[desktop] update check failed: ${error.message}`);
    if (interactive) {
      void dialog.showMessageBox(mainWindow ?? undefined, {
        type: "warning",
        title: APP_NAME,
        message: "Could not check for updates.",
        detail: error.message,
        buttons: ["OK"],
        noLink: true,
      });
    }
    return;
  }
  const current = app.getVersion();
  const latest = release && release.tag_name;
  if (!latest || compareVersions(latest, current) <= 0) {
    logDesktop(`[desktop] update check: up to date (current ${current}, latest ${latest || "none published"})`);
    if (interactive) {
      void dialog.showMessageBox(mainWindow ?? undefined, {
        type: "info",
        title: APP_NAME,
        message: "You're up to date.",
        detail: `Campfire ${current} is the latest version.`,
        buttons: ["OK"],
        noLink: true,
      });
    }
    return;
  }
  if (!interactive && settings.skipUpdateVersion === latest) return;
  const { response } = await dialog.showMessageBox(mainWindow ?? undefined, {
    type: "info",
    title: APP_NAME,
    message: `Campfire ${latest.replace(/^v/i, "")} is available`,
    detail: `You have ${current}. Your messages and settings are kept across updates.`,
    buttons: ["Download", "Later", "Skip this version"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (response === 0) openExternal(release.html_url);
  if (response === 2) {
    settings.skipUpdateVersion = latest;
    saveSettings();
  }
}

// ─── Tray ───

function createTray() {
  try {
    const image = nativeImage.createFromPath(iconPath());
    tray = new Tray(image.isEmpty() ? image : image.resize({ width: 16, height: 16 }));
  } catch (error) {
    // No tray means a hidden window could never come back — closing quits instead.
    logDesktop(`[desktop] tray unavailable (${error.message}); close will quit`);
    tray = null;
    return;
  }
  tray.setToolTip(APP_NAME);
  tray.on("double-click", showMainWindow);
  refreshTrayMenu();
}

function refreshTrayMenu() {
  if (!tray) return;
  const items = [
    { label: "Open Campfire", click: showMainWindow },
    { type: "separator" },
    {
      label: "Share on this network",
      type: "checkbox",
      checked: settings.lanSharing === true,
      enabled: !restarting,
      click: toggleLanSharing,
    },
  ];
  if (settings.lanSharing === true) {
    const url = lanUrl();
    items.push({
      label: url ? `Copy LAN link  (${url})` : "LAN link unavailable (no network)",
      enabled: Boolean(url) && !restarting,
      click: () => {
        const current = lanUrl(); // the label may be stale by click time
        if (current) clipboard.writeText(current);
      },
    });
  }
  items.push(
    { type: "separator" },
    { label: "Check for updates…", click: () => void checkForUpdates(true) },
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
    { label: "Quit Campfire", click: () => app.quit() },
  );
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

function isTrustedUrl(rawUrl) {
  if (!appOrigin) return false;
  try {
    return new URL(rawUrl).origin === appOrigin;
  } catch {
    return false;
  }
}

function configurePermissions() {
  const allowedPermissions = new Set([
    "display-capture",
    "fullscreen",
    "media",
    "notifications",
    "speaker-selection",
  ]);

  session.defaultSession.setPermissionCheckHandler((_webContents, permission, origin) => {
    return isTrustedUrl(origin) && allowedPermissions.has(permission);
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const requestingUrl = details.requestingUrl || details.securityOrigin || "";
    callback(isTrustedUrl(requestingUrl) && allowedPermissions.has(permission));
  });

  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    if (!isTrustedUrl(request.securityOrigin)) {
      callback({});
      return;
    }

    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen", "window"],
        thumbnailSize: { width: 0, height: 0 },
        fetchWindowIcons: false,
      });
      const choices = sources.slice(0, 12);
      const cancelId = choices.length;
      const result = await dialog.showMessageBox(mainWindow, {
        type: "question",
        title: "Share a screen",
        message: "Choose what Campfire may share",
        buttons: [...choices.map((source) => source.name), "Cancel"],
        cancelId,
        defaultId: 0,
        noLink: true,
      });
      callback(result.response < choices.length ? { video: choices[result.response] } : {});
    } catch {
      callback({});
    }
  });
}

function openExternal(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "https:" || url.protocol === "http:") {
      void shell.openExternal(url.toString());
    }
  } catch {
    // Ignore malformed external links.
  }
}

function showMainWindow() {
  if (!mainWindow) {
    if (appOrigin) createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createWindow() {
  const icon = iconPath();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#1a0e08",
    icon: fs.existsSync(icon) ? icon : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedUrl(url)) return { action: "allow" };
    openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isTrustedUrl(url)) return;
    event.preventDefault();
    openExternal(url);
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  // Close hides to the tray (calls keep running) unless the user opted out or there is no tray.
  mainWindow.on("close", (event) => {
    if (quitting || !tray || settings.closeToTray === false) return;
    event.preventDefault();
    mainWindow?.hide();
    if (!settings.trayHintShown) {
      settings.trayHintShown = true;
      saveSettings();
      tray.displayBalloon?.({
        title: APP_NAME,
        content: "Campfire is still running here. Right-click the tray icon to quit or change this.",
      });
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  void mainWindow.loadURL(appOrigin);
}

app.whenReady().then(async () => {
  try {
    Menu.setApplicationMenu(null);
    settings = loadSettings();
    launch = await prepareLaunch();
    await startServer();
    configurePermissions();
    createWindow();
    createTray();
    if (app.isPackaged) setTimeout(() => void checkForUpdates(false), 15_000).unref?.();
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    dialog.showErrorBox("Campfire could not start", message);
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  void stopServer().finally(() => app.quit());
});

// With close-to-tray the window only hides, so this fires only when closing really should quit.
app.on("window-all-closed", () => app.quit());
