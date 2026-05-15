/**
 * Vortex Auto Database Builder
 * Fetches top movies + TV shows from TMDB and indexes them with Xenova CLIP
 * Usage: npx tsx scripts/build-database.ts
 *
 * Runtime: ~2-3 hours for full run (800+ titles)
 * You can stop and restart — already-indexed titles are skipped
 */

import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";
import { pipeline, RawImage } from "@xenova/transformers";

// ─── LOAD ENV ─────────────────────────────────────────────────────────────────

function loadEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) {
    console.error("❌ .env.local not found");
    process.exit(1);
  }
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    process.env[trimmed.slice(0, eqIndex).trim()] = trimmed.slice(eqIndex + 1).trim();
  }
}

loadEnv();

const PINECONE_API_KEY = process.env.PINECONE_API_KEY!;
const TMDB_API_KEY = process.env.TMDB_API_KEY!;
const INDEX_NAME = "vortex-movies";
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const CONFIG = {
  movies: {
    pages: 25,        // 25 pages x 20 results = 500 movies
    enabled: true,
  },
  tvShows: {
    pages: 10,        // 10 pages x 20 results = 200 TV shows
    enabled: true,
  },
  anime: {
    pages: 5,         // 5 pages x 20 results = 100 anime
    enabled: true,
  },
  framesPerTitle: 2,
  includeTrailerThumbnail: true,   // fetch YouTube trailer thumbnail as extra frame
  delayBetweenFrames: 500,
  delayBetweenTitles: 1000,
  skipAlreadyIndexed: true,
  progressFile: "scripts/.index-progress.json",
};

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface TMDBMovie {
  id: number;
  title: string;
  release_date: string;
  poster_path: string | null;
  backdrop_path: string | null;
  genre_ids: number[];
  vote_average: number;
}

interface TMDBShow {
  id: number;
  name: string;
  first_air_date: string;
  poster_path: string | null;
  backdrop_path: string | null;
  genre_ids: number[];
  vote_average: number;
}

interface FrameEntry {
  url: string;
  scene: string;
  youtubeUrl?: string;
}

interface IndexEntry {
  id: string;
  title: string;
  year: string;
  mediaType: string;
  director: string;
  genre: string;
  trailerUrl?: string;
  frames: FrameEntry[];
}

// ─── PROGRESS TRACKING ────────────────────────────────────────────────────────

function loadProgress(): Set<string> {
  try {
    if (fs.existsSync(CONFIG.progressFile)) {
      const data = JSON.parse(fs.readFileSync(CONFIG.progressFile, "utf-8"));
      return new Set(data.indexed || []);
    }
  } catch { /* ignore */ }
  return new Set();
}

function saveProgress(indexed: Set<string>) {
  try {
    fs.writeFileSync(
      CONFIG.progressFile,
      JSON.stringify({ indexed: Array.from(indexed), updatedAt: new Date().toISOString() })
    );
  } catch { /* ignore */ }
}

// ─── TMDB GENRE MAP ───────────────────────────────────────────────────────────

const MOVIE_GENRES: Record<number, string> = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy",
  80: "Crime", 99: "Documentary", 18: "Drama", 10751: "Family",
  14: "Fantasy", 36: "History", 27: "Horror", 10402: "Music",
  9648: "Mystery", 10749: "Romance", 878: "Sci-Fi", 10770: "TV Movie",
  53: "Thriller", 10752: "War", 37: "Western",
};

const TV_GENRES: Record<number, string> = {
  10759: "Action & Adventure", 16: "Animation", 35: "Comedy",
  80: "Crime", 99: "Documentary", 18: "Drama", 10751: "Family",
  10762: "Kids", 9648: "Mystery", 10763: "News", 10764: "Reality",
  10765: "Sci-Fi & Fantasy", 10766: "Soap", 10767: "Talk",
  10768: "War & Politics", 37: "Western",
};

function getGenres(ids: number[], isTV: boolean): string {
  const map = isTV ? TV_GENRES : MOVIE_GENRES;
  return ids.slice(0, 2).map(id => map[id] || "").filter(Boolean).join(" / ") || "Unknown";
}

// ─── UTILITIES ────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function sanitizeId(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").slice(0, 60);
}

// Convert YouTube watch URL to thumbnail URL for embedding
function youtubeThumbUrl(youtubeUrl: string): string | null {
  try {
    const match = youtubeUrl.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (!match) return null;
    return `https://img.youtube.com/vi/${match[1]}/hqdefault.jpg`;
  } catch {
    return null;
  }
}

