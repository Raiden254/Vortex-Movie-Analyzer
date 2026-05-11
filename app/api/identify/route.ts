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
  tmdb: null,
  subtitleMatch: null,
};

// ─── TMDB ────────────────────────────────────────────────────────────────────

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
      ) || shows[0] || null;
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

// ─── SUBTITLE MATCHING ───────────────────────────────────────────────────────

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

    // Call our own subtitle route internally
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

// ─── CONFIDENCE COMBINER ─────────────────────────────────────────────────────

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
  const titlesAgree = subTitle === gemTitle || subTitle.includes(gemTitle) || gemTitle.includes(subTitle);

  if (titlesAgree) {
    // Both signals agree — boost confidence
    const boost = subtitleResult.matchSource === "both" ? 10 : 7;
    const boosted = Math.min(100, geminiConfidence + boost);
    return { finalConfidence: boosted, boosted: true, overridden: false };
  } else if (subtitleResult.confidence > geminiConfidence + 15) {
    // Subtitle is much more confident and disagrees — override
    return {
      finalConfidence: subtitleResult.confidence,
      boosted: false,
      overridden: true,
      overrideTitle: subtitleResult.confirmedTitle,
    };
  }

  // Minor disagreement — keep Gemini but don't boost
  return { finalConfidence: geminiConfidence, boosted: false, overridden: false };
}

// ─── MAIN HANDLER ────────────────────────────────────────────────────────────

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

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "API key not configured." }, { status: 500 });
    }

    const bytes = await file.arrayBuffer();
    const base64 = Buffer.from(bytes).toString("base64");
    const mimeType = file.type || "image/jpeg";

    const prompt = `You are an expert identifier of movies, TV shows, and animated content including anime, cartoons, and animated films.

Analyze this image carefully and identify what movie, TV show, or animated series it is from.

Pay close attention to:
- Character designs, art style, and animation quality
- Color palette and visual aesthetic
- Any visible text, logos, or title cards
- Scene composition and setting
- Distinctive character features (hair, costume, powers, weapons)
- Background art style (anime vs western animation vs CGI)

For animated content specifically:
- Anime shows have distinct Japanese animation styles
- Western cartoons have different proportions and color usage
- Note whether it is 2D traditional, 2D digital, or 3D CGI animation

You MUST respond with ONLY a JSON object. No explanation, no markdown, no backticks. Just the raw JSON.

Use exactly this structure:
{"title":"MOVIE OR SHOW TITLE IN CAPS","year":"2021","director":"Director Name","genre":"Animation / Superhero","runtime":"45 min","rating":"8.5/10","description":"Brief one sentence plot summary.","scene":"Which part of the movie or show this is from","mediaType":"tv","confidence":85,"alternatives":[{"title":"Other Show","year":"2010","confidence":45},{"title":"Another Show","year":"2015","confidence":30},{"title":"Third Option","year":"2018","confidence":20}],"signals":{"visual":85,"dialogue":70,"colorGrade":80,"textTitles":60}}

IMPORTANT: 
- Set "mediaType" to "tv" for TV shows and series, or "movie" for films
- For animated shows be very precise — Invincible, Avatar The Last Airbender, Attack on Titan, One Piece etc all have very distinct styles
- If you cannot identify it, use "UNKNOWN" as title and 0 as confidence but still return valid JSON.`;

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

    if (response.status === 429) {
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
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    console.log("RAW GEMINI TEXT:", rawText);

    if (!rawText) return NextResponse.json(FALLBACK);

    let result = null;
    try {
      result = JSON.parse(rawText.trim());
    } catch {
      try {
        const match = rawText.match(/\{[\s\S]*\}/);
        if (match) result = JSON.parse(match[0]);
      } catch {
        try {
          const cleaned = rawText
            .replace(/```json\n?/g, "")
            .replace(/```\n?/g, "")
            .trim();
          const match2 = cleaned.match(/\{[\s\S]*\}/);
          if (match2) result = JSON.parse(match2[0]);
        } catch {
          console.error("All parsing failed:", rawText);
        }
      }
    }

    if (!result) return NextResponse.json(FALLBACK);

    // Run TMDB and subtitle matching in parallel
    const [tmdbData, subtitleResult] = await Promise.all([
      result.title !== "UNKNOWN"
        ? fetchTMDB(result.title, result.year, result.mediaType)
        : Promise.resolve(null),
      result.title !== "UNKNOWN"
        ? fetchSubtitleMatch(
            result.title,
            result.year,
            result.mediaType || "movie",
            result.dialogue
          )
        : Promise.resolve(null),
    ]);

    // Combine Gemini + subtitle confidence
    const { finalConfidence, boosted, overridden, overrideTitle } = combineConfidence(
      result.confidence ?? 0,
      subtitleResult,
      result.title
    );

    // If subtitle overrides Gemini's title, re-fetch TMDB with the correct title
    let finalTmdb = tmdbData;
    let finalTitle = result.title;
    if (overridden && overrideTitle) {
      finalTitle = overrideTitle.toUpperCase();
      finalTmdb = await fetchTMDB(
        overrideTitle,
        subtitleResult?.confirmedYear || result.year,
        result.mediaType
      );
    }

    const safeResult = {
      title: finalTitle || "UNKNOWN",
      year: result.year || "—",
      director: result.director || "—",
      genre: result.genre || "—",
      runtime: result.runtime || "—",
      rating: result.rating || "—",
      description: result.description || "No description available.",
      scene: result.scene || "—",
      confidence: finalConfidence,
      alternatives: Array.isArray(result.alternatives) ? result.alternatives : [],
      signals: {
        visual: result.signals?.visual ?? 0,
        dialogue: result.signals?.dialogue ?? 0,
        colorGrade: result.signals?.colorGrade ?? 0,
        textTitles: result.signals?.textTitles ?? 0,
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