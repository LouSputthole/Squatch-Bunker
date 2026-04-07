import { NextResponse } from "next/server";

const LIBRETRANSLATE_URL = process.env.LIBRETRANSLATE_URL ?? "https://libretranslate.com";
const LIBRETRANSLATE_KEY = process.env.LIBRETRANSLATE_KEY ?? "";

export async function POST(req: Request) {
  const { text, target = "en" } = await req.json();

  if (!text?.trim()) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }

  if (text.length > 1000) {
    return NextResponse.json({ error: "text too long" }, { status: 400 });
  }

  try {
    const res = await fetch(`${LIBRETRANSLATE_URL}/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        q: text,
        source: "auto",
        target,
        api_key: LIBRETRANSLATE_KEY,
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return NextResponse.json({ error: (err as any).error ?? "Translation failed" }, { status: res.status });
    }

    const data = await res.json() as { translatedText: string; detectedLanguage?: unknown };
    return NextResponse.json({
      translatedText: data.translatedText,
      detectedLanguage: data.detectedLanguage,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "TimeoutError") {
      return NextResponse.json({ error: "Translation timed out" }, { status: 504 });
    }
    return NextResponse.json({ error: "Translation service unavailable" }, { status: 503 });
  }
}
