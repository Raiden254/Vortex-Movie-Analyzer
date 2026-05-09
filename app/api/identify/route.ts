import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Convert file to base64
    const bytes = await file.arrayBuffer();
    const base64 = Buffer.from(bytes).toString("base64");
    const mimeType = file.type;

    // Call Gemini API
    const apiKey = process.env.GEMINI_API_KEY;
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: base64,
                  },
                },
                {
                  text: `You are an expert movie and TV show identifier. Analyze this image carefully and identify which movie or TV show it is from.

Return ONLY a valid JSON object with no markdown, no backticks, no extra text — just raw JSON like this:
{
  "title": "MOVIE TITLE IN CAPS",
  "year": "release year as string",
  "director": "director full name",
  "genre": "genre / subgenre",
  "runtime": "runtime e.g. 169 min",
  "rating": "IMDb rating e.g. 8.7/10",
  "description": "one sentence plot summary",
  "scene": "which part of the movie or TV show this scene is likely from",
  "confidence": 85,
  "alternatives": [
    { "title": "Alternative Movie", "year": "2010", "confidence": 55 },
    { "title": "Another Movie", "year": "2015", "confidence": 30 },
    { "title": "Yet Another", "year": "2018", "confidence": 20 }
  ],
  "signals": {
    "visual": 90,
    "dialogue": 70,
    "colorGrade": 80,
    "textTitles": 60
  }
}

If you cannot identify it at all, still return valid JSON with title "UNKNOWN", confidence 0, and your best guesses for alternatives.`,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 1024,
          },
        }),
      }
    );

    if (!response.ok) {
  const err = await response.json();
  console.error("Gemini error:", JSON.stringify(err));
  return NextResponse.json(
    { error: err?.error?.message || "Gemini API error. Please try again." },
    { status: 500 }
  );
}

    const geminiData = await response.json();
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    // Clean and parse the JSON response
    const clean = rawText
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const jsonMatch = clean.match(/\{[\s\S]*\}/);

    let result;
    try {
      result = JSON.parse(jsonMatch ? jsonMatch[0] : clean);
    } catch {
      console.error("Failed to parse Gemini response:", rawText);
      return NextResponse.json(
        { error: "Could not parse identification result. Please try again." },
        { status: 500 }
      );
    }

    return NextResponse.json(result);

  } catch (error) {
    console.error("Identify error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}