export const RELEASES_URL = "https://github.com/LouSputthole/Squatch-Bunker/releases";
const LATEST_RELEASE_API = "https://api.github.com/repos/LouSputthole/Squatch-Bunker/releases/latest";

export interface WindowsDownload {
  /** NSIS setup asset, else the release page, else the releases list. */
  href: string;
  version: string | null;
  size: number | null;
  portable: { href: string; size: number } | null;
}

interface Asset {
  name: string;
  browser_download_url: string;
  size: number;
}

function findAsset(assets: Asset[], pattern: RegExp): Asset | undefined {
  return assets.find((asset) => pattern.test(asset.name));
}

/** Maps an untrusted GitHub "latest release" body to the links /download shows. */
export function windowsDownload(release: unknown): WindowsDownload {
  const body = (release && typeof release === "object" ? release : {}) as Record<string, unknown>;
  const assets = (Array.isArray(body.assets) ? body.assets : []).filter(
    (asset): asset is Asset =>
      typeof asset?.name === "string" &&
      typeof asset.browser_download_url === "string" &&
      asset.browser_download_url.startsWith("https://") &&
      typeof asset.size === "number",
  );
  const setup = findAsset(assets, /Setup.*\.exe$/i);
  const portable = findAsset(assets, /Portable.*\.(exe|zip)$/i);
  const page = typeof body.html_url === "string" && body.html_url.startsWith("https://") ? body.html_url : null;
  return {
    href: setup?.browser_download_url ?? page ?? RELEASES_URL,
    version: typeof body.tag_name === "string" ? body.tag_name.replace(/^v/i, "") : null,
    size: setup?.size ?? null,
    portable: portable ? { href: portable.browser_download_url, size: portable.size } : null,
  };
}

export async function latestWindowsDownload(): Promise<WindowsDownload> {
  try {
    const res = await fetch(LATEST_RELEASE_API, {
      headers: { "User-Agent": "Campfire", Accept: "application/vnd.github+json" },
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(5000),
    });
    // 404 = nothing published yet (or only prereleases); the releases list still works.
    return windowsDownload(res.ok ? await res.json() : null);
  } catch {
    return windowsDownload(null);
  }
}

export function formatSize(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}
