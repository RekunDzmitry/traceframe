/* global React */
const { useState: useStateV3, useEffect: useEffectV3 } = React;

/* =========================================================
   V3 — CALCULATOR-LED. Money as the hero.
   ========================================================= */

const NavV3 = () => (
  <nav style={{
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "20px 56px", borderBottom: "1px solid var(--line)",
  }}>
    <Logo />
    <div style={{ display: "flex", gap: 32, fontSize: 13, color: "var(--ink-3)" }}>
      <a>Calculator</a>
      <a>How it works</a>
      <a>Privacy</a>
      <a>FAQ</a>
    </div>
    <button className="btn-acid" style={{ padding: "10px 16px", fontSize: 13 }}>
      Get my estimate →
    </button>
  </nav>
);

/* HERO = giant interactive calculator */
const HeroCalcV3 = () => {
  const [seats, setSeats] = useStateV3(40);
  const [spend, setSpend] = useStateV3(220);
  const [tick, setTick] = useStateV3(0);

  useEffectV3(() => {
    const t = setInterval(() => setTick((x) => x + 1), 80);
    return () => clearInterval(t);
  }, []);

  const monthly = seats * spend;
  const saved = Math.round(monthly * 0.62);
  const youKeep = saved - Math.round(saved * 0.1);
  const annual = youKeep * 12;
  const ourCut = Math.round(saved * 0.1);

  // animated counter
  const [animatedAnnual, setAnimatedAnnual] = useStateV3(annual);
  useEffectV3(() => {
    setAnimatedAnnual(annual);
  }, [annual]);

  return (
    <section style={{ padding: "60px 56px 80px", borderBottom: "1px solid var(--line)", position: "relative", overflow: "hidden" }}>
      {/* ambient grid */}
      <div style={{
        position: "absolute", inset: 0,
        backgroundImage:
          "linear-gradient(rgba(212,255,58,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(212,255,58,0.03) 1px, transparent 1px)",
        backgroundSize: "48px 48px",
        maskImage: "radial-gradient(circle at 50% 40%, black, transparent 70%)",
      }} />

      <div style={{ position: "relative" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48, marginBottom: 32 }}>
          <div className="chip" style={{ width: "fit-content" }}>
            <span className="dot" /> LIVE SAVINGS CALCULATOR · Q2 2026
          </div>
          <div className="mono-sm" style={{ color: "var(--ink-4)", textAlign: "right" }}>
            BASED ON ACTUAL EARLY-PILOT DATA · ±8% VARIANCE
          </div>
        </div>

        <h1 style={{
          fontFamily: "var(--serif)", fontSize: 72, lineHeight: 0.96,
          letterSpacing: "-0.035em", maxWidth: 1100, marginBottom: 56,
        }}>
          Your team would have <em style={{ color: "var(--acid)", fontStyle: "italic" }}>already saved</em>
        </h1>

        {/* THE BIG NUMBER */}
        <div style={{
          fontFamily: "var(--serif)",
          fontSize: 280, lineHeight: 0.85, letterSpacing: "-0.06em",
          color: "var(--acid)",
          textShadow: "0 0 80px rgba(212,255,58,0.2)",
          fontVariantNumeric: "tabular-nums",
        }}>
          ${animatedAnnual.toLocaleString()}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 24 }}>
          <p style={{ fontFamily: "var(--serif)", fontSize: 36, color: "var(--ink-2)", letterSpacing: "-0.02em" }}>
            in the first year alone, with a private model<br />
            running locally inside <span style={{ color: "var(--acid)" }}>Cursor</span>, <span style={{ color: "var(--acid)" }}>Codex</span>, and <span style={{ color: "var(--acid)" }}>Antigravity</span>.
          </p>
          <span className="mono-sm" style={{ color: "var(--ink-4)" }}>
            ░ {String(tick % 100).padStart(2, "0")} · CALCULATING IN REAL TIME
          </span>
        </div>

        {/* INPUT BAR */}
        <div style={{
          marginTop: 64,
          background: "var(--bg-1)",
          border: "1px solid var(--line-strong)",
          padding: "28px 36px",
          display: "grid",
          gridTemplateColumns: "1.1fr 1.1fr 1fr 1fr 1fr",
          gap: 32,
          alignItems: "center",
        }}>
          <div>
            <div className="mono-sm" style={{ color: "var(--ink-4)", marginBottom: 10 }}>ENGINEERS</div>
            <input
              type="range" min={5} max={500} step={5} value={seats}
              onChange={(e) => setSeats(Number(e.target.value))}
              style={{ width: "100%", accentColor: "#d4ff3a" }}
            />
            <div style={{ fontFamily: "var(--serif)", fontSize: 32, marginTop: 4 }}>{seats}</div>
          </div>

          <div>
            <div className="mono-sm" style={{ color: "var(--ink-4)", marginBottom: 10 }}>SPEND PER SEAT / MO</div>
            <input
              type="range" min={50} max={800} step={10} value={spend}
              onChange={(e) => setSpend(Number(e.target.value))}
              style={{ width: "100%", accentColor: "#d4ff3a" }}
            />
            <div style={{ fontFamily: "var(--serif)", fontSize: 32, marginTop: 4 }}>${spend}</div>
          </div>

          <div style={{ borderLeft: "1px solid var(--line)", paddingLeft: 24 }}>
            <div className="mono-sm" style={{ color: "var(--ink-4)", marginBottom: 10 }}>WAS</div>
            <div style={{ fontFamily: "var(--serif)", fontSize: 32, color: "var(--ink-3)" }}>${monthly.toLocaleString()}<span style={{ fontSize: 14, fontFamily: "var(--mono)", color: "var(--ink-5)" }}>/mo</span></div>
          </div>

          <div>
            <div className="mono-sm" style={{ color: "var(--ink-4)", marginBottom: 10 }}>NOW</div>
            <div style={{ fontFamily: "var(--serif)", fontSize: 32 }}>${(monthly - saved).toLocaleString()}<span style={{ fontSize: 14, fontFamily: "var(--mono)", color: "var(--ink-5)" }}>/mo</span></div>
          </div>

          <div>
            <div className="mono-sm" style={{ color: "var(--acid)", marginBottom: 10 }}>OUR FEE (10%)</div>
            <div style={{ fontFamily: "var(--serif)", fontSize: 32, color: "var(--acid)" }}>${ourCut.toLocaleString()}<span style={{ fontSize: 14, fontFamily: "var(--mono)", color: "var(--ink-5)" }}>/mo</span></div>
          </div>
        </div>

        <div style={{ marginTop: 40, display: "flex", gap: 12, alignItems: "center" }}>
          <button className="btn-acid">Lock in this estimate →</button>
          <button className="btn-ghost">See how the math works</button>
          <span className="mono-sm" style={{ color: "var(--ink-4)", marginLeft: 24 }}>
            INVOICED ONLY ON VERIFIED SAVINGS · NO BASELINE BEAT, NO BILL
          </span>
        </div>
      </div>
    </section>
  );
};

