/**
 * Vortex Auto Database Builder — Expanded Edition
 * Fetches top movies + TV shows from TMDB including production stills
 * Usage: npx tsx scripts/build-database.ts
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
const TMDB_STILL = "https://image.tmdb.org/t/p/w780";

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const CONFIG = {
  movies: { pages: 25, enabled: true },
  tvShows: { pages: 10, enabled: true },
  anime: { pages: 5, enabled: true },
  framesPerTitle: 5,           // poster + backdrop + up to 3 production stills
  includeTrailerThumbnail: true,
  includeProductionStills: true, // fetch extra scene stills from TMDB
  stillsPerTitle: 3,           // how many production stills to grab
  delayBetweenFrames: 500,
  delayBetweenTitles: 1000,
  skipAlreadyIndexed: true,
  progressFile: "scripts/.index-progress.json",
  // Save labeled data locally for training
  saveTrainingData: true,
  trainingDataDir: "training_data",
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

// ─── PROGRESS ─────────────────────────────────────────────────────────────────

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
    fs.mkdirSync(path.dirname(CONFIG.progressFile), { recursive: true });
    fs.writeFileSync(
      CONFIG.progressFile,
      JSON.stringify({ indexed: Array.from(indexed), updatedAt: new Date().toISOString() })
    );
  } catch { /* ignore */ }
}

// ─── GENRE MAPS ───────────────────────────────────────────────────────────────

const MOVIE_GENRES: Record<number, string> = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy",
  80: "Crime", 99: "Documentary", 18: "Drama", 10751: "Family",
  14: "Fantasy", 36: "History", 27: "Horror", 10402: "Music",
  9648: "Mystery", 10749: "Romance", 878: "Sci-Fi", 53: "Thriller",
  10752: "War", 37: "Western",
};

const TV_GENRES: Record<number, string> = {
  10759: "Action & Adventure", 16: "Animation", 35: "Comedy",
  80: "Crime", 99: "Documentary", 18: "Drama", 10751: "Family",
  10762: "Kids", 9648: "Mystery", 10765: "Sci-Fi & Fantasy",
  10768: "War & Politics", 37: "Western",
};

function getGenres(ids: number[], isTV: boolean): string {
  const map = isTV ? TV_GENRES : MOVIE_GENRES;
  return ids.slice(0, 2).map(id => map[id] || "").filter(Boolean).join(" / ") || "Unknown";
}

// ─── UTILITIES ────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function sanitizeTitle(str: string): string {
  return str.replace(/[^a-zA-Z0-9 _-]/g, "").replace(/\s+/g, "_").slice(0, 60);
}

function youtubeThumbUrl(youtubeUrl: string): string | null {
  const match = youtubeUrl.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (!match) return null;
  return `https://img.youtube.com/vi/${match[1]}/hqdefault.jpg`;
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

// Save image locally for training data
function saveTrainingImage(buffer: Buffer, title: string, frameIndex: number) {
  if (!CONFIG.saveTrainingData) return;
  try {
    const dir = path.join(CONFIG.trainingDataDir, sanitizeTitle(title));
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `frame_${String(frameIndex).padStart(4, "0")}.jpg`);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, buffer);
    }
  } catch { /* ignore */ }
}

// ─── TMDB FETCHERS ────────────────────────────────────────────────────────────

async function fetchTMDBPage(endpoint: string, page: number): Promise<TMDBMovie[] | TMDBShow[]> {
  const url = `${TMDB_BASE}${endpoint}&api_key=${TMDB_API_KEY}&page=${page}&language=en-US`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || [];
  } catch { return []; }
}

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
  } catch { return null; }
}

