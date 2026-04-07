const { app, BrowserWindow, shell, Tray, Menu, nativeImage } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const net = require("net");

// Paths
const IS_DEV = process.env.NODE_ENV === "development";
const SERVER_DIR = IS_DEV
  ? path.join(__dirname, "..", "squatch-chat")
  : path.join(process.resourcesPath, "server");

const APP_PORT = parseInt(process.env.APP_PORT || "3000", 10);
const SOCKET_PORT = parseInt(process.env.SOCKET_PORT || "3001", 10);

let mainWindow = null;
let splashWindow = null;
let tray = null;
let serverProcess = null;
let realtimeProcess = null;

// ─── Server Management ───

function waitForPort(port, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function check() {
      const socket = new net.Socket();
      socket.setTimeout(500);
      socket.on("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() - start > timeout) {
          reject(new Error(`Port ${port} not ready after ${timeout}ms`));
        } else {
          setTimeout(check, 300);
        }
      });
      socket.on("timeout", () => {
        socket.destroy();
        setTimeout(check, 300);
      });
      socket.connect(port, "127.0.0.1");
    }
    check();
  });
}

function startServers() {
  const env = {
    ...process.env,
    PORT: String(APP_PORT),
    SOCKET_PORT: String(SOCKET_PORT),
    NEXT_PUBLIC_SOCKET_URL: `http://localhost:${SOCKET_PORT}`,
    NEXT_PUBLIC_APP_URL: `http://localhost:${APP_PORT}`,
  };

  if (IS_DEV) {
    // Dev mode: use next dev + tsx watch
    serverProcess = spawn("npx", ["next", "dev", "--port", String(APP_PORT)], {
      cwd: SERVER_DIR,
      env,
      shell: true,
      stdio: "pipe",
    });

    realtimeProcess = spawn("npx", ["tsx", "watch", "realtime/server.ts"], {
      cwd: SERVER_DIR,
      env,
      shell: true,
      stdio: "pipe",
    });
  } else {
    // Production: use standalone Next.js server
    const serverEntry = path.join(SERVER_DIR, "server.js");
    serverProcess = spawn(process.execPath === app.getPath("exe") ? "node" : process.execPath, [serverEntry], {
      cwd: SERVER_DIR,
      env,
      shell: false,
      stdio: "pipe",
    });

    const realtimeEntry = path.join(SERVER_DIR, "realtime", "server.js");
    realtimeProcess = spawn("node", [realtimeEntry], {
      cwd: SERVER_DIR,
      env,
      shell: false,
      stdio: "pipe",
    });
  }

  // Log server output for debugging
  [serverProcess, realtimeProcess].forEach((proc, i) => {
    const label = i === 0 ? "[web]" : "[realtime]";
    if (proc.stdout) proc.stdout.on("data", (d) => console.log(`${label} ${d}`));
    if (proc.stderr) proc.stderr.on("data", (d) => console.error(`${label} ${d}`));
    proc.on("error", (err) => console.error(`${label} spawn error:`, err));
  });
}

function killServers() {
  [serverProcess, realtimeProcess].forEach((proc) => {
    if (proc && !proc.killed) {
      proc.kill("SIGTERM");
      setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, 3000);
    }
  });
  serverProcess = null;
  realtimeProcess = null;
}

// ─── Window Management ───

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 300,
    height: 350,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  splashWindow.loadFile(path.join(__dirname, "splash.html"));
  splashWindow.center();
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "Campfire",
    icon: getIconPath(),
    show: false,
    backgroundColor: "#1a1a2e",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.loadURL(`http://localhost:${APP_PORT}`);

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("ready-to-show", () => {
    if (splashWindow) {
      splashWindow.close();
      splashWindow = null;
    }
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on("close", (e) => {
    // Minimize to tray on close (Windows/Linux behavior)
    if (process.platform !== "darwin" && tray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Remove menu bar on Windows/Linux
  if (process.platform !== "darwin") {
    mainWindow.setMenuBarVisibility(false);
  }
}

function getIconPath() {
  const iconDir = path.join(__dirname, "icons");
  if (process.platform === "win32") return path.join(iconDir, "icon.ico");
  if (process.platform === "darwin") return path.join(iconDir, "icon.icns");
  return path.join(iconDir, "icon.png");
}

function createTray() {
  const iconPath = path.join(__dirname, "icons", "tray-icon.png");
  try {
    const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    tray = new Tray(icon);
    tray.setToolTip("Campfire");

    const contextMenu = Menu.buildFromTemplate([
      { label: "Show Campfire", click: () => mainWindow?.show() },
      { type: "separator" },
      { label: "Quit", click: () => { app.isQuitting = true; app.quit(); } },
    ]);
    tray.setContextMenu(contextMenu);
    tray.on("double-click", () => mainWindow?.show());
  } catch {
    // Tray icon not available, skip
  }
}

// ─── App Lifecycle ───

app.whenReady().then(async () => {
  createSplashWindow();
  startServers();

  try {
    await Promise.all([
      waitForPort(APP_PORT),
      waitForPort(SOCKET_PORT),
    ]);
  } catch (err) {
    console.error("Server startup failed:", err);
    if (splashWindow) splashWindow.close();
    app.quit();
    return;
  }

  createTray();
  createMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    killServers();
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow) {
    mainWindow.show();
  } else {
    createMainWindow();
  }
});

app.on("before-quit", () => {
  app.isQuitting = true;
  killServers();
});
