"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";

// ── ANIMATED COUNTER ──────────────────────────────────────────────────────────
function Counter({ target, suffix = "" }: { target: number; suffix?: string }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !started.current) {
        started.current = true;
        const duration = 1800;
        const steps = 60;
        const inc = target / steps;
        let cur = 0;
        const iv = setInterval(() => {
          cur = Math.min(cur + inc, target);
          setCount(Math.floor(cur));
          if (cur >= target) clearInterval(iv);
        }, duration / steps);
      }
    }, { threshold: 0.5 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [target]);

  return <span ref={ref}>{count.toLocaleString()}{suffix}</span>;
}

// ── SCROLL REVEAL ─────────────────────────────────────────────────────────────
function Reveal({ children, delay = 0, className = "" }: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setVisible(true); obs.disconnect(); }
    }, { threshold: 0.1 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(24px)",
        transition: `opacity 0.7s ease ${delay}ms, transform 0.7s ease ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

export default function Home() {
  const words = ["movie scene", "TV moment", "anime fight", "film clip"];
  const [wordIdx, setWordIdx] = useState(0);
  const [displayed, setDisplayed] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const word = words[wordIdx];
    if (!deleting && displayed.length < word.length) {
      const t = setTimeout(() => setDisplayed(word.slice(0, displayed.length + 1)), 80);
      return () => clearTimeout(t);
    }
    if (!deleting && displayed.length === word.length) {
      const t = setTimeout(() => setDeleting(true), 2000);
      return () => clearTimeout(t);
    }
    if (deleting && displayed.length > 0) {
      const t = setTimeout(() => setDisplayed(displayed.slice(0, -1)), 45);
      return () => clearTimeout(t);
    }
    if (deleting && displayed.length === 0) {
      setDeleting(false);
      setWordIdx((i) => (i + 1) % words.length);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayed, deleting, wordIdx]);

  return (
    <>
      <div className="orb orb-1"></div>
      <div className="orb orb-2"></div>

      {/* NAV */}
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
            <Image src="/Ace_Analytics.png" alt="Ace Analytics" width={18} height={18} style={{ objectFit: "contain", borderRadius: "3px" }} />
            Ace Analytics
          </div>
          <Link href="/identify" className="nav-cta">Try for free</Link>
        </div>
      </nav>

      {/* HERO */}
      <section className="hero" id="home">
        <div className="hero-eyebrow">AI-powered scene identification</div>
        <h1 className="hero-title">
          Identify any<br />
          <span className="accent" style={{ display: "inline-block", minWidth: "2px" }}>
            {displayed}
            <span style={{ borderRight: "3px solid #2D7EF8", marginLeft: "2px", animation: "blink 1s step-end infinite" }}>&nbsp;</span>
          </span><br />
          <span className="dim">in seconds.</span>
        </h1>
        <p className="hero-sub">
          Upload a screenshot or clip — Vortex analyzes visual composition, color grading, and dialogue to match it against millions of frames instantly.
        </p>
        <div className="hero-btns">
          <Link href="/identify" className="btn-primary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
            Identify a scene
          </Link>
          <a href="#how" className="btn-secondary">
            How it works
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
          </a>
        </div>

        {/* DEMO CARD */}
        <div className="hero-demo">
          <div className="demo-topbar">
            <div className="demo-dot r"></div>
            <div className="demo-dot y"></div>
            <div className="demo-dot g"></div>
            <div className="demo-title">vortex-movie-analyzer — scene upload</div>
          </div>
          <div className="demo-body">
            <div className="demo-left">
              <div className="demo-scene">
                <div className="scene-grid"></div>
                <div className="corner-tl"></div>
                <div className="corner-tr"></div>
                <div className="corner-bl"></div>
                <div className="corner-br"></div>
                <div className="scan-line"></div>
                <div className="scene-icon">🎬</div>
              </div>
              <div className="demo-upload-label">Scene uploaded · analyzing</div>
            </div>
            <div className="demo-right">
              <div className="demo-status">
                <div className="status-dot"></div>
                Match found
              </div>
              <div className="demo-match-title">INTER<span>STELLAR</span></div>
              <div className="demo-meta">
                <b>2014</b> · Christopher Nolan<br />
                Sci-Fi / Adventure · 169 min<br />
                Act 3 — docking near Gargantua
              </div>
              <div className="demo-conf">
                <div className="conf-bar"><div className="conf-fill"></div></div>
                <div className="conf-label">97%</div>
              </div>
              <div className="demo-alts">
                <div className="alt-row"><span className="alt-name">Arrival (2016)</span><span className="alt-pct">61%</span></div>
                <div className="alt-row"><span className="alt-name">Gravity (2013)</span><span className="alt-pct">44%</span></div>
                <div className="alt-row"><span className="alt-name">2001: A Space Odyssey</span><span className="alt-pct">32%</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* STATS BAR */}
      <div style={{ background: "var(--surface)", borderTop: "1px solid var(--border2)", borderBottom: "1px solid var(--border2)", padding: "32px 48px" }}>
        <div style={{ maxWidth: "1100px", margin: "0 auto", display: "flex", gap: "48px", justifyContent: "center", flexWrap: "wrap" }}>
          {[
            { value: 500000, suffix: "+", label: "Movies & shows" },
            { value: 97, suffix: "%", label: "Accuracy rate" },
            { value: 3, suffix: "s", label: "Avg response time" },
            { value: 4, suffix: "", label: "Detection signals" },
          ].map((stat) => (
            <div key={stat.label} style={{ textAlign: "center" }}>
              <div style={{ fontSize: "clamp(28px,4vw,40px)", fontWeight: 800, color: "var(--blue)", letterSpacing: "-1px", lineHeight: 1 }}>
                <Counter target={stat.value} suffix={stat.suffix} />
              </div>
              <div style={{ fontFamily: "DM Mono, monospace", fontSize: "11px", color: "var(--muted)", letterSpacing: "1.5px", textTransform: "uppercase", marginTop: "6px" }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="section-divider"></div>

      {/* HOW IT WORKS */}
      <section className="section" id="how">
        <Reveal>
          <div className="section-label">How it works</div>
          <h2 className="section-title">Three steps.<br /><span>Zero guesswork.</span></h2>
          <p className="section-sub">Vortex uses multi-signal AI analysis to identify any scene from any movie or TV show with surgical precision.</p>
        </Reveal>
        <div className="steps-grid">
          {[
            { num: "01", icon: "📤", title: "Upload your scene", desc: "Drop a screenshot, clip, or even a photo of your TV screen. Vortex accepts images and video clips up to 60 seconds." },
            { num: "02", icon: "🧠", title: "Ace analyzes it", desc: "Ace Analytics reads visual composition, color grading, dialogue, and on-screen text across multiple signals simultaneously." },
            { num: "03", icon: "🎯", title: "Get your match", desc: "Receive the movie title, year, director, and even which scene or act the clip is from — with a confidence score." },
            { num: "04", icon: "🎬", title: "Explore further", desc: "Dive into full movie details, similar films, cast, streaming availability, and related scenes from the same movie." },
          ].map((step, i) => (
            <Reveal key={step.num} delay={i * 100}>
              <div className="step-card" style={{ height: "100%" }}>
                <div className="step-num">{step.num}</div>
                <div className="step-icon">{step.icon}</div>
                <div className="step-title">{step.title}</div>
                <div className="step-desc">{step.desc}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <div className="section-divider"></div>

      {/* SIGNAL SECTION */}
      <div className="signal-section">
        <div className="signal-inner">
          <Reveal>
            <div>
              <div className="section-label">Multi-signal detection</div>
              <h2 className="section-title" style={{ marginBottom: "16px" }}>Every clue.<br /><span>Decoded.</span></h2>
              <p className="section-sub" style={{ marginBottom: 0 }}>Unlike image search, Vortex combines multiple signals to achieve near-perfect accuracy — even on blurry, dark, or partial scenes.</p>
              <div className="signal-chips">
                <div className="sig-chip visual">👁 Visual frames</div>
                <div className="sig-chip audio">🎙 Audio / dialogue</div>
                <div className="sig-chip text">📝 On-screen text</div>
                <div className="sig-chip meta">✦ Color grading</div>
              </div>
            </div>
          </Reveal>
          <Reveal delay={150}>
            <div className="signal-visual" id="sig-bars">
              {[
                { label: "Visual", val: 94, color: "#2D7EF8" },
                { label: "Dialogue", val: 87, color: "#3DB87A" },
                { label: "Color grade", val: 78, color: "#EF9F27" },
                { label: "Text / titles", val: 65, color: "#C086F8" },
              ].map((bar) => (
                <div key={bar.label} className="sig-bar-row">
                  <div className="sig-bar-label">{bar.label}</div>
                  <div className="sig-bar-track">
                    <div className="sig-bar-fill" style={{ background: bar.color }} data-w={bar.val}></div>
                  </div>
                  <div className="sig-bar-val">{bar.val}%</div>
                </div>
              ))}
              <div className="sig-bar-row" style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="sig-bar-label" style={{ color: "#4D9AFF", fontWeight: 500 }}>Combined</div>
                <div className="sig-bar-track">
                  <div className="sig-bar-fill" style={{ background: "#2D7EF8" }} data-w={97}></div>
                </div>
                <div className="sig-bar-val" style={{ color: "#4D9AFF" }}>97%</div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>

      {/* FEATURES */}
      <section className="section" id="features">
        <Reveal>
          <div className="section-label">Features</div>
          <h2 className="section-title">Built for <span>real use.</span></h2>
          <p className="section-sub">Everything you need to go from &quot;what movie is this?&quot; to a full answer — in one place.</p>
        </Reveal>
        <div className="features-grid">
          {[
            { tag: "Screenshot", title: "Single frame ID", desc: "One still is all it takes. Upload a screenshot from anywhere — social media, a friend's text, your camera roll — and get a match in seconds." },
            { tag: "Video clip", title: "Multi-frame analysis", desc: "Upload up to 60 seconds of video. Vortex extracts keyframes, analyzes each one, and aggregates the results for maximum accuracy." },
            { tag: "Audio", title: "Dialogue matching", desc: "Any spoken dialogue in your clip gets transcribed and matched against a database of millions of subtitles — a massive accuracy boost." },
            { tag: "Metadata", title: "Full movie details", desc: "Every match returns the title, year, director, cast, genre, runtime, rating, streaming links, and which scene or act your clip is from." },
            { tag: "Confidence", title: "Always transparent", desc: "Every result shows a confidence score and a ranked list of alternative matches — so you always know how certain the AI is." },
            { tag: "Powered by Ace", title: "Getting smarter daily", desc: "Ace Analytics powers the identification engine. It learns from every match and continuously expands its frame database across new releases." },
          ].map((f, i) => (
            <Reveal key={f.tag} delay={i * 80}>
              <div className="feature-card" style={{ height: "100%" }}>
                <div className="feature-tag">{f.tag}</div>
                <div className="feature-title">{f.title}</div>
                <div className="feature-desc">{f.desc}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* CTA */}
      <Reveal>
        <div className="cta-section" id="try">
          <div className="cta-inner">
            <div className="ace-badge" style={{ margin: "0 auto 24px", display: "inline-flex" }}>
              <Image src="/Ace_Analytics.png" alt="Ace Analytics" width={20} height={20} style={{ objectFit: "contain", borderRadius: "3px" }} />
              Ace Analytics
            </div>
            <h2 className="cta-title">What movie<br />is <span>that scene</span> from?</h2>
            <p className="cta-sub">Stop searching. Just upload and let Vortex do it — in seconds.</p>
            <div className="cta-btns">
              <Link href="/identify" className="btn-primary">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                Upload a scene — it&apos;s free
              </Link>
              <a href="#how" className="btn-secondary">Learn more</a>
            </div>
          </div>
        </div>
      </Reveal>

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

      <script dangerouslySetInnerHTML={{
        __html: `
          const bars = document.querySelectorAll('.sig-bar-fill');
          const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
              if (entry.isIntersecting) {
                bars.forEach(bar => { bar.style.width = bar.dataset.w + '%'; });
                observer.disconnect();
              }
            });
          }, { threshold: 0.3 });
          const sigSection = document.getElementById('sig-bars');
          if (sigSection) observer.observe(sigSection);
        `
      }} />

      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </>
  );
}