/* TICKER STRIP */
const TickerV3 = () => (
  <section style={{
    padding: "20px 0",
    borderBottom: "1px solid var(--line)",
    background: "var(--bg-1)",
    overflow: "hidden",
    whiteSpace: "nowrap",
  }}>
    <div style={{ display: "inline-flex", gap: 48, fontFamily: "var(--mono)", fontSize: 12, color: "var(--ink-3)", letterSpacing: "0.06em" }}>
      {Array.from({ length: 4 }).flatMap((_, j) =>
        ["62% AVG TOKEN BILL CUT", "0 BYTES OFF YOUR LAPTOP", "10% OF SAVINGS = OUR ENTIRE PRICE", "RUNS IN CURSOR · CODEX · ANTIGRAVITY", "20 SLOTS · Q2 2026 · WAITLIST OPEN"].map((t, i) => (
          <span key={`${j}-${i}`} style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
            <span style={{ color: "var(--acid)" }}>◆</span>
            {t}
          </span>
        ))
      )}
    </div>
  </section>
);

/* PROBLEM V3 — three reframed costs */
const ProblemV3 = () => (
  <section style={{ padding: "120px 56px", borderBottom: "1px solid var(--line)" }}>
    <div className="eyebrow" style={{ marginBottom: 24 }}>02 — WHAT YOU'RE ACTUALLY PAYING FOR</div>
    <h2 className="h-section" style={{ marginBottom: 64, maxWidth: 1100 }}>
      Three line items hiding inside your AI bill.<br />
      <em>None of them are necessary.</em>
    </h2>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 0, border: "1px solid var(--line)" }}>
      {[
        { num: "$$$", label: "AMNESIA TAX", title: "Re-sending the same context, forever.", body: "Every conversation re-uploads your codebase. You pay for the same tokens to be read by a model that immediately forgets them." },
        { num: "🔓", label: "PRIVACY TAX", title: "Trusting a vendor's policy as architecture.", body: "Zero-retention is a promise, not a guarantee. One config flip and your moat is in someone else's training set." },
        { num: "≠", label: "FIT TAX", title: "Paying frontier prices for general-purpose answers.", body: "Frontier models know the public web. They don't know your monorepo. You're paying premium rates for off-the-shelf intuition." },
      ].map((c, i) => (
        <div key={i} style={{ padding: "40px 32px", borderRight: i < 2 ? "1px solid var(--line)" : "none", background: i === 1 ? "var(--bg-1)" : "transparent" }}>
          <div style={{ fontFamily: "var(--serif)", fontSize: 56, color: "var(--warn)", marginBottom: 16, letterSpacing: "-0.04em" }}>{c.num}</div>
          <div className="mono-sm" style={{ color: "var(--warn)", marginBottom: 16 }}>{c.label}</div>
          <div className="h-card" style={{ marginBottom: 16 }}>{c.title}</div>
          <div className="body" style={{ fontSize: 14 }}>{c.body}</div>
        </div>
      ))}
    </div>
  </section>
);

