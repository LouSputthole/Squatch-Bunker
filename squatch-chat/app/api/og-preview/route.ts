import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  assertSafePreviewTarget,
  fetchSafePreviewTarget,
  PreviewFetchError,
  type SafePreviewTarget,
} from "@/lib/safeOgPreview";

export const runtime = "nodejs";

const MAX_PREVIEW_BYTES = 1024 * 1024;

async function readBoundedText(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    received += value.byteLength;
    if (received > MAX_PREVIEW_BYTES) {
      await reader.cancel();
      throw new PreviewFetchError("Preview response is too large", 413);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const url = req.nextUrl.searchParams.get("url");
  if (!url) return NextResponse.json({ error: "No URL" }, { status: 400 });

  let target: SafePreviewTarget;
  try {
    target = await assertSafePreviewTarget(url);
  } catch (error) {
    const status = error instanceof PreviewFetchError ? error.status : 400;
    return NextResponse.json({ error: "Invalid or blocked URL" }, { status });
  }

  try {
    const signal = AbortSignal.timeout(5000);
    let res: Response | undefined;

    for (let redirects = 0; redirects <= 3; redirects++) {
      res = await fetchSafePreviewTarget(target, {
        headers: { "User-Agent": "Campfire/1.0 (link preview bot)" },
        signal,
      });

      if (res.status < 300 || res.status >= 400) break;
      const location = res.headers.get("location");
      await res.body?.cancel();
      if (!location || redirects === 3) {
        return NextResponse.json({ error: "Too many redirects" }, { status: 502 });
      }
      target = await assertSafePreviewTarget(
        new URL(location, target.url).toString(),
      );
    }

    if (!res) {
      return NextResponse.json({ error: "Failed to fetch" }, { status: 502 });
    }

    if (!res.ok) return NextResponse.json({ error: "Failed to fetch" }, { status: 502 });

    const contentType = res.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.startsWith("text/html") && !contentType.startsWith("application/xhtml+xml")) {
      await res.body?.cancel();
      return NextResponse.json({ error: "Preview target is not HTML" }, { status: 415 });
    }

    const declaredLength = Number(res.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_PREVIEW_BYTES) {
      await res.body?.cancel();
      return NextResponse.json({ error: "Preview response is too large" }, { status: 413 });
    }

    const html = await readBoundedText(res);

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

    return NextResponse.json({
      title,
      description,
      image,
      siteName,
      url: target.url.toString(),
    });
  } catch (error) {
    if (error instanceof PreviewFetchError) {
      return NextResponse.json({ error: "Invalid or blocked URL" }, { status: error.status });
    }
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return NextResponse.json({ error: "Preview request timed out" }, { status: 504 });
    }
    return NextResponse.json({ error: "Fetch failed" }, { status: 502 });
  }
}
