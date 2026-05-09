import { NextRequest, NextResponse } from "next/server";

const FALLBACK = {
  title: "UNKNOWN",
  year: "—",
  director: "—",
  genre: "—",
  runtime: "—",
  rating: "—",
  description: "We couldn't identify this scene. Try a clearer screenshot with more visible details.",
  scene: "—",
  confidence: 0,
  alternatives: [],
  signals: { visual: 0, dialogue: 0, colorGrade: 0, textTitles: 0 },
};

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      console.error("GEMINI_API_KEY is not set");
      return NextResponse.json({ error: "API key not configured." }, { status: 500 });
    }

    // Convert file to base64
    const bytes = await file.arrayBuffer();
    const base64 = Buffer.from(bytes).toString("base64");
    const mimeType = file.type || "image/jpeg";

    const prompt = `You are a movie and TV show identification expert.

Analyze this image and identify what movie or TV show it is from.

You MUST respond with ONLY a JSON object. No explanation, no markdown, no backticks. Just the raw JSON.

Use exactly this structure:
{"title":"MOVIE TITLE IN CAPS","year":"2014","director":"Director Name","genre":"Genre","runtime":"120 min","rating":"8.5/10","description":"Brief one sentence plot summary.","scene":"Which part of the movie this is from","confidence":85,"alternatives":[{"title":"Other Movie","year":"2010","confidence":45},{"title":"Another Movie","year":"2015","confidence":30},{"title":"Third Option","year":"2018","confidence":20}],"signals":{"visual":85,"dialogue":70,"colorGrade":80,"textTitles":60}}

If you cannot identify it, use "UNKNOWN" as title and 0 as confidence but still return valid JSON.`;

    const requestBody = {
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
              text: prompt,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1024,
        responseMimeType: "application/json",
      },
    };

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      }
    );

    // Handle quota exceeded
    if (response.status === 429) {
      console.error("Gemini quota exceeded");
      return NextResponse.json({
        ...FALLBACK,
        title: "QUOTA EXCEEDED",
        description: "Vortex is getting a lot of love right now! Daily AI limit reached. Please try again in a few hours.",
      });
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini API error:", response.status, errText);
      return NextResponse.json(
        { error: `API error ${response.status}. Please try again.` },
        { status: 500 }
      );
    }

    const geminiData = await response.json();
    console.log("Gemini raw response:", JSON.stringify(geminiData));

    // Extract text from response
    const rawText =
      geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    if (!rawText) {
      console.error("Empty response from Gemini");
      return NextResponse.json(FALLBACK);
    }

    // Try multiple parsing strategies
    let result = null;

    // Strategy 1: Direct parse
    try {
      result = JSON.parse(rawText.trim());
    } catch {
      // Strategy 2: Extract JSON object with regex
      try {
        const match = rawText.match(/\{[\s\S]*\}/);
        if (match) {
          result = JSON.parse(match[0]);
        }
      } catch {
        // Strategy 3: Clean and try again
        try {
          const cleaned = rawText
            .replace(/```json\n?/g, "")
            .replace(/```\n?/g, "")
            .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
            .trim();
          const match2 = cleaned.match(/\{[\s\S]*\}/);
          if (match2) {
            result = JSON.parse(match2[0]);
          }
        } catch {
          console.error("All parsing strategies failed. Raw text:", rawText);
        }
      }
    }

    if (!result) {
      return NextResponse.json(FALLBACK);
    }

    // Ensure all required fields exist
    const safeResult = {
      title: result.title || "UNKNOWN",
      year: result.year || "—",
      director: result.director || "—",
      genre: result.genre || "—",
      runtime: result.runtime || "—",
      rating: result.rating || "—",
      description: result.description || "No description available.",
      scene: result.scene || "—",
      confidence: result.confidence ?? 0,
      alternatives: Array.isArray(result.alternatives) ? result.alternatives : [],
      signals: {
        visual: result.signals?.visual ?? 0,
        dialogue: result.signals?.dialogue ?? 0,
        colorGrade: result.signals?.colorGrade ?? 0,
        textTitles: result.signals?.textTitles ?? 0,
      },
    };

    return NextResponse.json(safeResult);

  } catch (error) {
    console.error("Unexpected error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}