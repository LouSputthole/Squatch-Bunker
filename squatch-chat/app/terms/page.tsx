import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import LegalDocument from "@/components/LegalDocument";
import { legalPagesEnabled } from "@/lib/legal";
import { TERMS_MARKDOWN } from "./terms";

// Per request like the page, so a self-hosted 404 doesn't carry this title either.
export async function generateMetadata(): Promise<Metadata> {
  await connection();
  if (!legalPagesEnabled()) return {};
  return { title: "Terms of Service | Campfire Online", description: "The rules for using Campfire Online." };
}

export default async function TermsPage() {
  // Per request, not at build: the image is built without CAMPFIRE_EDITION.
  await connection();
  if (!legalPagesEnabled()) notFound();
  return <LegalDocument markdown={TERMS_MARKDOWN} />;
}
