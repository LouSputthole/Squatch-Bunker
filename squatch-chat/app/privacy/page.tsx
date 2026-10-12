import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import LegalDocument from "@/components/LegalDocument";
import { legalPagesEnabled } from "@/lib/legal";
import { PRIVACY_MARKDOWN } from "./privacy";

// Per request like the page, so a self-hosted 404 doesn't carry this title either.
export async function generateMetadata(): Promise<Metadata> {
  await connection();
  if (!legalPagesEnabled()) return {};
  return {
    title: "Privacy Policy | Campfire Online",
    description: "What Campfire Online collects, why, and the choices you have.",
  };
}

export default async function PrivacyPage() {
  // Per request, not at build: the image is built without CAMPFIRE_EDITION.
  await connection();
  if (!legalPagesEnabled()) notFound();
  return <LegalDocument markdown={PRIVACY_MARKDOWN} />;
}
