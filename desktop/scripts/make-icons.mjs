#!/usr/bin/env node
/**
 * Generate Campfire desktop icons from icons/icon.png (a 1024x1024 master):
 *   - icon.ico    multi-size Windows icon (16..256, PNG-compressed entries)
 *   - tray-icon.png  a real 32x32 tray icon (not a 1MB image resized at runtime)
 *
 * Uses `sharp` resolved from squatch-chat's node_modules (it ships with Next).
 * Run once when the master icon changes: `node scripts/make-icons.mjs`.
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, "..");
const squatchChat = join(desktop, "..", "squatch-chat");
const require = createRequire(join(squatchChat, "package.json"));
const sharp = require("sharp");

const master = join(desktop, "icons", "icon.png");
const SIZES = [16, 24, 32, 48, 64, 128, 256];

async function pngBuffer(size) {
  return sharp(master).resize(size, size, { fit: "cover" }).png().toBuffer();
}

function buildIco(entries) {
  // ICONDIR (6 bytes) + n * ICONDIRENTRY (16 bytes) + image data.
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  const images = [];
  entries.forEach((e, i) => {
    const o = i * 16;
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o + 0); // width (0 => 256)
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o + 1); // height
    dir.writeUInt8(0, o + 2); // color count
    dir.writeUInt8(0, o + 3); // reserved
    dir.writeUInt16LE(1, o + 4); // color planes
    dir.writeUInt16LE(32, o + 6); // bits per pixel
    dir.writeUInt32LE(e.data.length, o + 8); // bytes in resource
    dir.writeUInt32LE(offset, o + 12); // offset
    offset += e.data.length;
    images.push(e.data);
  });

  return Buffer.concat([header, dir, ...images]);
}

async function main() {
  const entries = [];
  for (const size of SIZES) entries.push({ size, data: await pngBuffer(size) });

  writeFileSync(join(desktop, "icons", "icon.ico"), buildIco(entries));
  writeFileSync(join(desktop, "icons", "tray-icon.png"), await pngBuffer(32));

  console.log("[icons] wrote icon.ico (%d sizes) and tray-icon.png (32x32)", SIZES.length);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
