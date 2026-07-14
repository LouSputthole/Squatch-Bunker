"use strict";

const { app, BrowserWindow, desktopCapturer, dialog, session, shell } = require("electron");
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { upgradeDesktopDatabase } = require("./database.cjs");

const APP_NAME = "Campfire";
const STARTUP_TIMEOUT_MS = 45_000;

let appOrigin = null;
let mainWindow = null;
let serverProcess = null;
let serverLog = null;
let quitting = false;

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

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

function getServerRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "server")
    : path.join(__dirname, ".stage", "server");
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

function reservePort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.unref();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => {
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

async function startServer() {
  const serverRoot = getServerRoot();
  const serverEntry = path.join(serverRoot, "campfire-server.mjs");
  if (!fs.existsSync(serverEntry)) {
    throw new Error(`Desktop server bundle is missing: ${serverEntry}`);
  }

  const desktopConfig = ensureDesktopConfig();
  const databasePath = ensureDatabase(serverRoot);
  const userMediaRoot = ensureUserMediaDirectory();
  const standaloneConfig = loadStandaloneConfig(serverRoot);
  const port = await reservePort();
  const logDirectory = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(logDirectory, { recursive: true });
  const logPath = path.join(logDirectory, "server.log");
  serverLog = fs.createWriteStream(logPath, { flags: "a" });

  const environment = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    NODE_ENV: "production",
    PORT: String(port),
    DATABASE_URL: `file:${databasePath}`,
    CAMPFIRE_UPLOAD_DIR: userMediaRoot,
    CAMPFIRE_BIND_HOST: "127.0.0.1",
    JWT_SECRET: desktopConfig.jwtSecret,
    __NEXT_PRIVATE_STANDALONE_CONFIG: standaloneConfig,
  };

  serverProcess = spawn(process.execPath, [serverEntry], {
    cwd: serverRoot,
    env: environment,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProcess.stdout.pipe(serverLog, { end: false });
  serverProcess.stderr.pipe(serverLog, { end: false });
  serverProcess.once("error", (error) => serverLog.write(`[desktop] ${error.stack || error}\n`));
  serverProcess.once("exit", (code, signal) => {
    serverLog?.write(`[desktop] server exited code=${code} signal=${signal}\n`);
    if (!quitting) {
      void dialog.showErrorBox(
        "Campfire server stopped",
        `The local server exited unexpectedly. See ${logPath} for details.`,
      );
      app.quit();
    }
  });

  appOrigin = `http://127.0.0.1:${port}`;
  await waitForServer(appOrigin);
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

function createWindow() {
  const iconPath = path.join(getServerRoot(), "public", "Campfire-Icon.png");
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#111827",
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
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
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  void mainWindow.loadURL(appOrigin);
}

async function stopServer() {
  if (serverProcess && serverProcess.exitCode === null) {
    serverProcess.kill();
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 3_000);
      serverProcess.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
  serverLog?.end();
}

app.whenReady().then(async () => {
  try {
    await startServer();
    configurePermissions();
    createWindow();
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

app.on("window-all-closed", () => app.quit());
