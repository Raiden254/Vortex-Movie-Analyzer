import { NextRequest, NextResponse } from "next/server";

const HF_MODEL = "openai/clip-vit-base-patch32";
const HF_API = "https://api-inference.huggingface.co/models";

async function getClipEmbedding(base64Image: string, mimeType: string): Promise<number[] | null> {
  const apiKey = process.env.HUGGINGFACE_API_KEY;
  if (!apiKey) {
    console.error("Hugging Face API key not configured");
    return null;
  }

  try {
    // Convert base64 to blob for Hugging Face
    const binaryString = atob(base64Image);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: mimeType });

    const response = await fetch(`${HF_API}/${HF_MODEL}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": mimeType,
      },
      body: blob,
    });

    // Handle model loading (Hugging Face cold start)
    if (response.status === 503) {
      const errorData = await response.json();
      console.log("Model loading, estimated time:", errorData.estimated_time);
      
      // Wait and retry once
      await new Promise((resolve) => setTimeout(resolve, 10000));
      
      const retry = await fetch(`${HF_API}/${HF_MODEL}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": mimeType,
        },
        body: blob,
      });

      if (!retry.ok) {
        console.error("Retry failed:", retry.status);
        return null;
      }

      const retryData = await retry.json();
      return extractEmbedding(retryData);
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error("Hugging Face CLIP error:", response.status, errText);
      return null;
    }

    const data = await response.json();
    return extractEmbedding(data);
  } catch (err) {
    console.error("CLIP embedding error:", err);
    return null;
  }
}

function extractEmbedding(data: unknown): number[] | null {
  // Hugging Face returns embeddings in different formats depending on the model
  if (Array.isArray(data)) {
    // Direct array of numbers
    if (typeof data[0] === "number") {
      return data as number[];
    }
    // Array of arrays — take the first
    if (Array.isArray(data[0])) {
      return data[0] as number[];
    }
  }

  // Object with embedding field
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.embedding)) return obj.embedding as number[];
    if (Array.isArray(obj.embeddings)) {
      const emb = obj.embeddings as unknown[];
      if (Array.isArray(emb[0])) return emb[0] as number[];
      return emb as number[];
    }
    if (Array.isArray(obj.image_embeds)) return obj.image_embeds as number[];
  }

  console.error("Could not extract embedding from response:", JSON.stringify(data).slice(0, 200));
  return null;
}

function normalizeEmbedding(embedding: number[]): number[] {
  const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  if (magnitude === 0) return embedding;
  return embedding.map((val) => val / magnitude);
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const base64 = Buffer.from(bytes).toString("base64");
    const mimeType = file.type || "image/jpeg";

    const embedding = await getClipEmbedding(base64, mimeType);

    if (!embedding) {
      return NextResponse.json(
        { error: "Could not generate visual fingerprint. Please try again." },
        { status: 500 }
      );
    }

    // Normalize for cosine similarity
    const normalized = normalizeEmbedding(embedding);

    return NextResponse.json({
      embedding: normalized,
      dimensions: normalized.length,
    });
  } catch (err) {
    console.error("CLIP route error:", err);
    return NextResponse.json(
      { error: "Fingerprint generation failed." },
      { status: 500 }
    );
  }
}