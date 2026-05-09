import Image from "next/image";

export default function Home() {
  return (
    <>
      <div className="orb orb-1"></div>
      <div className="orb orb-2"></div>

      {/* NAV */}
      <nav>
        <a className="nav-logo" href="#">
          <Image src="/Vortex_logo.png" alt="Vortex logo" width={42} height={42} style={{ objectFit: "contain" }} />
          <div>
            <div className="nav-wordmark">VORTEX<span>.</span></div>
            <div className="nav-sub">Movie Analyzer</div>
          </div>
        </a>
        <div className="nav-right">
          <div className="ace-badge">
            <Image src="/Ace_Analytics.png" alt="Ace Analytics" width={18} height={18} style={{ objectFit: "contain", borderRadius: "3px" }} />
            Ace Analytics
          </div>
          <a href="#try" className="nav-cta">Try for free</a>
        </div>
      </nav>

      {/* HERO */}
      <section className="hero" id="home">
        <div className="hero-eyebrow">AI-powered scene identification</div>
        <h1 className="hero-title">
          Identify any<br />
          <span className="accent">movie scene</span><br />
          <span className="dim">in seconds.</span>
        </h1>
        <p className="hero-sub">
          Upload a screenshot or clip — Vortex analyzes visual composition, color grading, and dialogue to match it against millions of frames instantly.
        </p>
        <div className="hero-btns">
          <a href="/identify" className="btn-primary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
            Identify a scene
          </a>
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

      <div className="section-divider"></div>

      {/* HOW IT WORKS */}
      <section className="section" id="how">
        <div className="section-label">How it works</div>
        <h2 className="section-title">Three steps.<br /><span>Zero guesswork.</span></h2>
        <p className="section-sub">Vortex uses multi-signal AI analysis to identify any scene from any movie or TV show with surgical precision.</p>
        <div className="steps-grid">
          <div className="step-card">
            <div className="step-num">01</div>
            <div className="step-icon">📤</div>
            <div className="step-title">Upload your scene</div>
            <div className="step-desc">Drop a screenshot, clip, or even a photo of your TV screen. Vortex accepts images and video clips up to 60 seconds.</div>
          </div>
          <div className="step-card">
            <div className="step-num">02</div>
            <div className="step-icon">🧠</div>
            <div className="step-title">Ace analyzes it</div>
            <div className="step-desc">Ace Analytics reads visual composition, color grading, dialogue, and on-screen text across multiple signals simultaneously.</div>
          </div>
          <div className="step-card">
            <div className="step-num">03</div>
            <div className="step-icon">🎯</div>
            <div className="step-title">Get your match</div>
            <div className="step-desc">Receive the movie title, year, director, and even which scene or act the clip is from — with a confidence score.</div>
          </div>
          <div className="step-card">
            <div className="step-num">04</div>
            <div className="step-icon">🎬</div>
            <div className="step-title">Explore further</div>
            <div className="step-desc">Dive into full movie details, similar films, cast, streaming availability, and related scenes from the same movie.</div>
          </div>
        </div>
      </section>

      <div className="section-divider"></div>

      {/* SIGNAL SECTION */}
      <div className="signal-section">
        <div className="signal-inner">
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
          <div className="signal-visual" id="sig-bars">
            <div className="sig-bar-row">
              <div className="sig-bar-label">Visual</div>
              <div className="sig-bar-track"><div className="sig-bar-fill" style={{ background: "#2D7EF8" }} data-w="94"></div></div>
              <div className="sig-bar-val">94%</div>
            </div>
            <div className="sig-bar-row">
              <div className="sig-bar-label">Dialogue</div>
              <div className="sig-bar-track"><div className="sig-bar-fill" style={{ background: "#3DB87A" }} data-w="87"></div></div>
              <div className="sig-bar-val">87%</div>
            </div>
            <div className="sig-bar-row">
              <div className="sig-bar-label">Color grade</div>
              <div className="sig-bar-track"><div className="sig-bar-fill" style={{ background: "#EF9F27" }} data-w="78"></div></div>
              <div className="sig-bar-val">78%</div>
            </div>
            <div className="sig-bar-row">
              <div className="sig-bar-label">Text / titles</div>
              <div className="sig-bar-track"><div className="sig-bar-fill" style={{ background: "#C086F8" }} data-w="65"></div></div>
              <div className="sig-bar-val">65%</div>
            </div>
            <div className="sig-bar-row" style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="sig-bar-label" style={{ color: "#4D9AFF", fontWeight: 500 }}>Combined</div>
              <div className="sig-bar-track"><div className="sig-bar-fill" style={{ background: "#2D7EF8" }} data-w="97"></div></div>
              <div className="sig-bar-val" style={{ color: "#4D9AFF" }}>97%</div>
            </div>
          </div>
        </div>
      </div>

      {/* FEATURES */}
      <section className="section" id="features">
        <div className="section-label">Features</div>
        <h2 className="section-title">Built for <span>real use.</span></h2>
        <p className="section-sub">Everything you need to go from &quot;what movie is this?&quot; to a full answer — in one place.</p>
        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-tag">Screenshot</div>
            <div className="feature-title">Single frame ID</div>
            <div className="feature-desc">One still is all it takes. Upload a screenshot from anywhere — social media, a friend&apos;s text, your camera roll — and get a match in seconds.</div>
          </div>
          <div className="feature-card">
            <div className="feature-tag">Video clip</div>
            <div className="feature-title">Multi-frame analysis</div>
            <div className="feature-desc">Upload up to 60 seconds of video. Vortex extracts keyframes, analyzes each one, and aggregates the results for maximum accuracy.</div>
          </div>
          <div className="feature-card">
            <div className="feature-tag">Audio</div>
            <div className="feature-title">Dialogue matching</div>
            <div className="feature-desc">Any spoken dialogue in your clip gets transcribed and matched against a database of millions of subtitles — a massive accuracy boost.</div>
          </div>
          <div className="feature-card">
            <div className="feature-tag">Metadata</div>
            <div className="feature-title">Full movie details</div>
            <div className="feature-desc">Every match returns the title, year, director, cast, genre, runtime, rating, streaming links, and which scene or act your clip is from.</div>
          </div>
          <div className="feature-card">
            <div className="feature-tag">Confidence</div>
            <div className="feature-title">Always transparent</div>
            <div className="feature-desc">Every result shows a confidence score and a ranked list of alternative matches — so you always know how certain the AI is.</div>
          </div>
          <div className="feature-card">
            <div className="feature-tag">Powered by Ace</div>
            <div className="feature-title">Getting smarter daily</div>
            <div className="feature-desc">Ace Analytics powers the identification engine. It learns from every match and continuously expands its frame database across new releases.</div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <div className="cta-section" id="try">
        <div className="cta-inner">
          <div className="ace-badge" style={{ margin: "0 auto 24px", display: "inline-flex" }}>
            <Image src="/Ace_Analytics.png" alt="Ace Analytics" width={20} height={20} style={{ objectFit: "contain", borderRadius: "3px" }} />
            Ace Analytics
          </div>
          <h2 className="cta-title">What movie<br />is <span>that scene</span> from?</h2>
          <p className="cta-sub">Stop searching. Just upload and let Vortex do it — in seconds.</p>
          <div className="cta-btns">
            <a href="/identify" className="btn-primary">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
              Upload a scene — it&apos;s free
            </a>
            <a href="#how" className="btn-secondary">Learn more</a>
          </div>
        </div>
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

      {/* SIGNAL BARS SCRIPT */}
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
    </>
  );
}