/* HOW V3 — compact 3-step horizontal */
const HowV3 = () => (
  <section style={{ padding: "120px 56px", borderBottom: "1px solid var(--line)" }}>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 64, marginBottom: 64 }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 24 }}>03 — HOW THE SAVINGS HAPPEN</div>
        <h2 className="h-section">Three steps.<br /><em>~2 weeks.</em></h2>
      </div>
      <p className="body-lg" style={{ alignSelf: "end" }}>
        We come on-site or join your VPN, distill a model on your code and docs,
        and install it as a local provider in the IDEs your team already uses.
        Then we keep tuning until ~93% of prompts stay on the laptop.
      </p>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 0, border: "1px solid var(--line)" }}>
      {[
        ["01", "You give.", "Code · docs · time", "We ingest your repos, RFCs, internal wikis, and recent PRs — on your hardware. Nothing copies off."],
        ["02", "We train.", "Distill · quantize · benchmark", "From a strong open base, distilled to your stack, quantized to fit comfortably on M-series Macs."],
        ["03", "You save.", "Plug into Cursor/Codex/Antigravity", "Local provider routes ~93% of prompts to your private model. Hard ones escalate with your own keys."],
      ].map(([n, t, s, b], i) => (
        <div key={i} style={{ padding: "40px 32px", borderRight: i < 2 ? "1px solid var(--line)" : "none" }}>
          <div className="mono-sm" style={{ color: "var(--acid)", marginBottom: 16 }}>STEP {n}</div>
          <div style={{ fontFamily: "var(--serif)", fontSize: 44, letterSpacing: "-0.03em", marginBottom: 8 }}>{t}</div>
          <div className="mono-sm" style={{ color: "var(--ink-4)", marginBottom: 18 }}>{s}</div>
          <div className="body" style={{ fontSize: 14 }}>{b}</div>
        </div>
      ))}
    </div>
  </section>
);

