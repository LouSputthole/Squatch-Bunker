import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import { DEFAULT_THEME, themeBootScript } from "@/lib/themes";
import Toaster from "@/components/Toaster";

export const metadata: Metadata = {
  title: "Campfire",
  description: "Gather around the fire",
  icons: {
    icon: "/Campfire-Icon.png",
    apple: "/Campfire-Icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" data-theme={DEFAULT_THEME} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="min-h-full flex flex-col font-sans">
        {process.env.NODE_ENV !== "production" && (
          <Script src="/error-reporter.js" strategy="beforeInteractive" />
        )}
        {children}
        <Toaster />
      </body>
    </html>
  );
}