async function downloadImage(url: string, redirectCount = 0): Promise<Buffer | null> {
  if (redirectCount > 5) return null;
  return new Promise((resolve) => {
    const protocol = url.startsWith("https") ? https : http;
    const req = protocol.get(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; VortexIndexer/1.0)" },
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const loc = res.headers.location!;
        const fullUrl = loc.startsWith("http") ? loc : new URL(loc, url).toString();
        downloadImage(fullUrl, redirectCount + 1).then(resolve);
        return;
      }
      if (res.statusCode !== 200) { resolve(null); return; }
      const chunks: Buffer[] = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", () => resolve(null));
    });
    req.on("error", () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
  });
}

// ─── TMDB FETCHERS ────────────────────────────────────────────────────────────

async function fetchTMDBPage(endpoint: string, page: number): Promise<TMDBMovie[] | TMDBShow[]> {
  const url = `${TMDB_BASE}${endpoint}&api_key=${TMDB_API_KEY}&page=${page}&language=en-US`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || [];
  } catch {
    return [];
  }
}

// Fetch YouTube trailer URL from TMDB
async function fetchTrailerUrl(id: number, type: "movie" | "tv"): Promise<string | null> {
  try {
    const url = `${TMDB_BASE}/${type}/${id}/videos?api_key=${TMDB_API_KEY}&language=en-US`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const trailer = data.results?.find(
      (v: { type: string; site: string; key: string }) =>
        v.type === "Trailer" && v.site === "YouTube"
    );
    return trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null;
  } catch {
    return null;
  }
}

