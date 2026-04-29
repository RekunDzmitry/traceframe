/* global React */

/* PRIVACY / SECURITY */
const PrivacyV1 = () => (
  <section style={{ padding: "100px 56px", borderBottom: "1px solid var(--line)", background: "var(--bg-1)" }}>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64 }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 24 }}>05 — PRIVACY BY ARCHITECTURE</div>
        <h2 className="h-section">
          The model<br />
          <em>doesn't have</em><br />
          internet access.
        </h2>
        <p className="body-lg" style={{ marginTop: 32, maxWidth: 480 }}>
          Lume runs as a local provider inside your IDE. The weights live in
          <span style={{ fontFamily: "var(--mono)", color: "var(--acid)" }}> ~/.lume/models/</span>.
          Inference happens on your CPU/GPU. No telemetry. No "anonymized" payloads.
          No "we promise we won't train on it." There's nothing to promise — the
          packets don't leave the machine.
        </p>

        <div style={{ marginTop: 40, display: "flex", gap: 12, flexWrap: "wrap" }}>
          {["AIR-GAPPED INFERENCE", "AUDITABLE ROUTING", "BYO ESCALATION KEYS", "SOC 2 IN PROGRESS", "OPEN-WEIGHT BASE", "ZERO TELEMETRY"].map((t) => (
            <span key={t} className="chip" style={{ borderColor: "var(--line-strong)" }}>{t}</span>
          ))}
        </div>
      </div>

      {/* network diagram */}
      <NetworkDiagram />
    </div>
  </section>
);

const NetworkDiagram = () => (
  <div style={{
    background: "var(--bg)",
    border: "1px solid var(--line)",
    padding: "32px 32px 24px",
    position: "relative",
    minHeight: 460,
  }}>
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 28 }}>
      <span className="mono-sm" style={{ color: "var(--ink-4)" }}>NETWORK ROUTING</span>
      <span className="mono-sm" style={{ color: "var(--acid)" }}>● LIVE</span>
    </div>

    <svg viewBox="0 0 480 380" style={{ width: "100%", height: "auto" }}>
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill="#3f3f3f" />
        </marker>
        <marker id="arrAcid" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill="#d4ff3a" />
        </marker>
      </defs>

      {/* IDE */}
      <g>
        <rect x="20" y="20" width="170" height="80" fill="#0f0f0f" stroke="#2e2e2e" />
        <text x="36" y="44" fill="#a3a3a3" fontFamily="JetBrains Mono, monospace" fontSize="11">CURSOR / CODEX / ANTIGRAV</text>
        <text x="36" y="74" fill="#f5f5f4" fontFamily="Inter Tight, sans-serif" fontSize="20" fontWeight="500">your IDE</text>
        <circle cx="178" cy="32" r="3" fill="#d4ff3a" />
      </g>

      {/* Lume router */}
      <g>
        <rect x="155" y="160" width="170" height="60" fill="#0a0a0a" stroke="#d4ff3a" strokeWidth="1.5" />
        <text x="170" y="184" fill="#d4ff3a" fontFamily="JetBrains Mono, monospace" fontSize="10">LUME · LOCAL ROUTER</text>
        <text x="170" y="206" fill="#f5f5f4" fontFamily="Inter Tight" fontSize="14">classify · route · log</text>
      </g>

      {/* Local model */}
      <g>
        <rect x="20" y="290" width="200" height="70" fill="#141414" stroke="#2e2e2e" />
        <text x="36" y="314" fill="#d4ff3a" fontFamily="JetBrains Mono, monospace" fontSize="10">~/.lume/models/local.bin</text>
        <text x="36" y="338" fill="#f5f5f4" fontFamily="Inter Tight" fontSize="16" fontWeight="500">your private model</text>
        <text x="36" y="354" fill="#6b6b6b" fontFamily="JetBrains Mono, monospace" fontSize="10">~93% of prompts</text>
      </g>

      {/* Frontier escalation */}
      <g>
        <rect x="270" y="290" width="190" height="70" fill="#0f0f0f" stroke="#2e2e2e" strokeDasharray="4 4" />
        <text x="284" y="314" fill="#6b6b6b" fontFamily="JetBrains Mono, monospace" fontSize="10">OPTIONAL · YOUR API KEY</text>
        <text x="284" y="338" fill="#a3a3a3" fontFamily="Inter Tight" fontSize="16" fontWeight="500">frontier escalation</text>
        <text x="284" y="354" fill="#6b6b6b" fontFamily="JetBrains Mono, monospace" fontSize="10">~7% · hard prompts only</text>
      </g>

      {/* lines */}
      <line x1="105" y1="100" x2="220" y2="160" stroke="#3f3f3f" strokeWidth="1" markerEnd="url(#arr)" />
      <line x1="220" y1="220" x2="120" y2="290" stroke="#d4ff3a" strokeWidth="1.5" markerEnd="url(#arrAcid)" />
      <line x1="280" y1="220" x2="360" y2="290" stroke="#3f3f3f" strokeWidth="1" strokeDasharray="3 3" markerEnd="url(#arr)" />

      {/* boundary */}
      <rect x="8" y="8" width="464" height="364" fill="none" stroke="#1f1f1f" strokeDasharray="2 4" />
      <text x="14" y="372" fill="#3f3f3f" fontFamily="JetBrains Mono, monospace" fontSize="9">[ YOUR LAPTOP ]</text>
    </svg>

    <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--ink-4)", fontFamily: "var(--mono)" }}>
      <span><span style={{ color: "var(--acid)" }}>━</span> stays local</span>
      <span><span style={{ color: "var(--ink-5)" }}>┄┄</span> only with explicit consent</span>
    </div>
  </div>
);

