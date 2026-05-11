import { NextRequest, NextResponse } from "next/server";
import { Pinecone } from "@pinecone-database/pinecone";

const INDEX_NAME = "vortex-movies";

interface VectorMatch {
  id: string;
  score: number;
  metadata: {
    title?: string;
    year?: string;
    mediaType?: string;
    director?: string;
    genre?: string;
    frameTime?: string;
    scene?: string;
  };
}

interface SearchResult {
  matched: boolean;
  confidence: number;
  title?: string;
  year?: string;
  mediaType?: string;
  director?: string;
  genre?: string;
  scene?: string;
  frameTime?: string;
  score: number;
  alternatives: {
    title: string;
    year: string;
    score: number;
    confidence: number;
  }[];
}

function scoreToConfidence(score: number): number {
  // Cosine similarity score (0-1) to confidence percentage
  // Score > 0.9 = very high confidence
  // Score > 0.8 = high confidence
  // Score > 0.7 = medium confidence
  // Score < 0.7 = low confidence
  if (score >= 0.95) return 98;
  if (score >= 0.90) return 92;
  if (score >= 0.85) return 85;
  if (score >= 0.80) return 75;
  if (score >= 0.75) return 65;
  if (score >= 0.70) return 55;
  return Math.round(score * 50);
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.PINECONE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Pinecone API key not configured" },
        { status: 500 }
      );
    }

    const body = await req.json();
    const { embedding, topK = 5 }: { embedding: number[]; topK?: number } = body;

    if (!embedding || !Array.isArray(embedding)) {
      return NextResponse.json(
        { error: "No embedding provided" },
        { status: 400 }
      );
    }

    // Initialize Pinecone
    const pinecone = new Pinecone({ apiKey });
    const index = pinecone.index(INDEX_NAME);

    // Query the index
    const queryResponse = await index.query({
      vector: embedding,
      topK,
      includeMetadata: true,
    });

    const matches = queryResponse.matches as VectorMatch[];

    if (!matches || matches.length === 0) {
      return NextResponse.json({
        matched: false,
        confidence: 0,
        score: 0,
        alternatives: [],
      });
    }

    const best = matches[0];
    const bestScore = best.score || 0;

    // Only consider it a match if score is above threshold
    const MATCH_THRESHOLD = 0.70;
    if (bestScore < MATCH_THRESHOLD) {
      return NextResponse.json({
        matched: false,
        confidence: scoreToConfidence(bestScore),
        score: bestScore,
        alternatives: matches.slice(1, 4).map((m) => ({
          title: m.metadata?.title || "Unknown",
          year: m.metadata?.year || "—",
          score: m.score || 0,
          confidence: scoreToConfidence(m.score || 0),
        })),
      });
    }

    // Build alternatives from remaining matches
    const alternatives = matches
      .slice(1, 4)
      .filter((m) => (m.score || 0) >= 0.60)
      .map((m) => ({
        title: m.metadata?.title || "Unknown",
        year: m.metadata?.year || "—",
        score: m.score || 0,
        confidence: scoreToConfidence(m.score || 0),
      }));

    const result: SearchResult = {
      matched: true,
      confidence: scoreToConfidence(bestScore),
      title: best.metadata?.title,
      year: best.metadata?.year,
      mediaType: best.metadata?.mediaType,
      director: best.metadata?.director,
      genre: best.metadata?.genre,
      scene: best.metadata?.scene,
      frameTime: best.metadata?.frameTime,
      score: bestScore,
      alternatives,
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error("Vector search error:", err);
    return NextResponse.json(
      { error: "Vector search failed." },
      { status: 500 }
    );
  }
}

// GET endpoint to check index stats
export async function GET() {
  try {
    const apiKey = process.env.PINECONE_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Pinecone not configured" }, { status: 500 });
    }

    const pinecone = new Pinecone({ apiKey });
    const index = pinecone.index(INDEX_NAME);
    const stats = await index.describeIndexStats();

    return NextResponse.json({
      totalVectors: stats.totalRecordCount || 0,
      dimensions: stats.dimension || 512,
      indexName: INDEX_NAME,
    });
  } catch (err) {
    console.error("Index stats error:", err);
    return NextResponse.json({ error: "Could not fetch index stats" }, { status: 500 });
  }
}