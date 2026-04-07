const { contextBridge } = require("electron");

// Expose safe APIs to renderer if needed in the future
contextBridge.exposeInMainWorld("campfire", {
  platform: process.platform,
  isDesktop: true,
});
