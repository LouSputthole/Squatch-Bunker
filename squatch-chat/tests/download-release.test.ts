import { describe, expect, it } from "vitest";
import { formatSize, RELEASES_URL, windowsDownload } from "@/app/download/release";

const asset = (name: string, size = 125_499_964) => ({
  name,
  size,
  browser_download_url: `https://github.com/LouSputthole/Squatch-Bunker/releases/download/v1.0.0/${name}`,
});

describe("/download release picker", () => {
  it("links the NSIS setup asset with version, size, and the portable build", () => {
    const result = windowsDownload({
      tag_name: "v1.0.0",
      html_url: "https://github.com/LouSputthole/Squatch-Bunker/releases/tag/v1.0.0",
      assets: [asset("latest.yml", 400), asset("Campfire-Portable-1.0.0-x64.exe", 125_232_117), asset("Campfire-Setup-1.0.0-x64.exe")],
    });
    expect(result.href).toMatch(/Campfire-Setup-1\.0\.0-x64\.exe$/);
    expect(result.version).toBe("1.0.0");
    expect(result.size).toBe(125_499_964);
    expect(result.portable?.href).toMatch(/Campfire-Portable-1\.0\.0-x64\.exe$/);
    expect(formatSize(result.size!)).toBe("120 MB");
  });

  it("falls back to the release page when no setup exe is attached", () => {
    const result = windowsDownload({
      tag_name: "0.2.0",
      html_url: "https://github.com/LouSputthole/Squatch-Bunker/releases/tag/0.2.0",
      assets: [asset("Campfire-Setup-0.2.0-x64.exe.blockmap")],
    });
    expect(result).toEqual({
      href: "https://github.com/LouSputthole/Squatch-Bunker/releases/tag/0.2.0",
      version: "0.2.0",
      size: null,
      portable: null,
    });
  });

  it("falls back to the releases list when GitHub returned nothing usable", () => {
    for (const body of [null, "nope", { message: "Not Found" }, { assets: [{ name: "Campfire-Setup.exe" }] }]) {
      expect(windowsDownload(body).href).toBe(RELEASES_URL);
    }
  });

  it("never links a non-https download or release URL", () => {
    const result = windowsDownload({
      html_url: "javascript:alert(1)",
      assets: [{ name: "Campfire-Setup-1.0.0-x64.exe", size: 1, browser_download_url: "http://evil.example/x.exe" }],
    });
    expect(result.href).toBe(RELEASES_URL);
  });
});