/* PRIVACY V3 */
const PrivacyV3 = () => (
  <section style={{ padding: "120px 56px", borderBottom: "1px solid var(--line)", background: "var(--bg-1)" }}>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64, alignItems: "center" }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 24 }}>04 — PRIVATE BY ARCHITECTURE</div>
        <h2 className="h-section">
          Your code never<br />
          <em>leaves the laptop</em><br />
          it was written on.
        </h2>
        <p className="body-lg" style={{ marginTop: 32, maxWidth: 480 }}>
          Weights live in <span style={{ fontFamily: "var(--mono)", color: "var(--acid)" }}>~/.lume/models/</span>.
          Inference happens on your hardware. There is no telemetry to disable
          and no policy to violate, because there are no packets to send.
        </p>

        <div style={{ marginTop: 32, display: "flex", flexWrap: "wrap", gap: 8 }}>
          {["AIR-GAPPED", "AUDITABLE ROUTING", "BYO ESCALATION KEYS", "ZERO TELEMETRY", "OPEN-WEIGHT BASE", "SOC 2 IN PROGRESS"].map((t) => (
            <span key={t} className="chip">{t}</span>
          ))}
        </div>
      </div>

      <div style={{ background: "var(--bg)", border: "1px solid var(--line-strong)", padding: 32 }}>
        <div className="mono-sm" style={{ color: "var(--ink-4)", marginBottom: 20 }}>~/.lume/router.log · last 5 min</div>
        <div style={{ fontFamily: "var(--mono)", fontSize: 11.5, lineHeight: 1.7 }}>
          {[
            ["12:04:21", "complete", "src/routes/api.ts", "→ local"],
            ["12:04:33", "explain", "lib/auth/session.ts", "→ local"],
            ["12:05:02", "refactor", "components/Modal.tsx", "→ local"],
            ["12:05:18", "novel-arch", "design/system-v3.md", "→ frontier ✓"],
            ["12:05:44", "complete", "src/routes/api.ts", "→ local"],
            ["12:06:01", "test-gen", "lib/queue/worker.ts", "→ local"],
            ["12:06:27", "complete", "ui/Toast.tsx", "→ local"],
            ["12:06:55", "explain", "infra/terraform/", "→ local"],
            ["12:07:12", "complete", "src/utils/dates.ts", "→ local"],
          ].map(([t, op, file, route], i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "70px 80px 1fr 110px" }}>
              <span style={{ color: "var(--ink-5)" }}>{t}</span>
              <span style={{ color: "var(--ink-3)" }}>{op}</span>
              <span style={{ color: "var(--ink-2)" }}>{file}</span>
              <span style={{ color: route.includes("frontier") ? "var(--warn)" : "var(--acid)" }}>{route}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 20, display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--ink-4)", fontFamily: "var(--mono)" }}>
          <span><span style={{ color: "var(--acid)" }}>━</span> 8 prompts handled locally</span>
          <span><span style={{ color: "var(--warn)" }}>━</span> 1 escalated (with consent)</span>
        </div>
      </div>
    </div>
  </section>
);

