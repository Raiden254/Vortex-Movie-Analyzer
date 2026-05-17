import { NextRequest, NextResponse } from "next/server";
import { Pinecone } from "@pinecone-database/pinecone";

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
  tmdb: null,
  subtitleMatch: null,
  clipMatch: null,
};

const INDEX_NAME = "vortex-movies";

// ─── PINECONE VERIFICATION ────────────────────────────────────────────────────

interface PineconeVerification {
  verified: boolean;
  confidence: number;
  databaseTitle?: string;
  databaseYear?: string;
  databaseGenre?: string;
  databaseDirector?: string;
}

async function verifyWithPinecone(
  title: string,
  year: string
): Promise<PineconeVerification> {
  const pineconeKey = process.env.PINECONE_API_KEY;
  if (!pineconeKey) return { verified: false, confidence: 0 };

  try {
    const pinecone = new Pinecone({ apiKey: pineconeKey });
    const index = pinecone.index(INDEX_NAME);

    const stats = await index.describeIndexStats();
    const totalVectors = stats.totalRecordCount || 0;
    if (totalVectors === 0) return { verified: false, confidence: 0 };

    const dummyVector = new Array(512).fill(0);
    dummyVector[0] = 1;

    const queryResponse = await index.query({
      vector: dummyVector,
      topK: 100,
      includeMetadata: true,
    });

    const matches = queryResponse.matches || [];
    const cleanTitle = title.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();

    const titleMatch = matches.find((m) => {
      const dbTitle = ((m.metadata?.title as string) || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .trim();
      return (
        dbTitle === cleanTitle ||
        dbTitle.includes(cleanTitle) ||
        cleanTitle.includes(dbTitle)
      );
    });

    if (!titleMatch) return { verified: false, confidence: 0 };

    const dbYear = (titleMatch.metadata?.year as string) || "";
    const yearMatches = dbYear === year || !year || year === "—";

    return {
      verified: true,
      confidence: yearMatches ? 15 : 8,
      databaseTitle: titleMatch.metadata?.title as string,
      databaseYear: dbYear,
      databaseGenre: titleMatch.metadata?.genre as string,
      databaseDirector: titleMatch.metadata?.director as string,
    };
  } catch (err) {
    console.error("Pinecone verification error:", err);
    return { verified: false, confidence: 0 };
  }
}

// ─── TMDB ─────────────────────────────────────────────────────────────────────

async function fetchTMDB(title: string, year: string, knownMediaType?: string) {
  try {
    const tmdbKey = process.env.TMDB_API_KEY;
    if (!tmdbKey) return null;

    const [movieRes, tvRes] = await Promise.all([
      fetch(`https://api.themoviedb.org/3/search/movie?api_key=${tmdbKey}&query=${encodeURIComponent(title)}&language=en-US&page=1`),
      fetch(`https://api.themoviedb.org/3/search/tv?api_key=${tmdbKey}&query=${encodeURIComponent(title)}&language=en-US&page=1`),
    ]);

    const [movieData, tvData] = await Promise.all([
      movieRes.json(),
      tvRes.json(),
    ]);

    const movies = movieData.results || [];
    const shows = tvData.results || [];

    let best = null;
    let isTV = false;

    if (knownMediaType === "tv") {
      isTV = true;
      best = shows.find((s: { first_air_date?: string }) =>
        s.first_air_date?.slice(0, 4) === year
      ) || shows.sort((a: { popularity: number }, b: { popularity: number }) =>
        b.popularity - a.popularity
      )[0] || null;
    } else if (knownMediaType === "movie") {
      isTV = false;
      best = movies.find((m: { release_date?: string }) =>
        m.release_date?.slice(0, 4) === year
      ) || movies[0] || null;
    } else {
      for (const m of movies) {
        if (m.release_date?.slice(0, 4) === year) { best = m; isTV = false; break; }
      }
      if (!best) {
        for (const s of shows) {
          if (s.first_air_date?.slice(0, 4) === year) { best = s; isTV = true; break; }
        }
      }
      if (!best) {
        const allResults = [
          ...movies.map((m: { popularity: number }) => ({ ...m, _isTV: false })),
          ...shows.map((s: { popularity: number }) => ({ ...s, _isTV: true })),
        ].sort((a, b) => b.popularity - a.popularity);
        if (allResults.length > 0) {
          best = allResults[0];
          isTV = allResults[0]._isTV;
        }
      }
    }

    if (!best) return null;

    const tmdbType = isTV ? "tv" : "movie";
    const id = best.id;

    const [detailsRes, creditsRes, videosRes, providersRes] = await Promise.all([
      fetch(`https://api.themoviedb.org/3/${tmdbType}/${id}?api_key=${tmdbKey}&language=en-US`),
      fetch(`https://api.themoviedb.org/3/${tmdbType}/${id}/credits?api_key=${tmdbKey}&language=en-US`),
      fetch(`https://api.themoviedb.org/3/${tmdbType}/${id}/videos?api_key=${tmdbKey}&language=en-US`),
      fetch(`https://api.themoviedb.org/3/${tmdbType}/${id}/watch/providers?api_key=${tmdbKey}`),
    ]);

    const [details, credits, videos, providers] = await Promise.all([
      detailsRes.json(),
      creditsRes.json(),
      videosRes.json(),
      providersRes.json(),
    ]);

    const trailer = videos.results?.find(
      (v: { type: string; site: string; key: string }) =>
        v.type === "Trailer" && v.site === "YouTube"
    );

    const cast = credits.cast?.slice(0, 6).map((c: { name: string; character: string; profile_path: string }) => ({
      name: c.name,
      character: c.character,
      photo: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : null,
    }));

    const streaming = providers.results?.US?.flatrate?.slice(0, 4).map(
      (p: { provider_name: string; logo_path: string }) => ({
        name: p.provider_name,
        logo: `https://image.tmdb.org/t/p/w92${p.logo_path}`,
      })
    ) || [];

    return {
      id,
      poster: details.poster_path ? `https://image.tmdb.org/t/p/w500${details.poster_path}` : null,
      backdrop: details.backdrop_path ? `https://image.tmdb.org/t/p/w1280${details.backdrop_path}` : null,
      tagline: details.tagline || "",
      voteAverage: details.vote_average?.toFixed(1) || "—",
      voteCount: details.vote_count || 0,
      genres: details.genres?.map((g: { name: string }) => g.name) || [],
      trailer: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
      cast: cast || [],
      streaming,
      tmdbUrl: `https://www.themoviedb.org/${tmdbType}/${id}`,
    };
  } catch (err) {
    console.error("TMDB fetch error:", err);
    return null;
  }
}

// ─── SUBTITLE MATCHING ────────────────────────────────────────────────────────

interface SubtitleResult {
  matched: boolean;
  confidence: number;
  matchSource: string;
  confirmedTitle?: string;
  confirmedYear?: string;
  matchedLine?: string;
}

async function fetchSubtitleMatch(
  title: string,
  year: string,
  mediaType: string,
  dialogue?: string
): Promise<SubtitleResult | null> {
  try {
    const apiKey = process.env.OPENSUBTITLES_API_KEY;
    if (!apiKey) return null;

    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";

    const res = await fetch(`${baseUrl}/api/subtitles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, year, mediaType, dialogue }),
    });

    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error("Subtitle match fetch error:", err);
    return null;
  }
}

// ─── CONFIDENCE COMBINER ──────────────────────────────────────────────────────

function combineConfidence(
  geminiConfidence: number,
  subtitleResult: SubtitleResult | null,
  geminiTitle: string
): { finalConfidence: number; boosted: boolean; overridden: boolean; overrideTitle?: string } {
  if (!subtitleResult || !subtitleResult.matched) {
    return { finalConfidence: geminiConfidence, boosted: false, overridden: false };
  }

  const subTitle = subtitleResult.confirmedTitle?.toLowerCase().trim() || "";
  const gemTitle = geminiTitle.toLowerCase().trim();
  const titlesAgree =
    subTitle === gemTitle ||
    subTitle.includes(gemTitle) ||
    gemTitle.includes(subTitle);

  if (titlesAgree) {
    const boost = subtitleResult.matchSource === "both" ? 10 : 7;
    return {
      finalConfidence: Math.min(100, geminiConfidence + boost),
      boosted: true,
      overridden: false,
    };
  } else if (subtitleResult.confidence > geminiConfidence + 15) {
    return {
      finalConfidence: subtitleResult.confidence,
      boosted: false,
      overridden: true,
      overrideTitle: subtitleResult.confirmedTitle,
    };
  }

  return { finalConfidence: geminiConfidence, boosted: false, overridden: false };
}

// ─── GEMINI IDENTIFICATION ────────────────────────────────────────────────────

async function runGemini(base64: string, mimeType: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const prompt = `You are an elite movie and TV show scene identification system with encyclopedic knowledge of cinema and television worldwide, including Hollywood, Bollywood, African cinema, anime, K-dramas, European films, and all streaming content.

TASK: Identify the exact movie or TV show this image is from.

ANALYSIS APPROACH — examine these signals in order:
1. VISUAL FINGERPRINTS: Cinematography style, lighting setup, color grading signature, aspect ratio, film grain/digital look
2. CHARACTER RECOGNITION: Face features, hairstyles, costumes, makeup, body language, distinctive props
3. SET & LOCATION: Architecture, interior design era, location geography, weather/time of day
4. TEXT & LOGOS: Any visible titles, subtitles, credits, watermarks, channel logos, streaming platform bugs
5. ART STYLE: For animation — distinguish between anime (Japanese), manhwa (Korean), cartoon (Western), CGI style
6. PRODUCTION ERA: Film stock quality, technology visible, fashion, cars, phones suggest the decade
7. GENRE MARKERS: Horror lighting, rom-com color palette, action blocking, documentary handheld style

COMMON MISTAKES TO AVOID:
- Do NOT confuse similar-looking shows (e.g. The Boys vs Invincible, Attack on Titan vs Vinland Saga)
- Do NOT guess a popular title when visual evidence points elsewhere
- Do NOT ignore text/logos visible in frame — they are definitive proof
- For anime: pay close attention to art style differences between studios (MAPPA, Ufotable, Bones, etc.)
- For Netflix/HBO/Amazon shows: look for their distinctive production quality signatures

CONFIDENCE CALIBRATION:
- 90-100%: Definitive identification — you can see title text, recognizable unique character, or unmistakable scene
- 70-89%: Strong identification — multiple visual signals align clearly
- 50-69%: Probable identification — some signals match but uncertainty exists
- Below 50%: Uncertain — provide best guess with alternatives
- 0%: Cannot identify — return UNKNOWN

You MUST respond with ONLY a valid JSON object. No explanation, no markdown, no backticks, no text before or after. Just the raw JSON.

Required structure:
{
  "title": "EXACT TITLE IN CAPS",
  "year": "2019",
  "director": "Full Name",
  "genre": "Primary Genre / Secondary Genre",
  "runtime": "45 min per episode",
  "rating": "8.5/10",
  "description": "One precise sentence describing the plot.",
  "scene": "Specific description of what is happening in this exact scene and where it falls in the story",
  "mediaType": "tv",
  "dialogue": "Any spoken words visible or recognizable in this scene",
  "confidence": 87,
  "alternatives": [
    {"title": "Second Most Likely", "year": "2018", "confidence": 35},
    {"title": "Third Most Likely", "year": "2020", "confidence": 20},
    {"title": "Fourth Option", "year": "2015", "confidence": 10}
  ],
  "signals": {
    "visual": 90,
    "dialogue": 60,
    "colorGrade": 80,
    "textTitles": 40
  }
}

RULES:
- "mediaType" must be exactly "tv" or "movie"
- "confidence" must be an integer 0-100
- All signal values must be integers 0-100
- Always provide 3 alternatives even if confidence is very low
- If UNKNOWN, still provide best guesses in alternatives
- Title must be the ORIGINAL title (not a localized translation)`;

  const requestBody = {
    contents: [
      {
        parts: [
          { inline_data: { mime_type: mimeType, data: base64 } },
          { text: prompt },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.05,
      maxOutputTokens: 2048,
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

  // Handle 503 with one retry
  if (response.status === 503) {
    console.log("Gemini 503 — retrying in 5s...");
    await new Promise(r => setTimeout(r, 5000));
    const retry = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      }
    );
    if (!retry.ok) return { _serviceUnavailable: true };
    const retryData = await retry.json();
    const retryText = retryData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!retryText) return null;
    try { return JSON.parse(retryText.trim()); } catch {
      const m = retryText.match(/\{[\s\S]*\}/);
      if (m) try { return JSON.parse(m[0]); } catch { /* ignore */ }
    }
    return null;
  }

  if (response.status === 429) return { _quotaExceeded: true };

  if (!response.ok) {
    console.error("Gemini error:", response.status);
    return null;
  }

  const geminiData = await response.json();
  const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  console.log("RAW GEMINI TEXT:", rawText);
  if (!rawText) return null;

  // Try multiple parsing strategies
  const strategies = [
    () => JSON.parse(rawText.trim()),
    () => { const m = rawText.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); throw new Error(); },
    () => { const c = rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim(); const m = c.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); throw new Error(); },
  ];

  for (const attempt of strategies) {
    try { return attempt(); } catch { continue; }
  }

  console.error("All Gemini parsing failed:", rawText);
  return null;
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (file && file.size > 4 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File too large. Please use an image under 4MB." },
        { status: 413 }
      );
    }

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const base64 = Buffer.from(bytes).toString("base64");
    const mimeType = file.type || "image/jpeg";

    // Step 1: Run Gemini
    const geminiResult = await runGemini(base64, mimeType);

    if (geminiResult?._quotaExceeded) {
      return NextResponse.json({
        ...FALLBACK,
        title: "QUOTA EXCEEDED",
        description: "Vortex is getting a lot of love right now! Daily AI limit reached. Please try again in a few hours.",
      });
    }

    if (geminiResult?._serviceUnavailable) {
      return NextResponse.json({
        ...FALLBACK,
        title: "SERVICE BUSY",
        description: "Vortex AI is experiencing high demand right now. Please try again in a moment.",
      });
    }

    if (!geminiResult) return NextResponse.json(FALLBACK);

    const geminiTitle = geminiResult.title || "UNKNOWN";
    const geminiYear = geminiResult.year || "—";
    const geminiConfidence = geminiResult.confidence ?? 0;

    // Step 2: Pinecone + TMDB + Subtitles in parallel
    const [pineconeVerification, tmdbData, subtitleResult] = await Promise.all([
      geminiTitle !== "UNKNOWN"
        ? verifyWithPinecone(geminiTitle, geminiYear)
        : Promise.resolve({ verified: false, confidence: 0 }),
      geminiTitle !== "UNKNOWN"
        ? fetchTMDB(geminiTitle, geminiYear, geminiResult.mediaType)
        : Promise.resolve(null),
      geminiTitle !== "UNKNOWN"
        ? fetchSubtitleMatch(
            geminiTitle,
            geminiYear,
            geminiResult.mediaType || "movie",
            geminiResult.dialogue
          )
        : Promise.resolve(null),
    ]);

    // Step 3: Combine confidence signals
    let finalConfidence = geminiConfidence;
    let finalTitle = geminiTitle;
    let finalTmdb = tmdbData;

    if (pineconeVerification.verified) {
      finalConfidence = Math.min(100, finalConfidence + pineconeVerification.confidence);
      console.log(`Pinecone verified "${geminiTitle}" — boosted by ${pineconeVerification.confidence}%`);
    }

    const { finalConfidence: subtitleConfidence, boosted, overridden, overrideTitle } =
      combineConfidence(finalConfidence, subtitleResult, finalTitle);

    finalConfidence = subtitleConfidence;

    if (overridden && overrideTitle) {
      finalTitle = overrideTitle.toUpperCase();
      finalTmdb = await fetchTMDB(
        overrideTitle,
        subtitleResult?.confirmedYear || geminiYear,
        geminiResult.mediaType
      );
    }

    // Step 4: Return final result
    return NextResponse.json({
      title: finalTitle || "UNKNOWN",
      year: geminiYear,
      director: geminiResult.director || "—",
      genre: geminiResult.genre || "—",
      runtime: geminiResult.runtime || "—",
      rating: geminiResult.rating || "—",
      description: geminiResult.description || "No description available.",
      scene: geminiResult.scene || "—",
      confidence: finalConfidence,
      alternatives: Array.isArray(geminiResult.alternatives) ? geminiResult.alternatives : [],
      signals: {
        visual: geminiResult.signals?.visual ?? 0,
        dialogue: geminiResult.signals?.dialogue ?? 0,
        colorGrade: geminiResult.signals?.colorGrade ?? 0,
        textTitles: geminiResult.signals?.textTitles ?? 0,
      },
      tmdb: finalTmdb,
      subtitleMatch: subtitleResult
        ? {
            matched: subtitleResult.matched,
            matchSource: subtitleResult.matchSource,
            matchedLine: subtitleResult.matchedLine || null,
            boosted,
            overridden,
          }
        : null,
      clipMatch: pineconeVerification.verified
        ? {
            matched: true,
            confidence: pineconeVerification.confidence,
            score: 1.0,
            source: "pinecone-title-verification",
          }
        : null,
    });

  } catch (error) {
    console.error("Unexpected error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}