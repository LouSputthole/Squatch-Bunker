import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { formatSize, latestWindowsDownload } from "./release";

const REPO_URL = "https://github.com/LouSputthole/Squatch-Bunker";

export const metadata: Metadata = {
  title: "Download Campfire",
  description: "Sit around the fire with your people. Use Campfire in your browser, on Windows, or host your own.",
};

// GitHub is asked about the latest release at most every 10 minutes.
export const revalidate = 600;

const linkClass =
  "underline underline-offset-2 hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";

export default async function DownloadPage() {
  const windows = await latestWindowsDownload();
  const details = [windows.version && `Version ${windows.version}`, windows.size && formatSize(windows.size), "Windows 10/11, 64-bit"]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)]">
      <main className="mx-auto my-auto w-[calc(100%_-_2rem)] max-w-xl py-10">
        <div className="flex flex-col items-center text-center mb-8">
          <Image
            src="/Campfire-Icon.png"
            alt=""
            width={112}
            height={112}
            className="w-24 h-24 mb-3 drop-shadow-[0_0_24px_rgba(255,155,80,0.35)]"
            priority
          />
          <h1 className="text-3xl font-bold text-[var(--text)] mb-2">Campfire</h1>
          <p className="text-lg text-[var(--text)]">Sit around the fire with your people.</p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Voice rooms, text channels, and DMs for your crew. Free and open source.
          </p>
          <Link
            href="/login"
            className="mt-6 w-full sm:w-auto px-8 py-3 bg-[var(--accent-2)] text-white rounded-lg hover:bg-[var(--accent)] hover:text-[var(--bg)] transition-colors font-semibold"
          >
            Open Campfire in your browser
          </Link>
        </div>

        <section
          aria-labelledby="download-windows"
          className="p-6 mb-4 bg-[var(--panel)] rounded-2xl border border-[var(--accent-2)]/40 shadow-2xl shadow-black/40"
        >
          <h2 id="download-windows" className="text-lg font-semibold text-[var(--text)]">
            Windows app
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Join Campfire Online from your desktop, or switch to &ldquo;Host on this PC&rdquo; to run a camp for your
            own network.
          </p>
          <a
            href={windows.href}
            className="mt-4 block w-full py-2.5 text-center border border-[var(--accent)]/70 text-[var(--accent)] rounded-lg hover:bg-[var(--accent)]/10 transition-colors font-semibold"
          >
            Download for Windows
          </a>
          <p className="mt-2 text-xs text-[var(--muted)]">{details}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            The app sends a small{" "}
            <a href={`${REPO_URL}/blob/main/squatch-chat/docs/TELEMETRY.md`} className={linkClass}>
              anonymous usage ping
            </a>{" "}
            once a day (version and mode, nothing personal). Turn it off from its tray icon.
          </p>
          {windows.portable && (
            <p className="mt-1 text-xs text-[var(--muted)]">
              No installer?{" "}
              <a href={windows.portable.href} className={linkClass}>
                Portable version
              </a>{" "}
              ({formatSize(windows.portable.size)})
            </p>
          )}
          <p className="mt-3 text-xs text-[var(--muted)]">
            The app isn&rsquo;t code-signed yet, so Windows SmartScreen may warn you the first time. Choose{" "}
            <strong className="text-[var(--text)]">More info</strong>, then{" "}
            <strong className="text-[var(--text)]">Run anyway</strong>.
          </p>
        </section>

        <section
          aria-labelledby="host-your-own"
          className="p-6 bg-[var(--panel)] rounded-2xl border border-[var(--accent-2)]/40"
        >
          <h2 id="host-your-own" className="text-lg font-semibold text-[var(--text)]">
            Host your own Campfire
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Run the open-source server on your own computer or VPS with Node or Docker. Every feature is included.
          </p>
          <a
            href={`${REPO_URL}#quick-start-self-host`}
            className="mt-3 inline-block text-sm text-[var(--accent)] hover:underline"
          >
            Self-hosting guide &rarr;
          </a>
        </section>
      </main>
      <footer aria-label="License, source, and privacy" className="px-4 pb-6 text-center text-xs text-[var(--muted)]">
        <p>
          Campfire is free and licensed under{" "}
          <a href={`${REPO_URL}/blob/main/squatch-chat/LICENSE`} className={linkClass}>
            AGPL-3.0-only
          </a>{" "}
          |{" "}
          <a href={REPO_URL} className={linkClass}>
            Source
          </a>{" "}
          |{" "}
          <a href={`${REPO_URL}/blob/main/squatch-chat/docs/TELEMETRY.md`} className={linkClass}>
            Anonymous usage ping
          </a>
        </p>
      </footer>
    </div>
  );
}