// Fetch production stills — real scene frames, great for training
async function fetchProductionStills(id: number, type: "movie" | "tv"): Promise<string[]> {
  try {
    const url = `${TMDB_BASE}/${type}/${id}/images?api_key=${TMDB_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const backdrops = data.backdrops || [];
    // Sort by vote_average to get the best quality stills
    backdrops.sort((a: { vote_average: number }, b: { vote_average: number }) =>
      b.vote_average - a.vote_average
    );
    return backdrops
      .slice(0, CONFIG.stillsPerTitle)
      .map((b: { file_path: string }) => `${TMDB_STILL}${b.file_path}`);
  } catch { return []; }
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

        if (movie.poster_path)
          frames.push({ url: `${TMDB_IMG}${movie.poster_path}`, scene: "Movie poster" });
        if (movie.backdrop_path)
          frames.push({ url: `${TMDB_IMG}${movie.backdrop_path}`, scene: "Movie backdrop" });

        // Production stills
        if (CONFIG.includeProductionStills) {
          const stills = await fetchProductionStills(movie.id, "movie");
          stills.forEach((url, i) => frames.push({ url, scene: `Production still ${i + 1}` }));
          await sleep(100);
        }

        // Trailer thumbnail
        let trailerUrl: string | undefined;
        if (CONFIG.includeTrailerThumbnail) {
          const trailer = await fetchTrailerUrl(movie.id, "movie");
          if (trailer) {
            trailerUrl = trailer;
            const thumbUrl = youtubeThumbUrl(trailer);
            if (thumbUrl) frames.push({ url: thumbUrl, scene: "Trailer thumbnail", youtubeUrl: trailer });
          }
          await sleep(100);
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
      process.stdout.write(`\r   Page ${page}/${CONFIG.movies.pages} — ${entries.length} movies`);
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

        if (show.poster_path)
          frames.push({ url: `${TMDB_IMG}${show.poster_path}`, scene: "Series poster" });
        if (show.backdrop_path)
          frames.push({ url: `${TMDB_IMG}${show.backdrop_path}`, scene: "Series backdrop" });

        if (CONFIG.includeProductionStills) {
          const stills = await fetchProductionStills(show.id, "tv");
          stills.forEach((url, i) => frames.push({ url, scene: `Production still ${i + 1}` }));
          await sleep(100);
        }

        let trailerUrl: string | undefined;
        if (CONFIG.includeTrailerThumbnail) {
          const trailer = await fetchTrailerUrl(show.id, "tv");
          if (trailer) {
            trailerUrl = trailer;
            const thumbUrl = youtubeThumbUrl(trailer);
            if (thumbUrl) frames.push({ url: thumbUrl, scene: "Trailer thumbnail", youtubeUrl: trailer });
          }
          await sleep(100);
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
      process.stdout.write(`\r   Page ${page}/${CONFIG.tvShows.pages} — ${entries.length - movieCount} TV shows`);
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

        if (show.poster_path)
          frames.push({ url: `${TMDB_IMG}${show.poster_path}`, scene: "Anime poster" });
        if (show.backdrop_path)
          frames.push({ url: `${TMDB_IMG}${show.backdrop_path}`, scene: "Anime backdrop" });

        if (CONFIG.includeProductionStills) {
          const stills = await fetchProductionStills(show.id, "tv");
          stills.forEach((url, i) => frames.push({ url, scene: `Production still ${i + 1}` }));
          await sleep(100);
        }

        let trailerUrl: string | undefined;
        if (CONFIG.includeTrailerThumbnail) {
          const trailer = await fetchTrailerUrl(show.id, "tv");
          if (trailer) {
            trailerUrl = trailer;
            const thumbUrl = youtubeThumbUrl(trailer);
            if (thumbUrl) frames.push({ url: thumbUrl, scene: "Trailer thumbnail", youtubeUrl: trailer });
          }
          await sleep(100);
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
      process.stdout.write(`\r   Page ${page}/${CONFIG.anime.pages} — ${entries.length - movieCount - tvCount} anime`);
      await sleep(250);
    }
    console.log(`\n   ✅ ${entries.length - movieCount - tvCount} anime collected`);
  }

  // Deduplicate
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
    console.log("\n📦 Loading Xenova CLIP model...");
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
    const model = await getEmbedder() as any;
    const image = await RawImage.fromBlob(new Blob([new Uint8Array(buffer)]));
    const output = await model(image, { pooling: "mean", normalize: true });

    // Handle different output formats
    let values: number[] = [];
    if (output?.data) {
      values = Array.from(output.data) as number[];
    } else if (Array.isArray(output)) {
      values = output.flat();
    } else if (output?.last_hidden_state?.data) {
      values = Array.from(output.last_hidden_state.data) as number[];
    }

    if (!values || values.length === 0) {
      console.error(`   ⚠️  Empty embedding — output keys: ${Object.keys(output || {}).join(", ")}`);
      return null;
    }

    const mag = Math.sqrt(values.reduce((s, v) => s + v * v, 0));
    return mag === 0 ? values : values.map(v => v / mag);
  } catch (err) {
    console.error("   Embed error:", err);
    return null;
  }
}

// ─── PINECONE ─────────────────────────────────────────────────────────────────

async function upsertToPinecone(vectors: {
  id: string;
  values: number[];
  metadata: Record<string, string>;
}[]) {
  // Validate before sending
  const valid = vectors.filter(v =>
    Array.isArray(v.values) &&
    v.values.length > 0 &&
    v.values.every(n => typeof n === "number" && isFinite(n))
  );

  if (valid.length === 0) {
    console.log(`   ⚠️  No valid embeddings to upsert`);
    return;
  }

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
  console.log("🚀 Vortex Auto Database Builder — Expanded Edition");
  console.log("=".repeat(60));
  console.log("Includes production stills for training data collection.");
  console.log("Stop anytime with Ctrl+C — progress is saved.\n");

  if (!PINECONE_API_KEY) { console.error("❌ PINECONE_API_KEY missing"); process.exit(1); }
  if (!TMDB_API_KEY) { console.error("❌ TMDB_API_KEY missing"); process.exit(1); }

  console.log("✓ API keys loaded");
  console.log(`✓ Production stills: ${CONFIG.includeProductionStills ? "enabled" : "disabled"}`);
  console.log(`✓ Trailer thumbnails: ${CONFIG.includeTrailerThumbnail ? "enabled" : "disabled"}`);
  console.log(`✓ Training data save: ${CONFIG.saveTrainingData ? `enabled → ${CONFIG.trainingDataDir}/` : "disabled"}`);

  if (CONFIG.saveTrainingData) {
    fs.mkdirSync(CONFIG.trainingDataDir, { recursive: true });
    console.log(`✓ Training data directory ready: ${CONFIG.trainingDataDir}/`);
  }

  const indexed = loadProgress();
  console.log(`📊 Previously indexed: ${indexed.size} frames`);

  const beforeCount = await getPineconeCount();
  console.log(`📊 Pinecone vectors: ${beforeCount}`);

  console.log("\n⬇️  Building title list from TMDB...");
  const allTitles = await buildMovieList();

  const totalFrames = allTitles.reduce((s, t) => s + t.frames.length, 0);
  console.log(`\n📋 Total titles: ${allTitles.length}`);
  console.log(`🖼️  Total frames: ${totalFrames}`);
  console.log(`🎬 Titles with trailers: ${allTitles.filter(t => t.trailerUrl).length}`);

  const toProcess = CONFIG.skipAlreadyIndexed
    ? allTitles.filter(t => !Array.from(indexed).some(id => id.startsWith(t.id)))
    : allTitles;

  console.log(`📋 Titles to index: ${toProcess.length}`);
  console.log("\nStarting indexing...\n");

  await getEmbedder();

  let totalIndexed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  let trainingImagesSaved = 0;

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

      // Save for training data
      if (CONFIG.saveTrainingData) {
        saveTrainingImage(buffer, title.title, fi);
        trainingImagesSaved++;
      }

      const embedding = await embedImage(buffer);
      if (!embedding) {
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
      const notes = [
        title.trailerUrl ? "🎬" : "",
        titleIndexed > 2 ? `${titleIndexed}f` : "",
      ].filter(Boolean).join(" ");
      process.stdout.write(` ✅ ${notes}\n`);
    } else {
      process.stdout.write(` ⚠️  skipped\n`);
    }

    await sleep(CONFIG.delayBetweenTitles);

    if ((ti + 1) % 50 === 0) {
      const afterCount = await getPineconeCount();
      console.log(`\n📊 Progress: ${ti + 1}/${toProcess.length} | indexed: ${totalIndexed} | failed: ${totalFailed} | Pinecone: ${afterCount} | training images: ${trainingImagesSaved}\n`);
    }
  }

  const afterCount = await getPineconeCount();
  console.log("\n" + "=".repeat(60));
  console.log("✅ Database build complete!");
  console.log(`   Titles processed: ${toProcess.length}`);
  console.log(`   Frames indexed: ${totalIndexed}`);
  console.log(`   Frames failed: ${totalFailed}`);
  console.log(`   Frames skipped: ${totalSkipped}`);
  console.log(`   Training images saved: ${trainingImagesSaved}`);
  console.log(`   Pinecone before: ${beforeCount}`);
  console.log(`   Pinecone after:  ${afterCount}`);
  console.log(`   New vectors: ${afterCount - beforeCount}`);
  if (CONFIG.saveTrainingData) {
    console.log(`\n📁 Training data saved to: ${CONFIG.trainingDataDir}/`);
    console.log(`   ${trainingImagesSaved} labeled images ready for Month 2 fine-tuning`);
  }
  console.log("\n🎯 Your database is ready!");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});