/* COMPARISON V3 */
const ComparisonV3 = () => {
  const rows = [
    ["Where your code lives", "Their datacenters", "Their datacenters", "Your laptop"],
    ["Trained on your stack", "No", "No", "Yes"],
    ["Marginal cost / prompt", "$$ per call", "$$ per call", "≈ free"],
    ["Works offline", "No", "No", "Yes"],
    ["Pricing", "Per-token", "Per-token", "10% of savings"],
    ["If you cancel", "Nothing", "Nothing", "You keep the weights"],
  ];
  return (
    <section style={{ padding: "120px 56px", borderBottom: "1px solid var(--line)" }}>
      <div className="eyebrow" style={{ marginBottom: 24 }}>05 — vs FRONTIER</div>
      <h2 className="h-section" style={{ marginBottom: 56, maxWidth: 1000 }}>
        We don't compete with GPT‑5.<br /><em>We compete with paying for it 93% of the time.</em>
      </h2>
      <div style={{ border: "1px solid var(--line)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", background: "var(--bg-1)", borderBottom: "1px solid var(--line)" }}>
          <div className="mono-sm" style={{ padding: "20px 24px" }}>FEATURE</div>
          <div className="mono-sm" style={{ padding: "20px 24px", borderLeft: "1px solid var(--line)" }}>OPENAI</div>
          <div className="mono-sm" style={{ padding: "20px 24px", borderLeft: "1px solid var(--line)" }}>ANTHROPIC</div>
          <div className="mono-sm" style={{ padding: "20px 24px", borderLeft: "1px solid var(--acid)", color: "var(--acid)" }}>LUME · LOCAL</div>
        </div>
        {rows.map((r, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", borderBottom: i < rows.length - 1 ? "1px solid var(--line)" : "none" }}>
            <div style={{ padding: "20px 24px", color: "var(--ink-2)", fontSize: 14 }}>{r[0]}</div>
            <div style={{ padding: "20px 24px", borderLeft: "1px solid var(--line)", color: "var(--ink-4)", fontSize: 14, fontFamily: "var(--mono)" }}>{r[1]}</div>
            <div style={{ padding: "20px 24px", borderLeft: "1px solid var(--line)", color: "var(--ink-4)", fontSize: 14, fontFamily: "var(--mono)" }}>{r[2]}</div>
            <div style={{ padding: "20px 24px", borderLeft: "1px solid var(--acid)", color: "var(--acid)", fontSize: 14, fontFamily: "var(--mono)" }}>{r[3]}</div>
          </div>
        ))}
      </div>
    </section>
  );
};

/* PRICING V3 — same as v1 but tighter */
const PricingV3 = () => (
  <section style={{ padding: "120px 56px", borderBottom: "1px solid var(--line)", background: "var(--bg-1)" }}>
    <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 64, alignItems: "center" }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 24 }}>06 — PRICING</div>
        <h2 className="h-section">
          Pay <em style={{ color: "var(--acid)" }}>nothing</em> until<br />
          we save you something.
        </h2>
        <p className="body-lg" style={{ marginTop: 32, maxWidth: 520 }}>
          Connect your existing AI provider's billing API. We snapshot your trailing 30
          days as the baseline. Each month, your invoice is exactly 10% of the difference.
          If we don't beat baseline, the invoice is $0.
        </p>
        <div style={{ marginTop: 32, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, fontSize: 13, color: "var(--ink-3)" }}>
          <span>· No setup fee</span>
          <span>· No per-seat license</span>
          <span>· Cancel anytime</span>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 16 }}>
        <span style={{ fontFamily: "var(--serif)", fontSize: 320, lineHeight: 0.9, letterSpacing: "-0.06em" }}>10</span>
        <span style={{ fontFamily: "var(--serif)", fontSize: 160, lineHeight: 0.9, color: "var(--acid)" }}>%</span>
      </div>
    </div>
  </section>
);

