import { NextRequest, NextResponse } from "next/server";

const OPENSUBTITLES_BASE = "https://api.opensubtitles.com/api/v1";

interface SubtitleSearchResult {
  matched: boolean;
  confidence: number;
  matchSource: "title" | "dialogue" | "none";
  confirmedTitle?: string;
  confirmedYear?: string;
  subtitleId?: string;
  downloadUrl?: string;
  matchedLine?: string;
}

async function searchByTitle(
  title: string,
  year: string,
  mediaType: string,
  apiKey: string
): Promise<SubtitleSearchResult> {
  try {
    const type = mediaType === "tv" ? "tvshow" : "movie";
    const url = `${OPENSUBTITLES_BASE}/subtitles?query=${encodeURIComponent(title)}&year=${year}&type=${type}&languages=en&order_by=download_count`;

    const res = await fetch(url, {
      headers: {
        "Api-Key": apiKey,
        "Content-Type": "application/json",
        "User-Agent": "VortexMovieAnalyzer v1.0",
      },
    });

    if (!res.ok) {
      console.error("OpenSubtitles search error:", res.status);
      return { matched: false, confidence: 0, matchSource: "none" };
    }

    const data = await res.json();
    const results = data.data || [];

    if (results.length === 0) {
      return { matched: false, confidence: 0, matchSource: "none" };
    }

    // Find best match — prefer exact title match
    const exactMatch = results.find((r: {
      attributes: {
        feature_details?: { title?: string; year?: number; movie_name?: string };
        movie_name?: string;
        files?: { file_id: number }[];
      }
    }) => {
      const subtitleTitle =
        r.attributes?.feature_details?.title ||
        r.attributes?.feature_details?.movie_name ||
        r.attributes?.movie_name ||
        "";
      return subtitleTitle.toLowerCase() === title.toLowerCase();
    });

    const best = exactMatch || results[0];
    const subtitleTitle =
      best.attributes?.feature_details?.title ||
      best.attributes?.feature_details?.movie_name ||
      best.attributes?.movie_name ||
      title;
    const subtitleYear =
      best.attributes?.feature_details?.year?.toString() || year;
    const fileId = best.attributes?.files?.[0]?.file_id;

    return {
      matched: true,
      confidence: exactMatch ? 90 : 70,
      matchSource: "title",
      confirmedTitle: subtitleTitle,
      confirmedYear: subtitleYear,
      subtitleId: fileId?.toString(),
    };
  } catch (err) {
    console.error("OpenSubtitles title search error:", err);
    return { matched: false, confidence: 0, matchSource: "none" };
  }
}

async function searchByDialogue(
  dialogue: string,
  apiKey: string
): Promise<SubtitleSearchResult> {
  try {
    // Clean up dialogue — remove quotes, trim
    const cleaned = dialogue.replace(/['"]/g, "").trim().slice(0, 100);
    if (!cleaned || cleaned.length < 8) {
      return { matched: false, confidence: 0, matchSource: "none" };
    }

    const url = `${OPENSUBTITLES_BASE}/subtitles?query=${encodeURIComponent(cleaned)}&languages=en&order_by=download_count`;

    const res = await fetch(url, {
      headers: {
        "Api-Key": apiKey,
        "Content-Type": "application/json",
        "User-Agent": "VortexMovieAnalyzer v1.0",
      },
    });

    if (!res.ok) {
      return { matched: false, confidence: 0, matchSource: "none" };
    }

    const data = await res.json();
    const results = data.data || [];

    if (results.length === 0) {
      return { matched: false, confidence: 0, matchSource: "none" };
    }

    const best = results[0];
    const subtitleTitle =
      best.attributes?.feature_details?.title ||
      best.attributes?.feature_details?.movie_name ||
      best.attributes?.movie_name ||
      "Unknown";
    const subtitleYear =
      best.attributes?.feature_details?.year?.toString() || "—";

    return {
      matched: true,
      confidence: 80,
      matchSource: "dialogue",
      confirmedTitle: subtitleTitle,
      confirmedYear: subtitleYear,
      matchedLine: cleaned,
    };
  } catch (err) {
    console.error("OpenSubtitles dialogue search error:", err);
    return { matched: false, confidence: 0, matchSource: "none" };
  }
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.OPENSUBTITLES_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OpenSubtitles API key not configured" },
        { status: 500 }
      );
    }

    const body = await req.json();
    const {
      title,
      year,
      mediaType = "movie",
      dialogue,
    }: {
      title: string;
      year: string;
      mediaType?: string;
      dialogue?: string;
    } = body;

    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    // Run title search always
    // Run dialogue search only if dialogue was provided
    const searches: Promise<SubtitleSearchResult>[] = [
      searchByTitle(title, year, mediaType, apiKey),
    ];

    if (dialogue && dialogue.length > 8) {
      searches.push(searchByDialogue(dialogue, apiKey));
    }

    const results = await Promise.all(searches);
    const titleResult = results[0];
    const dialogueResult = results[1] || { matched: false, confidence: 0, matchSource: "none" as const };

    // Combine signals
    let finalConfidence = 0;
    let finalMatch = false;
    let matchSource: "title" | "dialogue" | "both" | "none" = "none";
    let confirmedTitle = title;
    let confirmedYear = year;
    let matchedLine: string | undefined;

    if (titleResult.matched && dialogueResult.matched) {
      // Both matched — check if they agree
      const titlesMatch =
        titleResult.confirmedTitle?.toLowerCase() ===
        dialogueResult.confirmedTitle?.toLowerCase();

      if (titlesMatch) {
        // Strong agreement — boost confidence
        finalConfidence = Math.min(
          100,
          Math.round((titleResult.confidence + dialogueResult.confidence) / 2) + 10
        );
        matchSource = "both";
      } else {
        // Disagreement — trust dialogue more (it's more specific)
        finalConfidence = dialogueResult.confidence;
        matchSource = "dialogue";
        confirmedTitle = dialogueResult.confirmedTitle || title;
        confirmedYear = dialogueResult.confirmedYear || year;
      }
      finalMatch = true;
      matchedLine = dialogueResult.matchedLine;
    } else if (titleResult.matched) {
      finalConfidence = titleResult.confidence;
      finalMatch = true;
      matchSource = "title";
      confirmedTitle = titleResult.confirmedTitle || title;
      confirmedYear = titleResult.confirmedYear || year;
    } else if (dialogueResult.matched) {
      finalConfidence = dialogueResult.confidence;
      finalMatch = true;
      matchSource = "dialogue";
      confirmedTitle = dialogueResult.confirmedTitle || title;
      confirmedYear = dialogueResult.confirmedYear || year;
      matchedLine = dialogueResult.matchedLine;
    }

    return NextResponse.json({
      matched: finalMatch,
      confidence: finalConfidence,
      matchSource,
      confirmedTitle,
      confirmedYear,
      matchedLine,
      subtitleId: titleResult.subtitleId,
    });
  } catch (err) {
    console.error("Subtitle matching error:", err);
    return NextResponse.json(
      { error: "Subtitle matching failed" },
      { status: 500 }
    );
  }
}