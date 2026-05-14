import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";
import { pipeline, RawImage } from "@xenova/transformers";


// ─────────────────────────────────────────────
// ENV
// ─────────────────────────────────────────────

function loadEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");

  for (const l of lines) {
    const t = l.trim();
    if (!t || t.startsWith("#")) continue;

    const i = t.indexOf("=");
    if (i === -1) continue;

    process.env[t.slice(0, i)] = t.slice(i + 1);
  }
}
loadEnv();

const PINECONE_API_KEY = process.env.PINECONE_API_KEY!;
const INDEX_NAME = "vortex-movies";

// ─────────────────────────────────────────────
// DATA (UNCHANGED — ALL MOVIES KEPT)
// ─────────────────────────────────────────────

const MOVIES_TO_INDEX = [
  { title: "The Dark Knight", year: "2008", director: "Christopher Nolan", genre: "Action / Crime", mediaType: "movie", frames: [{ url: "https://image.tmdb.org/t/p/w500/qJ2tW6WMUDux911r6m7haRef0WH.jpg", scene: "Poster" }] },
  { title: "Inception", year: "2010", director: "Christopher Nolan", genre: "Sci-Fi / Thriller", mediaType: "movie", frames: [{ url: "https://image.tmdb.org/t/p/w500/9gk7adHYeDvHkCSEqAvQNLV5Uge.jpg", scene: "Poster" }] },
  { title: "Avengers Endgame", year: "2019", director: "Russo Brothers", genre: "Action", mediaType: "movie", frames: [{ url: "https://image.tmdb.org/t/p/w500/or06FN3Dka5tukK1e9sl16pB3iy.jpg", scene: "Poster" }] },
  { title: "Interstellar", year: "2014", director: "Christopher Nolan", genre: "Sci-Fi", mediaType: "movie", frames: [{ url: "https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg", scene: "Poster" }] },
  { title: "The Matrix", year: "1999", director: "Wachowskis", genre: "Sci-Fi", mediaType: "movie", frames: [{ url: "https://image.tmdb.org/t/p/w500/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg", scene: "Poster" }] },
  { title: "Breaking Bad", year: "2008", director: "Vince Gilligan", genre: "Crime Drama", mediaType: "tv", frames: [{ url: "https://image.tmdb.org/t/p/w500/ggFHVNu6YYI5L9pCfOacjizRGt.jpg", scene: "Poster" }] },
  { title: "The Boys", year: "2019", director: "Eric Kripke", genre: "Action", mediaType: "tv", frames: [{ url: "https://image.tmdb.org/t/p/w500/stTEycfG9928HYGEISBFaG1ngjM.jpg", scene: "Poster" }] },
  { title: "Stranger Things", year: "2016", director: "Duffer Brothers", genre: "Sci-Fi Horror", mediaType: "tv", frames: [{ url: "https://image.tmdb.org/t/p/w500/49WJfeN0moxb9IPfGn8AIqMGskD.jpg", scene: "Poster" }] },
  { title: "Attack on Titan", year: "2013", director: "Tetsuro Araki", genre: "Anime", mediaType: "tv", frames: [{ url: "https://image.tmdb.org/t/p/w500/hTP1DtLGFamjfu8WqjnuQdP1n4i.jpg", scene: "Poster" }] },
  { title: "Demon Slayer", year: "2019", director: "Haruo Sotozaki", genre: "Anime", mediaType: "tv", frames: [{ url: "https://image.tmdb.org/t/p/w500/xUfRZu2mi8jH6SzQEJGP6tjBuYj.jpg", scene: "Poster" }] },
];

// ─────────────────────────────────────────────
// UTIL
// ─────────────────────────────────────────────

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const sanitizeId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "-");

// ─────────────────────────────────────────────
// DOWNLOAD IMAGE
// ─────────────────────────────────────────────

async function downloadImage(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;

    lib.get(url, (res) => {
      const chunks: Buffer[] = [];

      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

// ─────────────────────────────────────────────
// CLIP (FIXED)
// ─────────────────────────────────────────────

let embedder: any;

async function getEmbedder() {
  if (!embedder) {
    console.log("📦 Loading CLIP...");
    embedder = await pipeline(
      "image-feature-extraction",
      "Xenova/clip-vit-base-patch32"
    );
    console.log("✅ CLIP ready");
  }
  return embedder;
}

async function embedImage(buffer: Buffer): Promise<number[]> {
  const model = await getEmbedder();
const image = await RawImage.fromBlob(new Blob([new Uint8Array(buffer)]));  const output = await model(image, {
    pooling: "mean",
    normalize: true,
  });
  return Array.from(output.data);
}

// ─────────────────────────────────────────────
// PINECONE
// ─────────────────────────────────────────────

async function upsert(vector: any) {
  const { Pinecone } = await import("@pinecone-database/pinecone");

  const pc = new Pinecone({ apiKey: PINECONE_API_KEY });
  const index = pc.index(INDEX_NAME);

  await index.upsert({ records: [vector] });
}

// ─────────────────────────────────────────────
// INDEX
// ─────────────────────────────────────────────

async function indexMovie(movie: any) {
  console.log(`\n🎬 ${movie.title}`);

  for (const [i, frame] of movie.frames.entries()) {
    try {
      console.log(`Frame ${i + 1}: downloading`);

      const img = await downloadImage(frame.url);

      console.log("Embedding with CLIP...");

      const vector = await embedImage(img);

      await upsert({
        id: `${sanitizeId(movie.title)}-${i}`,
        values: vector,
        metadata: {
          title: movie.title,
          year: movie.year,
          genre: movie.genre,
          director: movie.director,
          mediaType: movie.mediaType,
          scene: frame.scene,
        },
      });

      console.log("✅ indexed");
    } catch (e) {
      console.log("❌ frame failed:", e);
    }
  }
}

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────

async function main() {
  console.log("🚀 Vortex Indexer — FIXED CLIP VERSION");

  for (const movie of MOVIES_TO_INDEX) {
    await indexMovie(movie);
    await sleep(1000);
  }

  console.log("\nDONE ✅");
}

main().catch(console.error);