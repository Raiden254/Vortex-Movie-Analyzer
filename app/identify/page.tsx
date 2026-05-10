"use client";

import { useState, useRef } from "react";
import Image from "next/image";
import Link from "next/link";

type TMDBData = {
  id: number;
  poster: string | null;
  backdrop: string | null;
  tagline: string;
  voteAverage: string;
  voteCount: number;
  genres: string[];
  trailer: string | null;
  cast: { name: string; character: string; photo: string | null }[];
  streaming: { name: string; logo: string }[];
  tmdbUrl: string;
};

type Result = {
  title: string;
  year: string;
  director: string;
  genre: string;
  runtime: string;
  rating: string;
  description: string;
  scene: string;
  confidence: number;
  alternatives: { title: string; year: string; confidence: number }[];
  signals: { visual: number; dialogue: number; colorGrade: number; textTitles: number };
  tmdb: TMDBData | null;
};

export default function IdentifyPage() {
  const [tab, setTab] = useState<"image" | "video">("image");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "analyzing" | "done" | "error">("idle");
  const [result, setResult] = useState<Result | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const stages = [
    "Reading visual fingerprints...",
    "Analyzing color grading...",
    "Cross-referencing frame database...",
    "Fetching movie details...",
    "Finalizing match...",
  ];
  const [stageText, setStageText] = useState(stages[0]);

  async function compressImage(f: File): Promise<File> {
    return new Promise((resolve) => {
      const img = document.createElement("img");
      const url = URL.createObjectURL(f);
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX = 1280;
        let { width, height } = img;
        if (width > MAX) { height = (height * MAX) / width; width = MAX; }
        if (height > MAX) { width = (width * MAX) / height; height = MAX; }
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d")?.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (blob) resolve(new File([blob], f.name, { type: "image/jpeg" }));
          else resolve(f);
        }, "image/jpeg", 0.85);
        URL.revokeObjectURL(url);
      };
      img.src = url;
    });
  }

  async function handleFile(f: File) {
    setResult(null);
    setStatus("idle");
    setErrorMsg("");
    // Compress image if too large
    if (f.type.startsWith("image/") && f.size > 2 * 1024 * 1024) {
      const compressed = await compressImage(f);
      setFile(compressed);
      setPreview(URL.createObjectURL(compressed));
    } else {
      setFile(f);
      if (tab === "image") setPreview(URL.createObjectURL(f));
      else setPreview(null);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }

  async function runIdentify() {
    if (!file) return;
    setStatus("analyzing");
    setResult(null);
    setErrorMsg("");

    let si = 0;
    setStageText(stages[0]);
    const iv = setInterval(() => {
      si = (si + 1) % stages.length;
      setStageText(stages[si]);
    }, 800);

    try {
      const form = new FormData();
      form.append("file", file);
      form.append("type", tab);

      const res = await fetch("/api/identify", { method: "POST", body: form });
      const data = await res.json();
      clearInterval(iv);

      if (!res.ok || data.error) {
        setErrorMsg(data.error || "Something went wrong.");
        setStatus("error");
        return;
      }

      setResult(data);
      setStatus("done");
    } catch {
      clearInterval(iv);
      setErrorMsg("Network error. Please try again.");
      setStatus("error");
    }
  }

  function reset() {
    setFile(null);
    setPreview(null);
    setResult(null);
    setStatus("idle");
    setErrorMsg("");
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <nav>
        <Link className="nav-logo" href="/">
          <Image src="/Vortex_logo.png" alt="Vortex logo" width={42} height={42} style={{ objectFit: "contain" }} />
          <div>
            <div className="nav-wordmark">VORTEX<span>.</span></div>
            <div className="nav-sub">Movie Analyzer</div>
          </div>
        </Link>
        <div className="nav-right">
          <div className="ace-badge">
            <Image src="/Ace_Analytics.png" alt="Ace" width={18} height={18} style={{ objectFit: "contain", borderRadius: "3px" }} />
            Ace Analytics
          </div>
          <Link href="/" className="nav-cta" style={{ background: "transparent", border: "1px solid var(--border2)", color: "var(--muted)" }}>
            ← Back
          </Link>
        </div>
      </nav>

      <div className="orb orb-1"></div>
      <div className="orb orb-2"></div>

      <div style={{ maxWidth: "820px", margin: "0 auto", padding: "120px 24px 80px", position: "relative", zIndex: 1 }}>

        {/* HEADER */}
        <div style={{ textAlign: "center", marginBottom: "40px" }}>
          <div className="hero-eyebrow" style={{ opacity: 1, animation: "none" }}>Vortex · Scene Identifier</div>
          <h1 className="hero-title" style={{ fontSize: "clamp(32px,5vw,56px)", opacity: 1, animation: "none", marginBottom: "12px" }}>
            What movie is<br /><span className="accent">this scene from?</span>
          </h1>
          <p style={{ fontSize: "15px", color: "var(--muted)", lineHeight: 1.65 }}>
            Upload a screenshot or video clip and Ace will identify it instantly.
          </p>
        </div>

        {/* TABS */}
        {status !== "done" && (
          <div style={{ display: "flex", background: "var(--surface)", border: "1px solid var(--border2)", borderRadius: "10px", overflow: "hidden", marginBottom: "20px" }}>
            <button onClick={() => { setTab("image"); reset(); }} style={{ flex: 1, padding: "10px", fontSize: "13px", fontWeight: 500, fontFamily: "Syne, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", border: "none", cursor: "pointer", background: tab === "image" ? "var(--surface2)" : "transparent", color: tab === "image" ? "var(--blue)" : "var(--muted)", borderRight: "1px solid var(--border2)", transition: "all .15s" }}>
              📷 Screenshot
            </button>
            <button onClick={() => { setTab("video"); reset(); }} style={{ flex: 1, padding: "10px", fontSize: "13px", fontWeight: 500, fontFamily: "Syne, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", border: "none", cursor: "pointer", background: tab === "video" ? "var(--surface2)" : "transparent", color: tab === "video" ? "var(--blue)" : "var(--muted)", transition: "all .15s" }}>
              🎬 Video clip
            </button>
          </div>
        )}

        {/* UPLOAD AREA */}
        {status === "idle" && !file && (
          <div onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={handleDrop} onClick={() => fileRef.current?.click()} style={{ border: `1px dashed ${dragOver ? "var(--blue)" : "rgba(45,126,248,0.25)"}`, borderRadius: "16px", padding: "3rem 2rem", textAlign: "center", cursor: "pointer", background: dragOver ? "var(--blue-faint)" : "var(--surface)", transition: "all .2s" }}>
            <input ref={fileRef} type="file" accept={tab === "image" ? "image/*" : "video/*"} style={{ display: "none" }} onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
            <div style={{ width: "52px", height: "52px", borderRadius: "50%", background: "var(--blue-faint)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", fontSize: "22px" }}>
              {tab === "image" ? "📷" : "🎬"}
            </div>
            <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--text)", marginBottom: "6px" }}>
              {tab === "image" ? "Drop your screenshot here" : "Drop your video clip here"}
            </div>
            <div style={{ fontSize: "13px", color: "var(--muted)", lineHeight: 1.6, marginBottom: "16px" }}>
              {tab === "image" ? "Any still from a movie or TV show · JPG, PNG, WEBP" : "3–60 seconds works best · MP4, MOV, MKV, WEBM"}
            </div>
            <div style={{ display: "inline-block", background: "var(--blue)", color: "#fff", borderRadius: "8px", padding: "8px 20px", fontSize: "13px", fontWeight: 600 }}>
              Browse files
            </div>
          </div>
        )}

        {/* FILE PREVIEW */}
        {status === "idle" && file && (
          <div style={{ background: "var(--surface)", border: "1px solid var(--border2)", borderRadius: "16px", overflow: "hidden" }}>
            {preview && (
              <div style={{ width: "100%", maxHeight: "320px", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", background: "#000" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt="Preview" style={{ width: "100%", maxHeight: "320px", objectFit: "contain" }} />
              </div>
            )}
            {!preview && (
              <div style={{ padding: "32px", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--surface2)", gap: "12px" }}>
                <span style={{ fontSize: "32px" }}>🎬</span>
                <div>
                  <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)" }}>{file.name}</div>
                  <div style={{ fontSize: "12px", color: "var(--muted)" }}>{(file.size / 1024 / 1024).toFixed(1)} MB</div>
                </div>
              </div>
            )}
            <div style={{ padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
              <div style={{ fontSize: "13px", color: "var(--muted)" }}>
                <span style={{ color: "var(--text)", fontWeight: 500 }}>{file.name}</span> · {(file.size / 1024 / 1024).toFixed(1)} MB
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button onClick={reset} style={{ padding: "8px 16px", borderRadius: "8px", border: "1px solid var(--border2)", background: "transparent", color: "var(--muted)", fontSize: "13px", cursor: "pointer", fontFamily: "Syne, sans-serif" }}>
                  Change
                </button>
                <button onClick={runIdentify} style={{ padding: "8px 20px", borderRadius: "8px", border: "none", background: "var(--blue)", color: "#fff", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "Syne, sans-serif", display: "flex", alignItems: "center", gap: "6px" }}>
                  ✦ Identify scene
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ANALYZING */}
        {status === "analyzing" && (
          <div style={{ background: "var(--surface)", border: "1px solid var(--border2)", borderRadius: "16px", padding: "48px 32px", textAlign: "center" }}>
            <div style={{ width: "56px", height: "56px", borderRadius: "50%", border: "2px solid var(--blue-faint)", borderTop: "2px solid var(--blue)", margin: "0 auto 24px", animation: "spin 1s linear infinite" }}></div>
            <div style={{ fontFamily: "DM Mono, monospace", fontSize: "11px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--blue-bright)", marginBottom: "8px" }}>Ace is analyzing</div>
            <div style={{ fontSize: "15px", color: "var(--muted)", marginBottom: "32px" }}>{stageText}</div>
            <div style={{ display: "flex", gap: "6px", justifyContent: "center" }}>
              {[0, 1, 2, 3, 4].map(i => (
                <div key={i} style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--blue)", opacity: 0.3, animation: `dotpulse 1.2s ease-in-out ${i * 0.15}s infinite` }}></div>
              ))}
            </div>
          </div>
        )}

        {/* ERROR */}
        {status === "error" && (
          <div style={{ background: "var(--surface)", border: "1px solid rgba(224,92,92,0.3)", borderRadius: "16px", padding: "32px", textAlign: "center" }}>
            <div style={{ fontSize: "32px", marginBottom: "12px" }}>⚠️</div>
            <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--text)", marginBottom: "8px" }}>Identification failed</div>
            <div style={{ fontSize: "13px", color: "var(--muted)", marginBottom: "24px" }}>{errorMsg}</div>
            <button onClick={reset} style={{ padding: "9px 20px", borderRadius: "8px", border: "none", background: "var(--blue)", color: "#fff", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "Syne, sans-serif" }}>Try again</button>
          </div>
        )}

        {/* RESULT */}
        {status === "done" && result && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px", animation: "fadeup 0.4s ease forwards" }}>

            {/* BACKDROP */}
            {result.tmdb?.backdrop && (
              <div style={{ width: "100%", height: "200px", borderRadius: "16px", overflow: "hidden", position: "relative" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={result.tmdb.backdrop} alt="Backdrop" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, var(--bg) 0%, transparent 60%)" }}></div>
              </div>
            )}

            {/* MAIN RESULT */}
            <div style={{ background: "var(--surface)", border: "1px solid var(--border2)", borderRadius: "16px", overflow: "hidden" }}>
              <div style={{ height: "3px", background: "var(--blue)" }}></div>
              <div style={{ padding: "28px", display: "flex", gap: "20px", flexWrap: "wrap" }}>

                {/* POSTER */}
                {result.tmdb?.poster && (
                  <div style={{ flexShrink: 0 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={result.tmdb.poster} alt="Poster" style={{ width: "110px", borderRadius: "10px", display: "block" }} />
                  </div>
                )}

                <div style={{ flex: 1, minWidth: "200px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
                    <div style={{ fontFamily: "DM Mono, monospace", fontSize: "10px", fontWeight: 600, letterSpacing: "1px", textTransform: "uppercase", padding: "3px 8px", borderRadius: "4px", background: "rgba(61,184,122,0.1)", color: "#3DB87A", border: "1px solid rgba(61,184,122,0.25)" }}>
                      {result.confidence}% match
                    </div>
                    {result.tmdb?.voteAverage && (
                      <div style={{ fontFamily: "DM Mono, monospace", fontSize: "10px", color: "var(--muted)" }}>
                        ⭐ {result.tmdb.voteAverage} TMDB
                      </div>
                    )}
                  </div>

                  <div style={{ fontSize: "clamp(22px,4vw,34px)", fontWeight: 800, letterSpacing: "-0.5px", color: "var(--text)", lineHeight: 1.05, marginBottom: "4px" }}>
                    {result.title}
                  </div>

                  {result.tmdb?.tagline && (
                    <div style={{ fontSize: "13px", color: "var(--blue-bright)", fontStyle: "italic", marginBottom: "8px" }}>
                      &ldquo;{result.tmdb.tagline}&rdquo;
                    </div>
                  )}

                  <div style={{ fontFamily: "DM Mono, monospace", fontSize: "12px", color: "var(--muted)", marginBottom: "12px", lineHeight: 1.7 }}>
                    <span style={{ color: "var(--text)" }}>{result.year}</span> · {result.director} · {result.runtime}
                  </div>

                  {/* GENRES */}
                  {result.tmdb?.genres && result.tmdb.genres.length > 0 && (
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "12px" }}>
                      {result.tmdb.genres.map(g => (
                        <span key={g} style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "20px", background: "var(--blue-faint)", border: "1px solid var(--border)", color: "var(--blue-bright)", fontFamily: "DM Mono, monospace" }}>{g}</span>
                      ))}
                    </div>
                  )}

                  <div style={{ fontSize: "13px", color: "var(--muted)", lineHeight: 1.65, paddingTop: "12px", borderTop: "1px solid var(--border2)", marginBottom: "10px" }}>
                    {result.description}
                  </div>

                  <div style={{ fontFamily: "DM Mono, monospace", fontSize: "11px", color: "#EF9F27", fontStyle: "italic", marginBottom: "16px" }}>
                    {result.scene}
                  </div>

                  {/* ACTION BUTTONS */}
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    {result.tmdb?.trailer && (
                      <a href={result.tmdb.trailer} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 16px", borderRadius: "8px", background: "#FF0000", color: "#fff", fontSize: "12px", fontWeight: 600, textDecoration: "none", fontFamily: "Syne, sans-serif" }}>
                        ▶ Watch Trailer
                      </a>
                    )}
                    {result.tmdb?.tmdbUrl && (
                      <a href={result.tmdb.tmdbUrl} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 16px", borderRadius: "8px", background: "var(--blue-faint)", border: "1px solid var(--border)", color: "var(--blue-bright)", fontSize: "12px", fontWeight: 600, textDecoration: "none", fontFamily: "Syne, sans-serif" }}>
                        View on TMDB
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* STREAMING */}
            {result.tmdb?.streaming && result.tmdb.streaming.length > 0 && (
              <div style={{ background: "var(--surface)", border: "1px solid var(--border2)", borderRadius: "16px", padding: "20px 24px" }}>
                <div style={{ fontFamily: "DM Mono, monospace", fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--blue-bright)", marginBottom: "14px" }}>
                  Where to watch
                </div>
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  {result.tmdb.streaming.map(s => (
                    <div key={s.name} style={{ display: "flex", alignItems: "center", gap: "8px", background: "var(--surface2)", border: "1px solid var(--border2)", borderRadius: "8px", padding: "8px 14px" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.logo} alt={s.name} style={{ width: "24px", height: "24px", borderRadius: "4px" }} />
                      <span style={{ fontSize: "13px", color: "var(--text)", fontWeight: 500 }}>{s.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* CAST */}
            {result.tmdb?.cast && result.tmdb.cast.length > 0 && (
              <div style={{ background: "var(--surface)", border: "1px solid var(--border2)", borderRadius: "16px", padding: "20px 24px" }}>
                <div style={{ fontFamily: "DM Mono, monospace", fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--blue-bright)", marginBottom: "14px" }}>
                  Top cast
                </div>
                <div style={{ display: "flex", gap: "10px", overflowX: "auto", paddingBottom: "4px" }}>
                  {result.tmdb.cast.map(c => (
                    <div key={c.name} style={{ flexShrink: 0, width: "80px", textAlign: "center" }}>
                      {c.photo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.photo} alt={c.name} style={{ width: "64px", height: "64px", borderRadius: "50%", objectFit: "cover", marginBottom: "6px", border: "2px solid var(--border2)" }} />
                      ) : (
                        <div style={{ width: "64px", height: "64px", borderRadius: "50%", background: "var(--surface2)", border: "2px solid var(--border2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px", margin: "0 auto 6px" }}>👤</div>
                      )}
                      <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text)", lineHeight: 1.3 }}>{c.name}</div>
                      <div style={{ fontSize: "10px", color: "var(--muted)", lineHeight: 1.3 }}>{c.character}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* SIGNAL BREAKDOWN */}
            <div style={{ background: "var(--surface)", border: "1px solid var(--border2)", borderRadius: "16px", padding: "20px 24px" }}>
              <div style={{ fontFamily: "DM Mono, monospace", fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--blue-bright)", marginBottom: "14px" }}>
                Signal breakdown
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {[
                  { label: "Visual", val: result.signals.visual, color: "#2D7EF8" },
                  { label: "Dialogue", val: result.signals.dialogue, color: "#3DB87A" },
                  { label: "Color grade", val: result.signals.colorGrade, color: "#EF9F27" },
                  { label: "Text / titles", val: result.signals.textTitles, color: "#C086F8" },
                ].map(s => (
                  <div key={s.label} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <div style={{ fontFamily: "DM Mono, monospace", fontSize: "11px", color: "var(--muted)", minWidth: "80px" }}>{s.label}</div>
                    <div style={{ flex: 1, height: "4px", background: "var(--surface2)", borderRadius: "2px", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${s.val}%`, background: s.color, borderRadius: "2px" }}></div>
                    </div>
                    <div style={{ fontFamily: "DM Mono, monospace", fontSize: "11px", color: "var(--muted2)", minWidth: "32px", textAlign: "right" }}>{s.val}%</div>
                  </div>
                ))}
              </div>
            </div>

            {/* ALTERNATIVES */}
            {result.alternatives?.length > 0 && (
              <div style={{ background: "var(--surface)", border: "1px solid var(--border2)", borderRadius: "16px", padding: "20px 24px" }}>
                <div style={{ fontFamily: "DM Mono, monospace", fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--blue-bright)", marginBottom: "14px" }}>
                  Other possibilities
                </div>
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  {result.alternatives.map(a => (
                    <div key={a.title} style={{ flex: 1, minWidth: "150px", background: "var(--surface2)", border: "1px solid var(--border2)", borderRadius: "10px", padding: "12px 14px" }}>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text)", marginBottom: "2px" }}>{a.title}</div>
                      <div style={{ fontFamily: "DM Mono, monospace", fontSize: "11px", color: "var(--muted)", marginBottom: "8px" }}>{a.year} · {a.confidence}%</div>
                      <div style={{ height: "2px", background: "var(--surface)", borderRadius: "2px", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${a.confidence}%`, background: "var(--blue-dim)", borderRadius: "2px" }}></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ textAlign: "center", paddingTop: "8px" }}>
              <button onClick={reset} style={{ padding: "12px 28px", borderRadius: "10px", border: "1px solid var(--border2)", background: "transparent", color: "var(--muted)", fontSize: "14px", cursor: "pointer", fontFamily: "Syne, sans-serif", fontWeight: 500 }}>
                ← Identify another scene
              </button>
            </div>
          </div>
        )}
      </div>

      {/* FOOTER */}
      <footer>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <Image src="/Vortex_logo.png" alt="Vortex logo" width={28} height={28} style={{ objectFit: "contain" }} />
          <div className="footer-logo">VORTEX<span>.</span></div>
        </div>
        <div className="ace-badge footer-ace">
          <Image src="/Ace_Analytics.png" alt="Ace Analytics" width={16} height={16} style={{ objectFit: "contain", borderRadius: "3px" }} />
          AI powered by Ace Analytics
        </div>
      </footer>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes dotpulse {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.4); }
        }
      `}</style>
    </div>
  );
}