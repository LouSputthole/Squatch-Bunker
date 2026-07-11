import { NextRequest, NextResponse } from "next/server";

const GIPHY_KEY = process.env.GIPHY_API_KEY ?? "";
const TENOR_KEY = process.env.TENOR_API_KEY ?? "";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const limit = 24;

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
      const data = await res.json();
      const gifs = (data.data ?? []).map((g: any) => ({
        id: g.id,
        title: g.title,
        url: g.images?.fixed_height?.url ?? g.images?.original?.url ?? "",
        preview: g.images?.fixed_height_still?.url ?? g.images?.original_still?.url ?? "",
      }));
      return NextResponse.json({ gifs });
    }
    return NextResponse.json({ gifs: [] });
  } catch {
    return NextResponse.json({ gifs: [] });
  }
}
