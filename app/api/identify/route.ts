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

// ─── CLIP FINGERPRINT ─────────────────────────────────────────────────────────

async function getClipEmbedding(
  base64: string,
  mimeType: string
): Promise<number[] | null> {
  const hfKey = process.env.HUGGINGFACE_API_KEY;
  if (!hfKey) return null;

  try {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: mimeType });

    const doRequest = () =>
      fetch(
        "https://api-inference.huggingface.co/models/openai/clip-vit-base-patch32",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${hfKey}`,
            "Content-Type": mimeType,
          },
          body: blob,
        }
      );

    let res = await doRequest();

    // Cold start — model loading, wait and retry once
    if (res.status === 503) {
      await new Promise((r) => setTimeout(r, 10000));
      res = await doRequest();
    }

    if (!res.ok) {
      console.error("HuggingFace CLIP error:", res.status);
      return null;
    }

    const data = await res.json();
    const embedding = extractEmbedding(data);
    if (!embedding) return null;

    // Normalize for cosine similarity
    const magnitude = Math.sqrt(
      embedding.reduce((sum: number, v: number) => sum + v * v, 0)
    );
    return magnitude === 0 ? embedding : embedding.map((v: number) => v / magnitude);
  } catch (err) {
    console.error("CLIP embedding error:", err);
    return null;
  }
}

function extractEmbedding(data: unknown): number[] | null {
  if (Array.isArray(data)) {
    if (typeof data[0] === "number") return data as number[];
    if (Array.isArray(data[0])) return data[0] as number[];
  }
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.embedding)) return obj.embedding as number[];
    if (Array.isArray(obj.embeddings)) {
      const emb = obj.embeddings as unknown[];
      return (Array.isArray(emb[0]) ? emb[0] : emb) as number[];
    }
    if (Array.isArray(obj.image_embeds)) return obj.image_embeds as number[];
  }
  return null;
}

// ─── PINECONE SEARCH ──────────────────────────────────────────────────────────

interface VectorMatch {
  id: string;
  score: number;
  metadata: {
    title?: string;
    year?: string;
    mediaType?: string;
    director?: string;
    genre?: string;
    scene?: string;
    frameTime?: string;
  };
}

interface ClipMatch {
  matched: boolean;
  confidence: number;
  score: number;
  title?: string;
  year?: string;
  mediaType?: string;
  director?: string;
  genre?: string;
  scene?: string;
  alternatives: { title: string; year: string; confidence: number }[];
}

function scoreToConfidence(score: number): number {
  if (score >= 0.95) return 98;
  if (score >= 0.90) return 92;
  if (score >= 0.85) return 85;
  if (score >= 0.80) return 75;
  if (score >= 0.75) return 65;
  if (score >= 0.70) return 55;
  return Math.round(score * 50);
}

async function searchPinecone(embedding: number[]): Promise<ClipMatch | null> {
  const pineconeKey = process.env.PINECONE_API_KEY;
  if (!pineconeKey) return null;

  try {
    const pinecone = new Pinecone({ apiKey: pineconeKey });
    const index = pinecone.index(INDEX_NAME);

    const queryResponse = await index.query({
      vector: embedding,
      topK: 5,
      includeMetadata: true,
    });

    const matches = queryResponse.matches as VectorMatch[];
    if (!matches || matches.length === 0) {
      return { matched: false, confidence: 0, score: 0, alternatives: [] };
    }

    const best = matches[0];
    const bestScore = best.score || 0;
    const THRESHOLD = 0.70;

    const alternatives = matches
      .slice(1, 4)
      .filter((m) => (m.score || 0) >= 0.60)
      .map((m) => ({
        title: m.metadata?.title || "Unknown",
        year: m.metadata?.year || "—",
        confidence: scoreToConfidence(m.score || 0),
      }));

    if (bestScore < THRESHOLD) {
      return {
        matched: false,
        confidence: scoreToConfidence(bestScore),
        score: bestScore,
        alternatives,
      };
    }

    return {
      matched: true,
      confidence: scoreToConfidence(bestScore),
      score: bestScore,
      title: best.metadata?.title,
      year: best.metadata?.year,
      mediaType: best.metadata?.mediaType,
      director: best.metadata?.director,
      genre: best.metadata?.genre,
      scene: best.metadata?.scene,
      alternatives,
    };
  } catch (err) {
    console.error("Pinecone search error:", err);
    return null;
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

async function runGemini(
  base64: string,
  mimeType: string,
  clipHint?: { title?: string; year?: string; genre?: string }
) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  // If CLIP found a strong match, hint Gemini to confirm rather than guess
  const clipContext = clipHint?.title
    ? `\n\nIMPORTANT HINT: Visual fingerprint analysis strongly suggests this is from "${clipHint.title}" (${clipHint.year || "unknown year"}). Confirm or correct this if you are confident otherwise.`
    : "";

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
{"title":"MOVIE OR SHOW TITLE IN CAPS","year":"2021","director":"Director Name","genre":"Animation / Superhero","runtime":"45 min","rating":"8.5/10","description":"Brief one sentence plot summary.","scene":"Which part of the movie or show this is from","mediaType":"tv","dialogue":"Any visible or recognizable dialogue from this scene if present","confidence":85,"alternatives":[{"title":"Other Show","year":"2010","confidence":45},{"title":"Another Show","year":"2015","confidence":30},{"title":"Third Option","year":"2018","confidence":20}],"signals":{"visual":85,"dialogue":70,"colorGrade":80,"textTitles":60}}

IMPORTANT:
- Set "mediaType" to "tv" for TV shows and series, or "movie" for films
- For animated shows be very precise — Invincible, Avatar The Last Airbender, Attack on Titan, One Piece etc all have very distinct styles
- If you can see or recognize any dialogue or spoken lines in this scene, include them in the "dialogue" field
- If you cannot identify it, use "UNKNOWN" as title and 0 as confidence but still return valid JSON${clipContext}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
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
      }),
    }
  );

  if (response.status === 429) return { _quotaExceeded: true };
  if (!response.ok) {
    console.error("Gemini error:", response.status);
    return null;
  }

  const geminiData = await response.json();
  const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  console.log("RAW GEMINI TEXT:", rawText);
  if (!rawText) return null;

  // Try parsing with 3 fallback strategies
  for (const attempt of [
    () => JSON.parse(rawText.trim()),
    () => { const m = rawText.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); throw new Error(); },
    () => { const c = rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim(); const m = c.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); throw new Error(); },
  ]) {
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

    // ── Step 1: CLIP fingerprint ──────────────────────────────────────────────
    const embedding = await getClipEmbedding(base64, mimeType);

    // ── Step 2: Pinecone vector search (runs in parallel with Gemini) ─────────
    const clipSearchPromise = embedding
      ? searchPinecone(embedding)
      : Promise.resolve(null);

    // ── Step 3: Gemini identification (with CLIP hint if strong match) ────────
    // We run CLIP search first with a short timeout so Gemini can be hinted
    let clipMatch: ClipMatch | null = null;
    let geminiResult = null;

    // Run both in parallel — Gemini doesn't wait for CLIP
    [clipMatch, geminiResult] = await Promise.all([
      clipSearchPromise,
      runGemini(base64, mimeType),
    ]);

    // Handle Gemini quota exceeded
    if (geminiResult?._quotaExceeded) {
      return NextResponse.json({
        ...FALLBACK,
        title: "QUOTA EXCEEDED",
        description: "Vortex is getting a lot of love right now! Daily AI limit reached. Please try again in a few hours.",
      });
    }

    // If CLIP found a strong match but Gemini failed, use CLIP result directly
    if (!geminiResult && clipMatch?.matched && clipMatch.title) {
      const tmdbData = await fetchTMDB(
        clipMatch.title,
        clipMatch.year || "—",
        clipMatch.mediaType
      );
      return NextResponse.json({
        ...FALLBACK,
        title: clipMatch.title.toUpperCase(),
        year: clipMatch.year || "—",
        director: clipMatch.director || "—",
        genre: clipMatch.genre || "—",
        confidence: clipMatch.confidence,
        alternatives: clipMatch.alternatives,
        tmdb: tmdbData,
        clipMatch: {
          matched: true,
          confidence: clipMatch.confidence,
          score: clipMatch.score,
          source: "pinecone",
        },
      });
    }

    if (!geminiResult) return NextResponse.json(FALLBACK);

    // ── Step 4: Merge CLIP + Gemini confidence ────────────────────────────────
    let mergedConfidence = geminiResult.confidence ?? 0;
    let mergedTitle = geminiResult.title || "UNKNOWN";

    if (clipMatch?.matched && clipMatch.title) {
      const clipTitle = clipMatch.title.toLowerCase().trim();
      const gemTitle = mergedTitle.toLowerCase().trim();
      const agree =
        clipTitle === gemTitle ||
        clipTitle.includes(gemTitle) ||
        gemTitle.includes(clipTitle);

      if (agree) {
        // Both agree — boost confidence
        mergedConfidence = Math.min(
          100,
          Math.round((mergedConfidence + clipMatch.confidence) / 2) + 10
        );
      } else if (clipMatch.confidence > mergedConfidence + 20) {
        // CLIP is much more confident — override Gemini
        mergedTitle = clipMatch.title.toUpperCase();
        mergedConfidence = clipMatch.confidence;
      }
    }

    // ── Step 5: TMDB + Subtitle matching in parallel ──────────────────────────
    const [tmdbData, subtitleResult] = await Promise.all([
      mergedTitle !== "UNKNOWN"
        ? fetchTMDB(mergedTitle, geminiResult.year, geminiResult.mediaType)
        : Promise.resolve(null),
      mergedTitle !== "UNKNOWN"
        ? fetchSubtitleMatch(
            mergedTitle,
            geminiResult.year,
            geminiResult.mediaType || "movie",
            geminiResult.dialogue
          )
        : Promise.resolve(null),
    ]);

    // ── Step 6: Subtitle confidence boost ────────────────────────────────────
    const { finalConfidence, boosted, overridden, overrideTitle } =
      combineConfidence(mergedConfidence, subtitleResult, mergedTitle);

    let finalTitle = mergedTitle;
    let finalTmdb = tmdbData;

    if (overridden && overrideTitle) {
      finalTitle = overrideTitle.toUpperCase();
      finalTmdb = await fetchTMDB(
        overrideTitle,
        subtitleResult?.confirmedYear || geminiResult.year,
        geminiResult.mediaType
      );
    }

    // ── Step 7: Build final result ────────────────────────────────────────────
    return NextResponse.json({
      title: finalTitle || "UNKNOWN",
      year: geminiResult.year || "—",
      director: geminiResult.director || "—",
      genre: geminiResult.genre || "—",
      runtime: geminiResult.runtime || "—",
      rating: geminiResult.rating || "—",
      description: geminiResult.description || "No description available.",
      scene: geminiResult.scene || "—",
      confidence: finalConfidence,
      alternatives: Array.isArray(geminiResult.alternatives)
        ? geminiResult.alternatives
        : [],
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
      clipMatch: clipMatch
        ? {
            matched: clipMatch.matched,
            confidence: clipMatch.confidence,
            score: clipMatch.score,
            source: "pinecone",
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