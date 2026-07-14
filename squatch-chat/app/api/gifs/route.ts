import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { checkWeightedLimit } from "@/lib/rateLimit";

const GIPHY_KEY = process.env.GIPHY_API_KEY ?? "";
const TENOR_KEY = process.env.TENOR_API_KEY ?? "";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(record: Record<string, unknown> | undefined, key: string): string {
  const value = record?.[key];
  return typeof value === "string" ? value : "";
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const q = req.nextUrl.searchParams.get("q") ?? "";
  const limit = 24;
  if (q.length > 100) {
    return NextResponse.json({ error: "Search query is too long" }, { status: 400 });
  }

  const rateLimit = checkWeightedLimit(`gifs:${session.userId}`, 1, 60, 60_000);
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Too many GIF searches" }, { status: 429 });
  }

  if (!GIPHY_KEY && !TENOR_KEY) {
    // Return demo data when no API key configured
    return NextResponse.json({ gifs: [] });
  }

  try {
    if (GIPHY_KEY) {
      const url = q
        ? `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(q)}&limit=${limit}&rating=g`
        : `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_KEY}&limit=${limit}&rating=g`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) {
        return NextResponse.json({ gifs: [] });
      }
      const data: unknown = await res.json();
      const entries = isRecord(data) && Array.isArray(data.data) ? data.data : [];
      const gifs = entries.filter(isRecord).map((gif) => {
        const images = isRecord(gif.images) ? gif.images : undefined;
        const fixedHeight = images && isRecord(images.fixed_height) ? images.fixed_height : undefined;
        const original = images && isRecord(images.original) ? images.original : undefined;
        const fixedHeightStill = images && isRecord(images.fixed_height_still)
          ? images.fixed_height_still
          : undefined;
        const originalStill = images && isRecord(images.original_still)
          ? images.original_still
          : undefined;

        return {
          id: readString(gif, "id"),
          title: readString(gif, "title"),
          url: readString(fixedHeight, "url") || readString(original, "url"),
          preview: readString(fixedHeightStill, "url") || readString(originalStill, "url"),
        };
      });
      return NextResponse.json({ gifs });
    }
    return NextResponse.json({ gifs: [] });
  } catch {
    return NextResponse.json({ gifs: [] });
  }
}