/* FAQ V3 */
const FAQV3 = () => {
  const [open, setOpen] = useStateV3(0);
  const items = [
    ["Does the local model actually keep up?", "On code grounded in your stack — yes, often better. We benchmark every distilled model against the frontier model you were using. If we don't beat baseline, we don't deploy."],
    ["What hardware does my team need?", "An M-series Mac with 16GB+ unified memory. Larger models on M3 Max / M4 Pro. Linux/CUDA workstations are in beta."],
    ["How is this different from running Llama locally?", "Stock open models don't know your code. We distill them on your repos, RFCs, and recent PRs, and keep tuning monthly."],
    ["What happens during training?", "Training runs on hardware you control. Data does not leave your perimeter. Air-gapped is supported."],
    ["What if we cancel?", "You keep the weights. No DRM, no expiry. The model is yours."],
  ];
  return (
    <section style={{ padding: "120px 56px", borderBottom: "1px solid var(--line)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 64, alignItems: "start" }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 24 }}>07 — FAQ</div>
          <h2 className="h-section">Common<br /><em>questions.</em></h2>
        </div>
        <div style={{ borderTop: "1px solid var(--line)" }}>
          {items.map((it, i) => (
            <div key={i} style={{ borderBottom: "1px solid var(--line)" }}>
              <button onClick={() => setOpen(open === i ? -1 : i)} style={{ width: "100%", padding: "24px 4px", display: "flex", justifyContent: "space-between", textAlign: "left", color: "var(--ink)" }}>
                <span style={{ fontSize: 18, fontWeight: 500 }}>
                  <span style={{ fontFamily: "var(--mono)", color: "var(--ink-4)", fontSize: 12, marginRight: 16 }}>{String(i+1).padStart(2,"0")}</span>
                  {it[0]}
                </span>
                <span style={{ color: open === i ? "var(--acid)" : "var(--ink-4)", fontSize: 22, fontFamily: "var(--mono)" }}>{open === i ? "−" : "+"}</span>
              </button>
              {open === i && (
                <div style={{ padding: "0 4px 24px 44px", color: "var(--ink-3)", fontSize: 15, lineHeight: 1.6, maxWidth: 720 }}>{it[1]}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

/* FOUNDER V3 — short */
const FounderV3 = () => (
  <section style={{ padding: "100px 56px", borderBottom: "1px solid var(--line)" }}>
    <div className="eyebrow" style={{ marginBottom: 32 }}>08 — A NOTE</div>
    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 40, alignItems: "start", maxWidth: 1100 }}>
      <div style={{ width: 88, height: 88, background: "linear-gradient(135deg, #1a1a1a, #0a0a0a)", border: "1px solid var(--line-strong)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--serif)", fontSize: 32, color: "var(--acid)" }}>M·K</div>
      <div>
        <p style={{ fontFamily: "var(--serif)", fontSize: 28, lineHeight: 1.4, letterSpacing: "-0.015em", maxWidth: 820 }}>
          We've watched companies pour millions a year into AI bills, shipping their crown jewels through someone else's API to do it. <em style={{ color: "var(--acid)" }}>This isn't sustainable. It isn't necessary.</em> Lume is the toolchain we wish existed when we were on the other side of this problem. We charge a percentage because we should only get paid when you save.
        </p>
        <div style={{ marginTop: 20, fontSize: 14 }}>
          <span style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 18 }}>Maya & Kostas</span>
          <span className="mono-sm" style={{ color: "var(--ink-4)", marginLeft: 16 }}>FOUNDERS · LUME</span>
        </div>
      </div>
    </div>
  </section>
);

/* FINAL CTA V3 */
const FinalCTAV3 = () => (
  <section style={{ padding: "120px 56px", textAlign: "center" }}>
    <h2 style={{ fontFamily: "var(--serif)", fontSize: 96, lineHeight: 0.95, letterSpacing: "-0.04em" }}>
      Lock in your <em style={{ color: "var(--acid)" }}>estimate.</em>
    </h2>
    <p className="body-lg" style={{ maxWidth: 540, margin: "32px auto 0" }}>
      Tell us your stack. We'll send a baseline savings projection within 48 hours.
    </p>
    <form onSubmit={(e) => e.preventDefault()} style={{ marginTop: 40, display: "flex", maxWidth: 540, margin: "40px auto 0", border: "1px solid var(--line-strong)", background: "var(--bg-1)" }}>
      <input placeholder="you@company.com" style={{ flex: 1, background: "transparent", border: "none", outline: "none", padding: "18px 20px", color: "var(--ink)", fontSize: 15 }} />
      <button className="btn-acid" style={{ borderRadius: 0, padding: "0 28px" }}>Get my estimate →</button>
    </form>
    <div className="mono-sm" style={{ marginTop: 20, color: "var(--ink-4)" }}>20 SLOTS · Q2 2026 · NO SPAM</div>
  </section>
);

const LandingV3 = () => (
  <div className="lp">
    <NavV3 />
    <HeroCalcV3 />
    <TickerV3 />
    <ProblemV3 />
    <HowV3 />
    <PrivacyV3 />
    <ComparisonV3 />
    <PricingV3 />
    <FAQV3 />
    <FounderV3 />
    <FinalCTAV3 />
    <Footer />
  </div>
);

Object.assign(window, { LandingV3 });
