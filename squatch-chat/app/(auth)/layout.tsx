import { connection } from "next/server";
import { LegalPagesProvider } from "@/components/LegalConsent";
import { legalPagesEnabled } from "@/lib/legal";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Per request, not at build: the image is built without CAMPFIRE_EDITION.
  await connection();
  return <LegalPagesProvider enabled={legalPagesEnabled()}>{children}</LegalPagesProvider>;
}
