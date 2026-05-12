"use client";

import { useState, useRef, useEffect } from "react";
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

type HistoryEntry = {
  id: string;
  result: Result;
  preview: string | null;
  timestamp: number;
};

export default function IdentifyPage() {
  const [tab, setTab] = useState<"image" | "video">("image");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "analyzing" | "done" | "error">("idle");
  const [result, setResult] = useState<Result | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [currentPreview, setCurrentPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const shareCardRef = useRef<HTMLDivElement>(null);

  const stages = [
    "Reading visual fingerprints...",
    "Analyzing color grading...",
    "Cross-referencing frame database...",
    "Fetching movie details...",
    "Finalizing match...",
  ];
  const [stageIdx, setStageIdx] = useState(0);

  // Load history from sessionStorage on mount
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("vortex-history");
      if (saved) setHistory(JSON.parse(saved));
    } catch { /* ignore */ }
  }, []);

  function saveToHistory(r: Result, p: string | null) {
    const entry: HistoryEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      result: r,
      preview: p,
      timestamp: Date.now(),
    };
    setHistory(prev => {
      const updated = [entry, ...prev].slice(0, 20); // keep last 20
      try { sessionStorage.setItem("vortex-history", JSON.stringify(updated)); } catch { /* ignore */ }
      return updated;
    });
  }

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
        canvas.width = width; canvas.height = height;
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
    if (f.type.startsWith("image/") && f.size > 2 * 1024 * 1024) {
      const compressed = await compressImage(f);
      setFile(compressed);
      const p = URL.createObjectURL(compressed);
      setPreview(p);
      setCurrentPreview(p);
    } else {
      setFile(f);
      const p = tab === "image" ? URL.createObjectURL(f) : null;
      setPreview(p);
      setCurrentPreview(p);
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
    setStageIdx(0);

    let si = 0;
    const iv = setInterval(() => {
      si = (si + 1) % stages.length;
      setStageIdx(si);
    }, 900);

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
      saveToHistory(data, currentPreview);
    } catch {
      clearInterval(iv);
      setErrorMsg("Network error. Please try again.");
      setStatus("error");
    }
  }

  function reset() {
    setFile(null);
    setPreview(null);
    setCurrentPreview(null);
    setResult(null);
    setStatus("idle");
    setErrorMsg("");
    if (fileRef.current) fileRef.current.value = "";
  }

  function loadFromHistory(entry: HistoryEntry) {
    setResult(entry.result);
    setPreview(entry.preview);
    setStatus("done");
    setShowHistory(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function clearHistory() {
    setHistory([]);
    try { sessionStorage.removeItem("vortex-history"); } catch { /* ignore */ }
  }

  async function copyShareText() {
    if (!result) return;
    const text = `🎬 I just identified "${result.title}" (${result.year}) using Vortex Movie Analyzer — ${result.confidence}% confidence!\n\nPowered by Ace Analytics · vortex-movie-analyzer.vercel.app`;
    try {
      await navigator.clipboard.writeText(text);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2500);
    } catch { /* ignore */ }
  }

  function formatTime(ts: number) {
    const diff = Date.now() - ts;
    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(ts).toLocaleDateString();
  }

  const confidenceColor = (c: number) =>
    c >= 80 ? "#3DB87A" : c >= 60 ? "#EF9F27" : "#E05C5C";

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
          {history.length > 0 && (
            <button
              onClick={() => setShowHistory(true)}
              style={{ display: "flex", alignItems: "center", gap: "6px", padding: "7px 14px", borderRadius: "8px", border: "1px solid var(--border2)", background: "var(--surface)", color: "var(--muted)", fontSize: "12px", cursor: "pointer", fontFamily: "Syne, sans-serif", fontWeight: 500 }}
            >
              🕒 History <span style={{ background: "var(--blue)", color: "#fff", borderRadius: "10px", padding: "1px 6px", fontSize: "10px" }}>{history.length}</span>
            </button>
          )}
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
            {(["image", "video"] as const).map((t, i) => (
              <button key={t} onClick={() => { setTab(t); reset(); }} style={{ flex: 1, padding: "10px", fontSize: "13px", fontWeight: 500, fontFamily: "Syne, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", border: "none", cursor: "pointer", background: tab === t ? "var(--surface2)" : "transparent", color: tab === t ? "var(--blue)" : "var(--muted)", borderRight: i === 0 ? "1px solid var(--border2)" : "none", transition: "all .15s" }}>
                {t === "image" ? "📷 Screenshot" : "🎬 Video clip"}
              </button>
            ))}
          </div>
        )}

        {/* UPLOAD AREA */}
        {status === "idle" && !file && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            style={{ border: `2px dashed ${dragOver ? "var(--blue)" : "rgba(45,126,248,0.25)"}`, borderRadius: "16px", padding: "3rem 2rem", textAlign: "center", cursor: "pointer", background: dragOver ? "var(--blue-faint)" : "var(--surface)", transition: "all .2s", transform: dragOver ? "scale(1.01)" : "scale(1)" }}
          >
            <input ref={fileRef} type="file" accept={tab === "image" ? "image/*" : "video/*"} style={{ display: "none" }} onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
            <div style={{ width: "56px", height: "56px", borderRadius: "50%", background: "var(--blue-faint)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", fontSize: "24px", transition: "transform .2s", transform: dragOver ? "scale(1.15)" : "scale(1)" }}>
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
          <div style={{ background: "var(--surface)", border: "1px solid var(--border2)", borderRadius: "16px", overflow: "hidden", animation: "fadeup 0.3s ease forwards" }}>
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
          <div style={{ background: "var(--surface)", border: "1px solid var(--border2)", borderRadius: "16px", padding: "48px 32px", textAlign: "center", animation: "fadeup 0.3s ease forwards" }}>
            <div style={{ position: "relative", width: "64px", height: "64px", margin: "0 auto 24px" }}>
              <div style={{ width: "64px", height: "64px", borderRadius: "50%", border: "2px solid var(--blue-faint)", borderTop: "2px solid var(--blue)", animation: "spin 1s linear infinite" }}></div>
              <div style={{ position: "absolute", inset: "12px", borderRadius: "50%", border: "2px solid var(--border2)", borderBottom: "2px solid var(--blue-bright)", animation: "spin 1.5s linear infinite reverse" }}></div>
            </div>
            <div style={{ fontFamily: "DM Mono, monospace", fontSize: "11px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--blue-bright)", marginBottom: "8px" }}>Ace is analyzing</div>
            <div style={{ fontSize: "15px", color: "var(--muted)", marginBottom: "32px", minHeight: "24px", transition: "opacity .3s" }}>{stages[stageIdx]}</div>
            <div style={{ display: "flex", gap: "6px", justifyContent: "center" }}>
              {[0, 1, 2, 3, 4].map(i => (
                <div key={i} style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--blue)", opacity: 0.3, animation: `dotpulse 1.2s ease-in-out ${i * 0.15}s infinite` }}></div>
              ))}
            </div>
          </div>
        )}

        {/* ERROR */}
        {status === "error" && (
          <div style={{ background: "var(--surface)", border: "1px solid rgba(224,92,92,0.3)", borderRadius: "16px", padding: "32px", textAlign: "center", animation: "fadeup 0.3s ease forwards" }}>
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

            {/* MAIN RESULT CARD */}
            <div ref={shareCardRef} style={{ background: "var(--surface)", border: "1px solid var(--border2)", borderRadius: "16px", overflow: "hidden" }}>
              <div style={{ height: "3px", background: `linear-gradient(to right, var(--blue), ${confidenceColor(result.confidence)})` }}></div>
              <div style={{ padding: "28px", display: "flex", gap: "20px", flexWrap: "wrap" }}>

                {/* POSTER */}
                {result.tmdb?.poster && (
                  <div style={{ flexShrink: 0 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={result.tmdb.poster} alt="Poster" style={{ width: "110px", borderRadius: "10px", display: "block", boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }} />
                  </div>
                )}

                <div style={{ flex: 1, minWidth: "200px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
                    <div style={{ fontFamily: "DM Mono, monospace", fontSize: "10px", fontWeight: 600, letterSpacing: "1px", textTransform: "uppercase", padding: "3px 10px", borderRadius: "4px", background: `${confidenceColor(result.confidence)}18`, color: confidenceColor(result.confidence), border: `1px solid ${confidenceColor(result.confidence)}40` }}>
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
                    {/* SHARE BUTTON */}
                    <button
                      onClick={() => setShowShareModal(true)}
                      style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 16px", borderRadius: "8px", background: "var(--surface2)", border: "1px solid var(--border2)", color: "var(--muted)", fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: "Syne, sans-serif" }}
                    >
                      ↗ Share result
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* STREAMING */}
            {result.tmdb?.streaming && result.tmdb.streaming.length > 0 && (
              <div style={{ background: "var(--surface)", border: "1px solid var(--border2)", borderRadius: "16px", padding: "20px 24px" }}>
                <div style={{ fontFamily: "DM Mono, monospace", fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--blue-bright)", marginBottom: "14px" }}>Where to watch</div>
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
                <div style={{ fontFamily: "DM Mono, monospace", fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--blue-bright)", marginBottom: "14px" }}>Top cast</div>
                <div style={{ display: "flex", gap: "12px", overflowX: "auto", paddingBottom: "4px" }}>
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
              <div style={{ fontFamily: "DM Mono, monospace", fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--blue-bright)", marginBottom: "14px" }}>Signal breakdown</div>
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
                      <div style={{ height: "100%", width: `${s.val}%`, background: s.color, borderRadius: "2px", transition: "width 1s ease" }}></div>
                    </div>
                    <div style={{ fontFamily: "DM Mono, monospace", fontSize: "11px", color: "var(--muted2)", minWidth: "32px", textAlign: "right" }}>{s.val}%</div>
                  </div>
                ))}
              </div>
            </div>

            {/* ALTERNATIVES */}
            {result.alternatives?.length > 0 && (
              <div style={{ background: "var(--surface)", border: "1px solid var(--border2)", borderRadius: "16px", padding: "20px 24px" }}>
                <div style={{ fontFamily: "DM Mono, monospace", fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--blue-bright)", marginBottom: "14px" }}>Other possibilities</div>
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
              <button onClick={reset} style={{ padding: "12px 28px", borderRadius: "10px", border: "1px solid var(--border2)", background: "transparent", color: "var(--muted)", fontSize: "14px", cursor: "pointer", fontFamily: "Syne, sans-serif", fontWeight: 500, transition: "all .2s" }}>
                ← Identify another scene
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── HISTORY MODAL ──────────────────────────────────────────────────── */}
      {showHistory && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: "0 0 0 0" }} onClick={() => setShowHistory(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "var(--surface)", border: "1px solid var(--border2)", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: "820px", maxHeight: "75vh", overflow: "hidden", display: "flex", flexDirection: "column", animation: "slideup 0.3s ease forwards" }}>
            <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border2)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--text)" }}>Session History</div>
                <div style={{ fontSize: "12px", color: "var(--muted)" }}>{history.length} identification{history.length !== 1 ? "s" : ""} this session</div>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button onClick={clearHistory} style={{ padding: "6px 12px", borderRadius: "7px", border: "1px solid rgba(224,92,92,0.3)", background: "transparent", color: "#E05C5C", fontSize: "12px", cursor: "pointer", fontFamily: "Syne, sans-serif" }}>
                  Clear all
                </button>
                <button onClick={() => setShowHistory(false)} style={{ padding: "6px 12px", borderRadius: "7px", border: "1px solid var(--border2)", background: "transparent", color: "var(--muted)", fontSize: "12px", cursor: "pointer", fontFamily: "Syne, sans-serif" }}>
                  Close
                </button>
              </div>
            </div>
            <div style={{ overflowY: "auto", padding: "16px 24px", display: "flex", flexDirection: "column", gap: "10px" }}>
              {history.map(entry => (
                <div
                  key={entry.id}
                  onClick={() => loadFromHistory(entry)}
                  style={{ display: "flex", gap: "14px", alignItems: "center", padding: "14px", background: "var(--surface2)", border: "1px solid var(--border2)", borderRadius: "12px", cursor: "pointer", transition: "border-color .15s" }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--blue)")}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--border2)")}
                >
                  {entry.preview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={entry.preview} alt="" style={{ width: "60px", height: "40px", objectFit: "cover", borderRadius: "6px", flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: "60px", height: "40px", background: "var(--surface)", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px", flexShrink: 0 }}>🎬</div>
                  )}
                  {entry.result.tmdb?.poster && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={entry.result.tmdb.poster} alt="" style={{ width: "32px", borderRadius: "4px", flexShrink: 0 }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{entry.result.title}</div>
                    <div style={{ fontFamily: "DM Mono, monospace", fontSize: "11px", color: "var(--muted)" }}>{entry.result.year} · {entry.result.confidence}% match</div>
                  </div>
                  <div style={{ fontFamily: "DM Mono, monospace", fontSize: "10px", color: "var(--muted2)", flexShrink: 0 }}>{formatTime(entry.timestamp)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── SHARE MODAL ────────────────────────────────────────────────────── */}
      {showShareModal && result && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }} onClick={() => setShowShareModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "var(--surface)", border: "1px solid var(--border2)", borderRadius: "20px", width: "100%", maxWidth: "480px", overflow: "hidden", animation: "fadeup 0.3s ease forwards" }}>

            {/* Share card preview */}
            <div style={{ background: "linear-gradient(135deg, #0A0E1A 0%, #111620 100%)", padding: "28px", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: "-40px", right: "-40px", width: "160px", height: "160px", borderRadius: "50%", background: "rgba(45,126,248,0.08)", border: "1px solid rgba(45,126,248,0.12)" }}></div>
              <div style={{ display: "flex", gap: "16px", alignItems: "flex-start", position: "relative" }}>
                {result.tmdb?.poster && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={result.tmdb.poster} alt="" style={{ width: "72px", borderRadius: "8px", boxShadow: "0 8px 24px rgba(0,0,0,0.6)", flexShrink: 0 }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "DM Mono, monospace", fontSize: "9px", letterSpacing: "2px", color: "var(--blue-bright)", marginBottom: "6px", textTransform: "uppercase" }}>Identified by Vortex</div>
                  <div style={{ fontSize: "22px", fontWeight: 800, color: "#fff", lineHeight: 1.1, marginBottom: "4px" }}>{result.title}</div>
                  <div style={{ fontFamily: "DM Mono, monospace", fontSize: "11px", color: "rgba(255,255,255,0.5)", marginBottom: "10px" }}>{result.year} · {result.director}</div>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "4px 10px", borderRadius: "20px", background: `${confidenceColor(result.confidence)}20`, border: `1px solid ${confidenceColor(result.confidence)}40` }}>
                    <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: confidenceColor(result.confidence) }}></div>
                    <span style={{ fontFamily: "DM Mono, monospace", fontSize: "10px", color: confidenceColor(result.confidence), fontWeight: 600 }}>{result.confidence}% confidence</span>
                  </div>
                </div>
              </div>
              <div style={{ marginTop: "16px", paddingTop: "16px", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontFamily: "DM Mono, monospace", fontSize: "10px", color: "rgba(255,255,255,0.3)" }}>vortex-movie-analyzer.vercel.app</div>
                <div style={{ fontFamily: "DM Mono, monospace", fontSize: "9px", color: "rgba(255,255,255,0.25)" }}>Powered by Ace Analytics</div>
              </div>
            </div>

            {/* Share actions */}
            <div style={{ padding: "20px 24px" }}>
              <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", marginBottom: "4px" }}>Share this result</div>
              <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "16px" }}>Copy the share text and post it anywhere</div>

              <div style={{ background: "var(--surface2)", border: "1px solid var(--border2)", borderRadius: "10px", padding: "12px 14px", marginBottom: "12px", fontFamily: "DM Mono, monospace", fontSize: "11px", color: "var(--muted)", lineHeight: 1.6 }}>
                🎬 I just identified &quot;{result.title}&quot; ({result.year}) using Vortex Movie Analyzer — {result.confidence}% confidence!{"\n\n"}Powered by Ace Analytics · vortex-movie-analyzer.vercel.app
              </div>

              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  onClick={copyShareText}
                  style={{ flex: 1, padding: "10px", borderRadius: "9px", border: "none", background: shareCopied ? "#3DB87A" : "var(--blue)", color: "#fff", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "Syne, sans-serif", transition: "background .3s", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}
                >
                  {shareCopied ? "✓ Copied!" : "Copy share text"}
                </button>
                <button
                  onClick={() => setShowShareModal(false)}
                  style={{ padding: "10px 16px", borderRadius: "9px", border: "1px solid var(--border2)", background: "transparent", color: "var(--muted)", fontSize: "13px", cursor: "pointer", fontFamily: "Syne, sans-serif" }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
        @keyframes fadeup {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideup {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}