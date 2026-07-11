import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return NextResponse.json({ error: "No URL" }, { status: 400 });

  // Basic URL validation
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Campfire/1.0 (link preview bot)" },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return NextResponse.json({ error: "Failed to fetch" }, { status: 502 });

    const html = await res.text();

    // Extract OG tags
    function getMeta(property: string): string | null {
      const match =
        html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`, "i")) ||
        html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`, "i"));
      return match?.[1] ?? null;
    }

    const title =
      getMeta("og:title") || getMeta("twitter:title") || html.match(/<title>([^<]+)<\/title>/i)?.[1] || null;
    const description =
      getMeta("og:description") || getMeta("twitter:description") || getMeta("description") || null;
    const image = getMeta("og:image") || getMeta("twitter:image") || null;
    const siteName = getMeta("og:site_name") || null;

    return NextResponse.json({ title, description, image, siteName, url });
  } catch {
    return NextResponse.json({ error: "Fetch failed" }, { status: 502 });
  }
}
