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
};

// Fetch movie details from TMDB
async function fetchTMDB(title: string, year: string) {
  try {
    const tmdbKey = process.env.TMDB_API_KEY;
    if (!tmdbKey) return null;

    // Search for the movie
    const searchRes = await fetch(
      `https://api.themoviedb.org/3/search/movie?api_key=${tmdbKey}&query=${encodeURIComponent(title)}&year=${year}&language=en-US&page=1`
    );
    if (!searchRes.ok) return null;

    const searchData = await searchRes.json();
    const movie = searchData.results?.[0];
    if (!movie) return null;

    const movieId = movie.id;

    // Fetch full details, credits, and videos in parallel
    const [detailsRes, creditsRes, videosRes, providersRes] = await Promise.all([
      fetch(`https://api.themoviedb.org/3/movie/${movieId}?api_key=${tmdbKey}&language=en-US`),
      fetch(`https://api.themoviedb.org/3/movie/${movieId}/credits?api_key=${tmdbKey}&language=en-US`),
      fetch(`https://api.themoviedb.org/3/movie/${movieId}/videos?api_key=${tmdbKey}&language=en-US`),
      fetch(`https://api.themoviedb.org/3/movie/${movieId}/watch/providers?api_key=${tmdbKey}`),
    ]);

    const [details, credits, videos, providers] = await Promise.all([
      detailsRes.json(),
      creditsRes.json(),
      videosRes.json(),
      providersRes.json(),
    ]);

    // Get trailer
    const trailer = videos.results?.find(
      (v: { type: string; site: string; key: string }) =>
        v.type === "Trailer" && v.site === "YouTube"
    );

    // Get top cast
    const cast = credits.cast?.slice(0, 6).map((c: { name: string; character: string; profile_path: string }) => ({
      name: c.name,
      character: c.character,
      photo: c.profile_path
        ? `https://image.tmdb.org/t/p/w185${c.profile_path}`
        : null,
    }));

    // Get streaming providers (US)
    const streaming = providers.results?.US?.flatrate?.slice(0, 4).map(
      (p: { provider_name: string; logo_path: string }) => ({
        name: p.provider_name,
        logo: `https://image.tmdb.org/t/p/w92${p.logo_path}`,
      })
    ) || [];

    return {
      id: movieId,
      poster: details.poster_path
        ? `https://image.tmdb.org/t/p/w500${details.poster_path}`
        : null,
      backdrop: details.backdrop_path
        ? `https://image.tmdb.org/t/p/w1280${details.backdrop_path}`
        : null,
      tagline: details.tagline || "",
      voteAverage: details.vote_average?.toFixed(1) || "—",
      voteCount: details.vote_count || 0,
      genres: details.genres?.map((g: { name: string }) => g.name) || [],
      trailer: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
      cast: cast || [],
      streaming,
      tmdbUrl: `https://www.themoviedb.org/movie/${movieId}`,
    };
  } catch (err) {
    console.error("TMDB fetch error:", err);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
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
    console.log("FULL RESPONSE:", JSON.stringify(geminiData?.candidates?.[0]));

    if (!rawText) return NextResponse.json(FALLBACK);

    // Try multiple parsing strategies
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

    // Fetch TMDB data in parallel with building safe result
    const tmdbData = result.title !== "UNKNOWN"
      ? await fetchTMDB(result.title, result.year)
      : null;

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
      tmdb: tmdbData,
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