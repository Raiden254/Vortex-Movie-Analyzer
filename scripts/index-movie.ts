/**
 * Vortex Movie Indexer — Gemini Embeddings Edition
 * Usage: npx tsx scripts/index-movie.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";

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
const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const INDEX_NAME = "vortex-movies";

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface FrameEntry {
  url: string;
  scene: string;
  frameTime?: string;
}

interface MovieEntry {
  title: string;
  year: string;
  director: string;
  genre: string;
  mediaType: "movie" | "tv";
  frames: FrameEntry[];
}

// ─── MOVIE LIST ───────────────────────────────────────────────────────────────
// Using TMDB image URLs which are stable and publicly accessible

const MOVIES_TO_INDEX: MovieEntry[] = [
  {
    title: "The Dark Knight",
    year: "2008",
    director: "Christopher Nolan",
    genre: "Action / Crime",
    mediaType: "movie",
    frames: [
      { url: "https://image.tmdb.org/t/p/w500/qJ2tW6WMUDux911r6m7haRef0WH.jpg", scene: "Movie poster" },
    ],
  },
  {
    title: "Inception",
    year: "2010",
    director: "Christopher Nolan",
    genre: "Sci-Fi / Thriller",
    mediaType: "movie",
    frames: [
      { url: "https://image.tmdb.org/t/p/w500/9gk7adHYeDvHkCSEqAvQNLV5Uge.jpg", scene: "Movie poster" },
    ],
  },
  {
    title: "Avengers Endgame",
    year: "2019",
    director: "Anthony and Joe Russo",
    genre: "Action / Superhero",
    mediaType: "movie",
    frames: [
      { url: "https://image.tmdb.org/t/p/w500/or06FN3Dka5tukK1e9sl16pB3iy.jpg", scene: "Movie poster" },
    ],
  },
  {
    title: "Interstellar",
    year: "2014",
    director: "Christopher Nolan",
    genre: "Sci-Fi / Drama",
    mediaType: "movie",
    frames: [
      { url: "https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg", scene: "Movie poster" },
    ],
  },
  {
    title: "The Matrix",
    year: "1999",
    director: "The Wachowskis",
    genre: "Sci-Fi / Action",
    mediaType: "movie",
    frames: [
      { url: "https://image.tmdb.org/t/p/w500/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg", scene: "Movie poster" },
    ],
  },
  {
    title: "Breaking Bad",
    year: "2008",
    director: "Vince Gilligan",
    genre: "Crime / Drama",
    mediaType: "tv",
    frames: [
      { url: "https://image.tmdb.org/t/p/w500/ggFHVNu6YYI5L9pCfOacjizRGt.jpg", scene: "Series poster" },
    ],
  },
  {
    title: "The Boys",
    year: "2019",
    director: "Eric Kripke",
    genre: "Action / Satire",
    mediaType: "tv",
    frames: [
      { url: "https://image.tmdb.org/t/p/w500/stTEycfG9928HYGEISBFaG1ngjM.jpg", scene: "Series poster" },
    ],
  },
  {
    title: "Stranger Things",
    year: "2016",
    director: "The Duffer Brothers",
    genre: "Sci-Fi / Horror",
    mediaType: "tv",
    frames: [
      { url: "https://image.tmdb.org/t/p/w500/49WJfeN0moxb9IPfGn8AIqMGskD.jpg", scene: "Series poster" },
    ],
  },
  {
    title: "Attack on Titan",
    year: "2013",
    director: "Tetsuro Araki",
    genre: "Anime / Action",
    mediaType: "tv",
    frames: [
      { url: "https://image.tmdb.org/t/p/w500/hTP1DtLGFamjfu8WqjnuQdP1n4i.jpg", scene: "Series poster" },
    ],
  },
  {
    title: "Demon Slayer",
    year: "2019",
    director: "Haruo Sotozaki",
    genre: "Anime / Action",
    mediaType: "tv",
    frames: [
      { url: "https://image.tmdb.org/t/p/w500/xUfRZu2mi8jH6SzQEJGP6tjBuYj.jpg", scene: "Series poster" },
    ],
  },
];

// ─── UTILITIES ────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeId(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-");
}

async function downloadImageAsBuffer(url: string, redirectCount = 0): Promise<Buffer> {
  if (redirectCount > 5) throw new Error("Too many redirects");
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;
    const request = protocol.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Accept": "image/webp,image/apng,image/*,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
        const location = res.headers.location!;
        const fullUrl = location.startsWith("http") ? location : new URL(location, url).toString();
        downloadImageAsBuffer(fullUrl, redirectCount + 1).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    request.on("error", reject);
    request.setTimeout(15000, () => {
      request.destroy();
      reject(new Error("Download timeout"));
    });
  });
}

// ─── GEMINI EMBEDDING ─────────────────────────────────────────────────────────

async function geminiDescribe(base64: string, mimeType: string, attempt = 1): Promise<string | null> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: mimeType, data: base64 } },
              { text: "Describe this movie or TV show image in detail for identification purposes. Include: visual style, characters visible, setting, color palette, mood, any text or logos visible, animation style if applicable. Be specific." },
            ],
          }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 400 },
        }),
      }
    );

    // Handle rate limit and server errors with retry
    if (res.status === 429 || res.status === 503) {
      if (attempt <= 3) {
        const waitTime = attempt * 15000; // 15s, 30s, 45s
        console.log(`   ⏳ Gemini ${res.status} — waiting ${waitTime / 1000}s before retry ${attempt}/3...`);
        await sleep(waitTime);
        return geminiDescribe(base64, mimeType, attempt + 1);
      }
      console.error(`   Gemini describe failed after 3 retries`);
      return null;
    }

    if (!res.ok) {
      const err = await res.text();
      console.error(`   Gemini describe error ${res.status}:`, err.slice(0, 150));
      return null;
    }

    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (err) {
    console.error("   Gemini describe exception:", err);
    return null;
  }
}

async function geminiEmbed(text: string, attempt = 1): Promise<number[] | null> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "models/text-embedding-004",
          content: { parts: [{ text }] },
          taskType: "RETRIEVAL_DOCUMENT",
        }),
      }
    );

    if (res.status === 429 || res.status === 503) {
      if (attempt <= 3) {
        const waitTime = attempt * 10000;
        console.log(`   ⏳ Embed ${res.status} — waiting ${waitTime / 1000}s before retry...`);
        await sleep(waitTime);
        return geminiEmbed(text, attempt + 1);
      }
      return null;
    }

    if (!res.ok) {
      const err = await res.text();
      console.error(`   Gemini embed error ${res.status}:`, err.slice(0, 150));
      return null;
    }

    const data = await res.json();
    const values = data?.embedding?.values;
    if (!Array.isArray(values)) {
      console.error("   No embedding values in response");
      return null;
    }
    return normalizeEmbedding(values);
  } catch (err) {
    console.error("   Gemini embed exception:", err);
    return null;
  }
}

async function getGeminiEmbedding(imageBuffer: Buffer, mimeType = "image/jpeg"): Promise<number[] | null> {
  const base64 = imageBuffer.toString("base64");

  // Step 1: Describe the image
  const description = await geminiDescribe(base64, mimeType);
  if (!description) return null;
  console.log(`   Description: ${description.slice(0, 100)}...`);

  // Step 2: Embed the description
  await sleep(2000); // small gap between calls
  return geminiEmbed(description);
}

function normalizeEmbedding(embedding: number[]): number[] {
  const magnitude = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
  return magnitude === 0 ? embedding : embedding.map((v) => v / magnitude);
}

// ─── PINECONE UPSERT ──────────────────────────────────────────────────────────

async function upsertToPinecone(
  vectors: { id: string; values: number[]; metadata: Record<string, string> }[]
) {
  const { Pinecone } = await import("@pinecone-database/pinecone");
  const pinecone = new Pinecone({ apiKey: PINECONE_API_KEY });
  const index = pinecone.index(INDEX_NAME);
  await index.upsert(vectors.map((v) => ({
    id: v.id,
    values: v.values,
    metadata: v.metadata,
  })) as never);
}

async function checkPineconeStats(): Promise<number> {
  try {
    const { Pinecone } = await import("@pinecone-database/pinecone");
    const pinecone = new Pinecone({ apiKey: PINECONE_API_KEY });
    const index = pinecone.index(INDEX_NAME);
    const stats = await index.describeIndexStats();
    return stats.totalRecordCount || 0;
  } catch {
    return 0;
  }
}

// ─── MAIN INDEXER ─────────────────────────────────────────────────────────────

async function indexMovie(movie: MovieEntry): Promise<{ indexed: number; failed: number }> {
  console.log(`\n🎬 Indexing: ${movie.title} (${movie.year})`);

  let indexed = 0;
  let failed = 0;

  for (let i = 0; i < movie.frames.length; i++) {
    const frame = movie.frames[i];
    console.log(`\n   Frame ${i + 1}/${movie.frames.length}: ${frame.scene}`);
    console.log(`   Downloading: ${frame.url.slice(0, 70)}...`);

    try {
      const imageBuffer = await downloadImageAsBuffer(frame.url);
      const sizeKB = (imageBuffer.length / 1024).toFixed(1);
      console.log(`   Downloaded: ${sizeKB} KB`);

      if (imageBuffer.length < 5000) {
        console.log(`   ⚠️  Image too small (${sizeKB} KB) — likely an error page, skipping`);
        failed++;
        continue;
      }

      console.log(`   Generating Gemini embedding...`);
      const embedding = await getGeminiEmbedding(imageBuffer);

      if (!embedding) {
        console.log(`   ⚠️  Could not generate embedding — skipping`);
        failed++;
        continue;
      }

      console.log(`   Embedding: ${embedding.length} dimensions ✓`);

      const vectorId = `${sanitizeId(movie.title)}-${movie.year}-frame${i}`;
      console.log(`   Upserting to Pinecone (ID: ${vectorId})...`);

      await upsertToPinecone([{
        id: vectorId,
        values: embedding,
        metadata: {
          title: movie.title,
          year: movie.year,
          director: movie.director,
          genre: movie.genre,
          mediaType: movie.mediaType,
          scene: frame.scene,
          frameTime: frame.frameTime || "0",
        },
      }]);

      console.log(`   ✅ Indexed successfully`);
      indexed++;

      // Pause between frames to avoid rate limits
      if (i < movie.frames.length - 1) await sleep(5000);
    } catch (err) {
      console.error(`   ❌ Error:`, err);
      failed++;
    }
  }

  return { indexed, failed };
}

async function main() {
  console.log("🚀 Vortex Movie Indexer — Gemini Edition");
  console.log("=".repeat(50));

  if (!PINECONE_API_KEY) { console.error("❌ PINECONE_API_KEY missing"); process.exit(1); }
  if (!GEMINI_API_KEY) { console.error("❌ GEMINI_API_KEY missing"); process.exit(1); }

  console.log("✓ API keys loaded");

  const beforeCount = await checkPineconeStats();
  console.log(`\n📊 Current Pinecone vectors: ${beforeCount}`);
  console.log(`📋 Movies to index: ${MOVIES_TO_INDEX.length}`);
  console.log(`🖼️  Total frames: ${MOVIES_TO_INDEX.reduce((s, m) => s + m.frames.length, 0)}`);
  console.log("\nStarting indexing... (this will take a few minutes)\n");

  let totalIndexed = 0;
  let totalFailed = 0;

  for (const movie of MOVIES_TO_INDEX) {
    const { indexed, failed } = await indexMovie(movie);
    totalIndexed += indexed;
    totalFailed += failed;
    // Pause between movies to avoid rate limits
    await sleep(5000);
  }

  const afterCount = await checkPineconeStats();

  console.log("\n" + "=".repeat(50));
  console.log("✅ Indexing complete!");
  console.log(`   Successfully indexed: ${totalIndexed} frames`);
  console.log(`   Failed: ${totalFailed} frames`);
  console.log(`   Pinecone vectors before: ${beforeCount}`);
  console.log(`   Pinecone vectors after:  ${afterCount}`);
  console.log(`   New vectors added: ${afterCount - beforeCount}`);
  console.log("\n🎯 Your database is growing!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});