/* COMPARISON */
const ComparisonV1 = () => {
  const rows = [
    ["Where your code lives", "Their datacenters", "Their datacenters", "Your laptop"],
    ["Trained on your stack", "No", "No", "Yes"],
    ["Marginal cost / prompt", "$$ per call", "$$ per call", "≈ free"],
    ["Works offline", "No", "No", "Yes"],
    ["Customizable to your team", "Limited (system prompt)", "Limited (system prompt)", "Full distillation"],
    ["Pricing model", "Per-token", "Per-token", "10% of savings"],
    ["What you get if you cancel", "Nothing", "Nothing", "The weights"],
  ];

  return (
    <section style={{ padding: "100px 56px", borderBottom: "1px solid var(--line)" }}>
      <div className="eyebrow" style={{ marginBottom: 24 }}>06 — vs FRONTIER</div>
      <h2 className="h-section" style={{ marginBottom: 56, maxWidth: 900 }}>
        We're not trying to <em>beat GPT‑5</em>.<br />
        We're trying to stop you paying for it 93% of the time.
      </h2>

      <div style={{ border: "1px solid var(--line)" }}>
        <div style={{
          display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr",
          background: "var(--bg-1)",
          borderBottom: "1px solid var(--line)",
        }}>
          <div style={{ padding: "20px 24px" }} className="mono-sm">FEATURE</div>
          <div style={{ padding: "20px 24px", borderLeft: "1px solid var(--line)" }} className="mono-sm">OPENAI</div>
          <div style={{ padding: "20px 24px", borderLeft: "1px solid var(--line)" }} className="mono-sm">ANTHROPIC</div>
          <div style={{ padding: "20px 24px", borderLeft: "1px solid var(--acid)", color: "var(--acid)" }} className="mono-sm">LUME · LOCAL</div>
        </div>

        {rows.map((r, i) => (
          <div key={i} style={{
            display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr",
            borderBottom: i < rows.length - 1 ? "1px solid var(--line)" : "none",
          }}>
            <div style={{ padding: "22px 24px", color: "var(--ink-2)", fontSize: 14, fontWeight: 500 }}>{r[0]}</div>
            <div style={{ padding: "22px 24px", borderLeft: "1px solid var(--line)", color: "var(--ink-4)", fontSize: 14, fontFamily: "var(--mono)" }}>{r[1]}</div>
            <div style={{ padding: "22px 24px", borderLeft: "1px solid var(--line)", color: "var(--ink-4)", fontSize: 14, fontFamily: "var(--mono)" }}>{r[2]}</div>
            <div style={{ padding: "22px 24px", borderLeft: "1px solid var(--acid)", color: "var(--acid)", fontSize: 14, fontFamily: "var(--mono)" }}>{r[3]}</div>
          </div>
        ))}
      </div>
    </section>
  );
};

