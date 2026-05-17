import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body.title) {
      return NextResponse.json({ ok: false, error: "Missing title" }, { status: 400 });
    }

    const entry = {
      title: body.title,
      year: body.year || "—",
      correct: body.correct,
      confidence: body.confidence || null,
      mediaType: body.mediaType || null,
      timestamp: new Date().toISOString(),
    };

    // Logs appear in Vercel dashboard → Functions → view logs
    console.log("VORTEX_FEEDBACK:", JSON.stringify(entry));

    const status = body.correct ? "✅ CORRECT" : "❌ WRONG";
    console.log(`${status} | ${entry.title} (${entry.year}) | confidence: ${entry.confidence}% | ${entry.timestamp}`);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Feedback error:", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}