import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Campfire",
  description: "Gather around the fire",
  icons: {
    icon: "/campfire-logo.png",
    apple: "/campfire-logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