/* PRICING */
const PricingV1 = () => (
  <section style={{ padding: "100px 56px", borderBottom: "1px solid var(--line)" }}>
    <div className="eyebrow" style={{ marginBottom: 24 }}>07 — PRICING</div>
    <h2 className="h-section" style={{ marginBottom: 56, maxWidth: 1000 }}>
      One number. <em>Ten percent.</em><br />
      Of what we save you. Nothing else.
    </h2>

    <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 32 }}>
      <div style={{
        background: "var(--bg-1)",
        border: "1px solid var(--acid)",
        padding: "48px 48px 56px",
        position: "relative",
      }}>
        <div className="mono-sm" style={{ color: "var(--acid)", marginBottom: 28 }}>PERFORMANCE PRICING</div>

        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 8 }}>
          <span style={{ fontFamily: "var(--serif)", fontSize: 168, lineHeight: 1, letterSpacing: "-0.05em" }}>10</span>
          <span style={{ fontFamily: "var(--serif)", fontSize: 80, lineHeight: 1, color: "var(--acid)" }}>%</span>
        </div>
        <div className="body-lg" style={{ maxWidth: 480, marginTop: 16 }}>
          We measure your AI bill the month before you install lume. Every
          month after, you pay 10% of the difference. If we don't save you
          anything, you owe us nothing.
        </div>

        <div style={{ marginTop: 40, display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 24, paddingTop: 32, borderTop: "1px solid var(--line)" }}>
          {[
            ["No setup fee", "Onboarding included."],
            ["No seat licenses", "Train once, deploy team-wide."],
            ["No lock-in", "Cancel and keep your weights."],
          ].map(([t, d]) => (
            <div key={t}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ width: 14, height: 14, border: "1.5px solid var(--acid)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ width: 5, height: 5, background: "var(--acid)" }} />
                </span>
                <span style={{ fontWeight: 500, fontSize: 14 }}>{t}</span>
              </div>
              <div className="body" style={{ fontSize: 13, paddingLeft: 22 }}>{d}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{
        background: "var(--bg-1)",
        border: "1px solid var(--line)",
        padding: "40px 36px",
      }}>
        <div className="mono-sm" style={{ marginBottom: 20, color: "var(--ink-4)" }}>HOW WE MEASURE</div>
        <ol style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 24, fontSize: 14, color: "var(--ink-2)" }}>
          {[
            "Connect your existing AI provider's billing API (read-only).",
            "We snapshot the trailing 30 days. That's your baseline.",
            "Each month, your invoice = 10% × (baseline − new spend).",
            "If we don't beat baseline, the invoice is $0. Always.",
          ].map((s, i) => (
            <li key={i} style={{ display: "flex", gap: 16 }}>
              <span style={{
                fontFamily: "var(--mono)", fontSize: 11, color: "var(--acid)",
                width: 24, flexShrink: 0, paddingTop: 2,
              }}>0{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  </section>
);

/* FAQ */
const FAQV1 = () => {
  const [open, setOpen] = useState(0);
  const items = [
    {
      q: "Does the local model actually keep up with frontier models?",
      a: "On code grounded in your stack — yes, often better. We benchmark every customer's distilled model against the frontier model they were using before. If it doesn't beat baseline on your team's real prompts, we don't deploy it. For genuinely novel reasoning we still escalate to a frontier provider (about 7% of the time, in practice).",
    },
    {
      q: "What hardware do my engineers need?",
      a: "An M-series Mac with 16GB+ unified memory runs the standard distillation comfortably. Larger models on M3 Max / M4 Pro. Linux/CUDA workstations are supported in beta. We sized everything for laptops you already own.",
    },
    {
      q: "How is this different from running Llama or DeepSeek locally?",
      a: "Stock open models don't know your codebase. We distill them on your repos, internal docs, recent PRs, and team-specific patterns — and we keep tuning monthly. The result is a smaller model that beats a generic frontier model on your work specifically.",
    },
    {
      q: "What happens to our data during training?",
      a: "Training runs on a machine in your office or VPC that we configure. Data does not leave your perimeter. We can do everything air-gapped if your security team prefers. The only thing that lands on our infrastructure is invoice metadata.",
    },
    {
      q: "What if we cancel?",
      a: "You keep the weights. Forever. No DRM, no kill switch, no expiring license. The model you trained with us is yours. We just stop sending invoices.",
    },
    {
      q: "Who's behind this?",
      a: "Founders are ex-applied-research at frontier labs and ex-eng-leads at infra companies. We've shipped distillation and quantization in production at scale. Reach out if you want a long technical conversation — we like those.",
    },
  ];

  return (
    <section style={{ padding: "100px 56px", borderBottom: "1px solid var(--line)", background: "var(--bg-1)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 64, alignItems: "start" }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 24 }}>08 — FAQ</div>
          <h2 className="h-section">
            Questions.<br />
            <em>Honest answers.</em>
          </h2>
        </div>

        <div style={{ borderTop: "1px solid var(--line)" }}>
          {items.map((it, i) => (
            <div key={i} style={{ borderBottom: "1px solid var(--line)" }}>
              <button
                onClick={() => setOpen(open === i ? -1 : i)}
                style={{
                  width: "100%", padding: "24px 4px",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  textAlign: "left", color: "var(--ink)",
                }}
              >
                <span style={{ fontSize: 18, fontWeight: 500, letterSpacing: "-0.01em" }}>
                  <span style={{ fontFamily: "var(--mono)", color: "var(--ink-4)", fontSize: 12, marginRight: 16 }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {it.q}
                </span>
                <span style={{ color: open === i ? "var(--acid)" : "var(--ink-4)", fontSize: 24, lineHeight: 1, fontFamily: "var(--mono)" }}>
                  {open === i ? "−" : "+"}
                </span>
              </button>
              {open === i && (
                <div style={{ padding: "0 4px 28px 44px", color: "var(--ink-3)", fontSize: 15, lineHeight: 1.6, maxWidth: 720 }}>
                  {it.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

/* FOUNDER NOTE */
const FounderV1 = () => (
  <section style={{ padding: "120px 56px", borderBottom: "1px solid var(--line)" }}>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 2.2fr", gap: 80, alignItems: "start" }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 24 }}>09 — A NOTE FROM THE FOUNDERS</div>
        <div style={{
          width: 140, height: 140,
          background: "linear-gradient(135deg, #1a1a1a, #0a0a0a)",
          border: "1px solid var(--line-strong)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: "var(--serif)", fontSize: 56, color: "var(--acid)",
        }}>
          M·K
        </div>
        <div style={{ marginTop: 20, fontSize: 14 }}>
          <div style={{ fontWeight: 500 }}>Maya & Kostas</div>
          <div className="mono-sm" style={{ color: "var(--ink-4)", marginTop: 4 }}>FOUNDERS · LUME</div>
        </div>
      </div>

      <div>
        <p style={{
          fontFamily: "var(--serif)",
          fontSize: 32,
          lineHeight: 1.35,
          color: "var(--ink)",
          letterSpacing: "-0.015em",
          maxWidth: 820,
        }}>
          We've spent the last six years inside frontier labs and large infra teams.
          We watched companies pour tens of millions a year into AI bills — and ship
          their crown jewels through someone else's API to do it. <em style={{ color: "var(--acid)", fontStyle: "italic" }}>This isn't sustainable, and it isn't necessary.</em>
        </p>

        <p className="body-lg" style={{ marginTop: 32, maxWidth: 720 }}>
          Most of what your engineers ask an LLM is grounded in code that already
          exists in your repo. A small model that actually <em>knows</em> your code
          can answer those prompts faster, cheaper, and without the round-trip.
          Lume is the toolchain we wish existed when we were on the other side of
          this problem.
        </p>

        <p className="body-lg" style={{ marginTop: 24, maxWidth: 720 }}>
          We charge a percentage because we should only get paid when you save.
          If you'd like to talk — really talk, not "book a 15-min discovery call"
          — write us. We answer ourselves.
        </p>

        <div className="mono-sm" style={{ marginTop: 32, color: "var(--acid)", letterSpacing: "0.04em" }}>
          → MAYA@LUME.LOCAL · KOSTAS@LUME.LOCAL
        </div>
      </div>
    </div>
  </section>
);

/* FINAL CTA */
const FinalCTAV1 = () => (
  <section style={{
    padding: "140px 56px 120px",
    position: "relative",
    overflow: "hidden",
  }}>
    <div style={{
      position: "absolute", inset: 0,
      backgroundImage: "radial-gradient(circle at 50% 30%, rgba(212,255,58,0.08), transparent 60%)",
    }} />

    <div style={{ position: "relative", textAlign: "center", maxWidth: 980, margin: "0 auto" }}>
      <div className="eyebrow" style={{ marginBottom: 28, justifyContent: "center", display: "inline-flex" }}>
        10 — JOIN THE WAITLIST
      </div>
      <h2 style={{
        fontFamily: "var(--serif)", fontSize: 120, lineHeight: 0.95, letterSpacing: "-0.04em",
      }}>
        Stop paying<br />
        to <em style={{ color: "var(--acid)", fontStyle: "italic" }}>leak your code.</em>
      </h2>

      <p className="body-lg" style={{ marginTop: 36, maxWidth: 620, margin: "36px auto 0" }}>
        We're onboarding 20 engineering teams in Q2. Tell us about your stack
        and we'll send back a baseline savings estimate within 48 hours.
      </p>

      <form
        onSubmit={(e) => e.preventDefault()}
        style={{
          marginTop: 48,
          display: "flex", gap: 0, maxWidth: 540, margin: "48px auto 0",
          border: "1px solid var(--line-strong)",
          background: "var(--bg-1)",
        }}
      >
        <input
          placeholder="you@company.com"
          style={{
            flex: 1, background: "transparent", border: "none", outline: "none",
            padding: "18px 20px", color: "var(--ink)", fontSize: 15, fontFamily: "var(--sans)",
          }}
        />
        <button className="btn-acid" style={{ borderRadius: 0, padding: "0 28px", fontSize: 14 }}>
          Request estimate →
        </button>
      </form>

      <div className="mono-sm" style={{ marginTop: 20, color: "var(--ink-4)" }}>
        20 SLOTS · Q2 2026 · NO SPAM, EVER
      </div>
    </div>
  </section>
);

/* FULL ASSEMBLY */
const LandingV1 = () => (
  <div className="lp">
    <Nav />
    <HeroV1 />
    <ProblemV1 />
    <HowV1 />
    <CalculatorV1 />
    <PrivacyV1 />
    <ComparisonV1 />
    <PricingV1 />
    <FAQV1 />
    <FounderV1 />
    <FinalCTAV1 />
    <Footer />
  </div>
);

Object.assign(window, {
  PrivacyV1, NetworkDiagram, ComparisonV1, PricingV1, FAQV1, FounderV1, FinalCTAV1,
  LandingV1,
});
