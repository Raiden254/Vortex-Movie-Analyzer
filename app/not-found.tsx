"use client";

import Link from "next/link";
import Image from "next/image";

export default function NotFound() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", flexDirection: "column" }}>
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
        </div>
      </nav>

      <div className="orb orb-1"></div>
      <div className="orb orb-2"></div>

      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", position: "relative", zIndex: 1 }}>
        <div style={{ textAlign: "center", maxWidth: "480px" }}>

          {/* Glitchy 404 */}
          <div style={{ position: "relative", marginBottom: "24px" }}>
            <div style={{ fontSize: "clamp(80px,15vw,140px)", fontWeight: 900, letterSpacing: "-4px", color: "transparent", WebkitTextStroke: "1px rgba(45,126,248,0.2)", lineHeight: 1, userSelect: "none" }}>
              404
            </div>
            <div style={{ position: "absolute", inset: 0, fontSize: "clamp(80px,15vw,140px)", fontWeight: 900, letterSpacing: "-4px", color: "var(--blue)", lineHeight: 1, opacity: 0.08, filter: "blur(20px)" }}>
              404
            </div>
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ fontSize: "48px", animation: "float 3s ease-in-out infinite" }}>🎬</div>
            </div>
          </div>

          <div className="hero-eyebrow" style={{ opacity: 1, animation: "none", marginBottom: "12px" }}>Scene not found</div>

          <h1 style={{ fontSize: "clamp(22px,4vw,32px)", fontWeight: 800, color: "var(--text)", marginBottom: "12px", letterSpacing: "-0.5px" }}>
            This page went missing<br />like a deleted scene
          </h1>

          <p style={{ fontSize: "14px", color: "var(--muted)", lineHeight: 1.7, marginBottom: "32px" }}>
            The page you&apos;re looking for doesn&apos;t exist. Maybe it was cut from the final edit. Head back and identify some scenes instead.
          </p>

          <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/" style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "12px 24px", borderRadius: "10px", background: "var(--blue)", color: "#fff", fontSize: "14px", fontWeight: 600, textDecoration: "none", fontFamily: "Syne, sans-serif" }}>
              ← Back to home
            </Link>
            <Link href="/identify" style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "12px 24px", borderRadius: "10px", background: "var(--surface)", border: "1px solid var(--border2)", color: "var(--muted)", fontSize: "14px", fontWeight: 600, textDecoration: "none", fontFamily: "Syne, sans-serif" }}>
              ✦ Identify a scene
            </Link>
          </div>

          {/* Fun fact */}
          <div style={{ marginTop: "48px", padding: "16px 20px", background: "var(--surface)", border: "1px solid var(--border2)", borderRadius: "12px", display: "inline-block" }}>
            <div style={{ fontFamily: "DM Mono, monospace", fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--blue-bright)", marginBottom: "6px" }}>Did you know?</div>
            <div style={{ fontSize: "13px", color: "var(--muted)", lineHeight: 1.6 }}>
              Vortex can identify scenes from over 500,000 movies and TV shows using AI visual analysis.
            </div>
          </div>
        </div>
      </div>

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
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-12px); }
        }
      `}</style>
    </div>
  );
}