async function buildMovieList(): Promise<IndexEntry[]> {
  const entries: IndexEntry[] = [];

  // ── Popular Movies ──────────────────────────────────────────────────────────
  if (CONFIG.movies.enabled) {
    console.log(`\n📽️  Fetching top movies (${CONFIG.movies.pages} pages)...`);
    for (let page = 1; page <= CONFIG.movies.pages; page++) {
      const results = await fetchTMDBPage("/movie/popular?", page) as TMDBMovie[];
      for (const movie of results) {
        if (!movie.poster_path) continue;
        const year = movie.release_date?.slice(0, 4) || "Unknown";
        const frames: FrameEntry[] = [];

        if (movie.poster_path) {
          frames.push({ url: `${TMDB_IMG}${movie.poster_path}`, scene: "Movie poster" });
        }
        if (movie.backdrop_path && CONFIG.framesPerTitle >= 2) {
          frames.push({ url: `${TMDB_IMG}${movie.backdrop_path}`, scene: "Movie backdrop" });
        }

        // Fetch YouTube trailer and use its thumbnail as an extra frame
        let trailerUrl: string | undefined;
        if (CONFIG.includeTrailerThumbnail) {
          const trailer = await fetchTrailerUrl(movie.id, "movie");
          if (trailer) {
            trailerUrl = trailer;
            const thumbUrl = youtubeThumbUrl(trailer);
            if (thumbUrl) {
              frames.push({ url: thumbUrl, scene: "Trailer thumbnail", youtubeUrl: trailer });
            }
          }
          await sleep(150);
        }

        entries.push({
          id: `movie-${movie.id}`,
          title: movie.title,
          year,
          mediaType: "movie",
          director: "Unknown",
          genre: getGenres(movie.genre_ids, false),
          trailerUrl,
          frames,
        });
      }
      process.stdout.write(`\r   Page ${page}/${CONFIG.movies.pages} — ${entries.length} movies collected`);
      await sleep(250);
    }
    console.log(`\n   ✅ ${entries.length} movies collected`);
  }

  const movieCount = entries.length;

  // ── Popular TV Shows ────────────────────────────────────────────────────────
  if (CONFIG.tvShows.enabled) {
    console.log(`\n📺 Fetching top TV shows (${CONFIG.tvShows.pages} pages)...`);
    for (let page = 1; page <= CONFIG.tvShows.pages; page++) {
      const results = await fetchTMDBPage("/tv/popular?", page) as TMDBShow[];
      for (const show of results) {
        if (!show.poster_path) continue;
        const year = show.first_air_date?.slice(0, 4) || "Unknown";
        const frames: FrameEntry[] = [];

        if (show.poster_path) {
          frames.push({ url: `${TMDB_IMG}${show.poster_path}`, scene: "Series poster" });
        }
        if (show.backdrop_path && CONFIG.framesPerTitle >= 2) {
          frames.push({ url: `${TMDB_IMG}${show.backdrop_path}`, scene: "Series backdrop" });
        }

        let trailerUrl: string | undefined;
        if (CONFIG.includeTrailerThumbnail) {
          const trailer = await fetchTrailerUrl(show.id, "tv");
          if (trailer) {
            trailerUrl = trailer;
            const thumbUrl = youtubeThumbUrl(trailer);
            if (thumbUrl) {
              frames.push({ url: thumbUrl, scene: "Trailer thumbnail", youtubeUrl: trailer });
            }
          }
          await sleep(150);
        }

        entries.push({
          id: `tv-${show.id}`,
          title: show.name,
          year,
          mediaType: "tv",
          director: "Unknown",
          genre: getGenres(show.genre_ids, true),
          trailerUrl,
          frames,
        });
      }
      process.stdout.write(`\r   Page ${page}/${CONFIG.tvShows.pages} — ${entries.length - movieCount} TV shows collected`);
      await sleep(250);
    }
    console.log(`\n   ✅ ${entries.length - movieCount} TV shows collected`);
  }

  const tvCount = entries.length - movieCount;

  // ── Anime ───────────────────────────────────────────────────────────────────
  if (CONFIG.anime.enabled) {
    console.log(`\n🎌 Fetching anime (${CONFIG.anime.pages} pages)...`);
    for (let page = 1; page <= CONFIG.anime.pages; page++) {
      const results = await fetchTMDBPage(
        "/discover/tv?with_genres=16&with_origin_country=JP&sort_by=popularity.desc&",
        page
      ) as TMDBShow[];
      for (const show of results) {
        if (!show.poster_path) continue;
        const year = show.first_air_date?.slice(0, 4) || "Unknown";
        const frames: FrameEntry[] = [];

        if (show.poster_path) {
          frames.push({ url: `${TMDB_IMG}${show.poster_path}`, scene: "Anime poster" });
        }
        if (show.backdrop_path && CONFIG.framesPerTitle >= 2) {
          frames.push({ url: `${TMDB_IMG}${show.backdrop_path}`, scene: "Anime backdrop" });
        }

        let trailerUrl: string | undefined;
        if (CONFIG.includeTrailerThumbnail) {
          const trailer = await fetchTrailerUrl(show.id, "tv");
          if (trailer) {
            trailerUrl = trailer;
            const thumbUrl = youtubeThumbUrl(trailer);
            if (thumbUrl) {
              frames.push({ url: thumbUrl, scene: "Trailer thumbnail", youtubeUrl: trailer });
            }
          }
          await sleep(150);
        }

        entries.push({
          id: `anime-${show.id}`,
          title: show.name,
          year,
          mediaType: "tv",
          director: "Unknown",
          genre: "Anime / " + getGenres(show.genre_ids, true),
          trailerUrl,
          frames,
        });
      }
      process.stdout.write(`\r   Page ${page}/${CONFIG.anime.pages} — ${entries.length - movieCount - tvCount} anime collected`);
      await sleep(250);
    }
    console.log(`\n   ✅ ${entries.length - movieCount - tvCount} anime collected`);
  }

  // Remove duplicates
  const seen = new Set<string>();
  return entries.filter(e => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}

// ─── XENOVA CLIP ─────────────────────────────────────────────────────────────

let embedder: ReturnType<typeof pipeline> extends Promise<infer T> ? T : never;

async function getEmbedder() {
  if (!embedder) {
    console.log("\n📦 Loading Xenova CLIP model (first time only, ~400MB download)...");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    embedder = await (pipeline as any)(
      "image-feature-extraction",
      "Xenova/clip-vit-base-patch32"
    );
    console.log("✅ CLIP model ready\n");
  }
  return embedder;
}

async function embedImage(buffer: Buffer): Promise<number[] | null> {
  try {
    const model = await getEmbedder();
    const image = await RawImage.fromBlob(new Blob([new Uint8Array(buffer)]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const output = await (model as any)(image, { pooling: "mean", normalize: true });

    // Handle different output formats from Xenova
    let values: number[] = [];
    if (output?.data) {
      values = Array.from(output.data) as number[];
    } else if (Array.isArray(output)) {
      values = output as number[];
    } else if (output?.last_hidden_state?.data) {
      values = Array.from(output.last_hidden_state.data) as number[];
    }

    console.log(`   Embedding dims: ${values.length}`);

    if (values.length === 0) return null;

    const mag = Math.sqrt(values.reduce((s, v) => s + v * v, 0));
    return mag === 0 ? values : values.map(v => v / mag);
  } catch (err) {
    console.error("   Embed error:", err);
    return null;
  }
}

// ─── PINECONE UPSERT ──────────────────────────────────────────────────────────

async function upsertToPinecone(vectors: {
  id: string;
  values: number[];
  metadata: Record<string, string>;
}[]) {
  const valid = vectors.filter(v =>
    Array.isArray(v.values) &&
    v.values.length === 0 &&
    v.values.every(n => typeof n === "number" && isFinite(n))
  );

  if (valid.length === 0) return; // silent skip, no error

  const { Pinecone } = await import("@pinecone-database/pinecone");
  const pinecone = new Pinecone({ apiKey: PINECONE_API_KEY });
  const index = pinecone.index(INDEX_NAME);
  await index.upsert(valid.map(v => ({
    id: v.id,
    values: v.values,
    metadata: v.metadata,
  })) as never);
}

async function getPineconeCount(): Promise<number> {
  try {
    const { Pinecone } = await import("@pinecone-database/pinecone");
    const pinecone = new Pinecone({ apiKey: PINECONE_API_KEY });
    const index = pinecone.index(INDEX_NAME);
    const stats = await index.describeIndexStats();
    return stats.totalRecordCount || 0;
  } catch { return 0; }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🚀 Vortex Auto Database Builder");
  console.log("=".repeat(60));
  console.log("This script will index hundreds of movies and TV shows.");
  console.log("You can stop it at any time with Ctrl+C and restart later.");
  console.log("Progress is saved automatically.\n");

  if (!PINECONE_API_KEY) { console.error("❌ PINECONE_API_KEY missing"); process.exit(1); }
  if (!TMDB_API_KEY) { console.error("❌ TMDB_API_KEY missing"); process.exit(1); }

  console.log("✓ API keys loaded");
  console.log(`✓ Trailer thumbnails: ${CONFIG.includeTrailerThumbnail ? "enabled" : "disabled"}`);

  const indexed = loadProgress();
  console.log(`📊 Previously indexed: ${indexed.size} frames`);

  const beforeCount = await getPineconeCount();
  console.log(`📊 Pinecone vectors: ${beforeCount}`);

  console.log("\n⬇️  Building title list from TMDB...");
  const allTitles = await buildMovieList();
  console.log(`\n📋 Total titles to process: ${allTitles.length}`);
  console.log(`🎬 Titles with trailers: ${allTitles.filter(t => t.trailerUrl).length}`);

  const toProcess = CONFIG.skipAlreadyIndexed
    ? allTitles.filter(t => !Array.from(indexed).some(id => id.startsWith(t.id)))
    : allTitles;

  console.log(`📋 Titles to index (skipping done): ${toProcess.length}`);
  console.log("\nStarting indexing...\n");

  await getEmbedder();

  let totalIndexed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  for (let ti = 0; ti < toProcess.length; ti++) {
    const title = toProcess[ti];
    const progress = `[${ti + 1}/${toProcess.length}]`;

    process.stdout.write(`${progress} ${title.title} (${title.year})...`);

    let titleIndexed = 0;

    for (let fi = 0; fi < title.frames.length; fi++) {
      const frame = title.frames[fi];
      const vectorId = `${title.id}-frame${fi}`;

      if (CONFIG.skipAlreadyIndexed && indexed.has(vectorId)) {
        totalSkipped++;
        continue;
      }

      const buffer = await downloadImage(frame.url);
      if (!buffer || buffer.length < 5000) {
        totalFailed++;
        continue;
      }

      const embedding = await embedImage(buffer);
      if (!embedding || embedding.length !== 0) {
        totalFailed++;
        continue;
    }

      try {
        await upsertToPinecone([{
          id: vectorId,
          values: embedding,
          metadata: {
            title: title.title,
            year: title.year,
            mediaType: title.mediaType,
            director: title.director,
            genre: title.genre,
            scene: frame.scene,
            trailerUrl: title.trailerUrl || "",
            youtubeUrl: frame.youtubeUrl || "",
          },
        }]);

        indexed.add(vectorId);
        titleIndexed++;
        totalIndexed++;
      } catch (err) {
        console.error(`\nPinecone upsert failed:`, err);
        totalFailed++;
      }

      if (fi < title.frames.length - 1) await sleep(CONFIG.delayBetweenFrames);
    }

    saveProgress(indexed);

    if (titleIndexed > 0) {
      const trailerNote = title.trailerUrl ? " 🎬" : "";
      process.stdout.write(` ✅ (${titleIndexed} frame${titleIndexed > 1 ? "s" : ""}${trailerNote})\n`);
    } else {
      process.stdout.write(` ⚠️  skipped\n`);
    }

    await sleep(CONFIG.delayBetweenTitles);

    if ((ti + 1) % 50 === 0) {
      const afterCount = await getPineconeCount();
      console.log(`\n📊 Progress: ${ti + 1}/${toProcess.length} titles | ${totalIndexed} indexed | ${totalFailed} failed | Pinecone: ${afterCount} vectors\n`);
    }
  }

  const afterCount = await getPineconeCount();
  console.log("\n" + "=".repeat(60));
  console.log("✅ Database build complete!");
  console.log(`   Titles processed: ${toProcess.length}`);
  console.log(`   Frames indexed: ${totalIndexed}`);
  console.log(`   Frames failed: ${totalFailed}`);
  console.log(`   Frames skipped: ${totalSkipped}`);
  console.log(`   Pinecone before: ${beforeCount}`);
  console.log(`   Pinecone after:  ${afterCount}`);
  console.log(`   New vectors: ${afterCount - beforeCount}`);
  console.log("\n🎯 Your database is ready!");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});