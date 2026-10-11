import { NextResponse } from "next/server";
import { currentNotice } from "@/lib/notice";

export const dynamic = "force-dynamic";

/** This instance's broadcast notice for components/NoticeBanner. Public: it is an announcement. */
export async function GET() {
  return NextResponse.json({ notice: currentNotice() }, { headers: { "cache-control": "no-store" } });
}
