/* global React */
const { useState, useEffect, useMemo } = React;

/* =========================================================
   SHARED ATOMS
   ========================================================= */

const Logo = ({ small }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
    <svg width={small ? 18 : 22} height={small ? 18 : 22} viewBox="0 0 24 24" fill="none">
      <rect x="2" y="2" width="20" height="20" stroke="#d4ff3a" strokeWidth="1.5" />
      <rect x="6" y="6" width="12" height="12" fill="#d4ff3a" />
      <rect x="9" y="9" width="6" height="6" fill="#0a0a0a" />
    </svg>
    <span style={{
      fontFamily: "var(--mono)",
      fontSize: small ? 12 : 14,
      letterSpacing: "0.02em",
      fontWeight: 500,
    }}>
      lume<span style={{ color: "var(--acid)" }}>/</span>local
    </span>
  </div>
);

const Nav = () => (
  <nav style={{
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "20px 56px",
    borderBottom: "1px solid var(--line)",
  }}>
    <Logo />
    <div style={{ display: "flex", gap: 32, fontSize: 13, color: "var(--ink-3)" }}>
      <a>How it works</a>
      <a>Privacy</a>
      <a>Pricing</a>
      <a>FAQ</a>
    </div>
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <span className="mono-sm" style={{ color: "var(--ink-4)" }}>v0.1 · private beta</span>
      <button className="btn-acid" data-waitlist style={{ padding: "10px 16px", fontSize: 13 }}>
        Join waitlist →
      </button>
    </div>
  </nav>
);

const Footer = () => (
  <footer style={{
    padding: "40px 56px 56px",
    borderTop: "1px solid var(--line)",
    display: "flex", justifyContent: "space-between", alignItems: "flex-end",
    color: "var(--ink-4)", fontFamily: "var(--mono)", fontSize: 11,
    letterSpacing: "0.04em",
  }}>
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Logo small />
      <div>© 2026 lume systems · runs on your machine, not ours</div>
    </div>
    <div style={{ display: "flex", gap: 40 }}>
      <span>SOC 2 IN PROGRESS</span>
      <span>SF · BERLIN</span>
      <span>HELLO@LUME.LOCAL</span>
    </div>
  </footer>
);

/* =========================================================
   V1 — SOBER DEVTOOL, CODE/TERMINAL FORWARD
   "the model that lives in your IDE"
   ========================================================= */

const HeroV1 = () => (
  <section style={{ padding: "80px 56px 100px", borderBottom: "1px solid var(--line)", position: "relative" }}>
    {/* corner crosshairs */}
    <div style={{ position: "absolute", top: 24, right: 56, fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-4)", letterSpacing: "0.1em" }}>
      [ 01 / HERO ]
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 64, alignItems: "start" }}>
      <div>
        <div className="chip" style={{ marginBottom: 28 }}>
          <span className="dot" />
          NOW SHIPPING TO CURSOR · CODEX · ANTIGRAVITY
        </div>

        <h1 className="h-display">
          A coding model<br />
          that <em>lives</em> on<br />
          your laptop.
        </h1>

        <p className="body-lg" style={{ marginTop: 32, maxWidth: 520 }}>
          We distill a private model from your codebase, your docs, and your team's
          patterns. It runs locally inside Cursor, Codex and Antigravity — so your
          source never leaves the machine, and your token bill stops climbing.
        </p>

        <div style={{ display: "flex", gap: 12, marginTop: 40 }}>
          <button className="btn-acid" data-waitlist>Join the waitlist →</button>
          <button className="btn-ghost">See how it works</button>
        </div>

        <div style={{ marginTop: 56, display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 0, borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
          {[
            ["62%", "avg token bill cut", "after 2 weeks"],
            ["0", "bytes leave your laptop", "by design"],
            ["10%", "of what you save", "is all we charge"],
          ].map(([n, l, s], i) => (
            <div key={i} style={{
              padding: "24px 20px",
              borderRight: i < 2 ? "1px solid var(--line)" : "none",
            }}>
              <div className="bignum" style={{ fontSize: 56 }}>{n}</div>
              <div style={{ marginTop: 10, fontSize: 13, color: "var(--ink-2)", fontWeight: 500 }}>{l}</div>
              <div className="mono-sm" style={{ marginTop: 4, color: "var(--ink-4)", fontSize: 11 }}>{s}</div>
            </div>
          ))}
        </div>
      </div>

      {/* terminal */}
      <TerminalCard />
    </div>
  </section>
);

const TerminalCard = () => {
  const lines = [
    { t: "$ lume init --ide cursor", k: "cmd" },
    { t: "→ scanning workspace ………………………… 2,341 files", k: "out" },
    { t: "→ ingesting /docs/internal …………… 184 markdown", k: "out" },
    { t: "→ training local adapter (rank=32)", k: "out" },
    { t: "→ deploying to ~/.cursor/models/lume", k: "out" },
    { t: "", k: "spacer" },
    { t: "✓ ready. cursor is now using lume.", k: "ok" },
    { t: "", k: "spacer" },
    { t: "$ lume stats --since 7d", k: "cmd" },
    { t: "  prompts handled .................. 4,182", k: "stat" },
    { t: "  routed to local model ............. 3,891  (93%)", k: "stat" },
    { t: "  routed to anthropic/openai ........... 291  ( 7%)", k: "stat" },
    { t: "  tokens saved ............... 18.4M  ($212.30)", k: "stat-good" },
    { t: "  privacy violations .................. 0", k: "stat-good" },
  ];

  const colorOf = (k) => {
    if (k === "cmd") return "var(--ink)";
    if (k === "ok") return "var(--acid)";
    if (k === "stat-good") return "var(--good)";
    return "var(--ink-3)";
  };

  return (
    <div style={{
      background: "var(--bg-1)",
      border: "1px solid var(--line-strong)",
      borderRadius: 4,
      overflow: "hidden",
      boxShadow: "0 0 0 1px var(--bg), 0 40px 80px rgba(0,0,0,0.4)",
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 16px",
        borderBottom: "1px solid var(--line)",
        background: "var(--bg-2)",
      }}>
        <div style={{ display: "flex", gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#3a3a3a" }} />
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#3a3a3a" }} />
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--acid)" }} />
        </div>
        <span className="mono-sm" style={{ color: "var(--ink-4)" }}>~/projects/acme — lume</span>
        <span className="mono-sm" style={{ color: "var(--ink-4)" }}>120×32</span>
      </div>
      <div style={{ padding: "20px 22px", fontFamily: "var(--mono)", fontSize: 12.5, lineHeight: 1.65 }}>
        {lines.map((l, i) => (
          <div key={i} style={{ color: colorOf(l.k), minHeight: l.k === "spacer" ? 8 : "auto" }}>
            {l.t || "\u00A0"}
          </div>
        ))}
        <div style={{ color: "var(--ink)", marginTop: 8 }}>
          $ <span style={{ display: "inline-block", width: 8, height: 14, background: "var(--acid)", verticalAlign: "middle", marginLeft: 2 }} />
        </div>
      </div>
    </div>
  );
};

/* PROBLEM */
const ProblemV1 = () => (
  <section style={{ padding: "100px 56px", borderBottom: "1px solid var(--line)" }}>
    <div className="eyebrow" style={{ marginBottom: 24 }}>02 — THE PROBLEM</div>
    <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 80, alignItems: "start" }}>
      <h2 className="h-section">
        Generic frontier models are<br />
        <em>expensive strangers</em><br />
        reading your private code.
      </h2>
      <p className="body-lg">
        Every autocomplete sends your proprietary code to a third party. Every
        prompt burns tokens on context the model has already forgotten. You're
        paying frontier prices for a model that doesn't know your stack — and
        leaking IP to do it.
      </p>
    </div>

    <div style={{ marginTop: 64, display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 0, border: "1px solid var(--line)" }}>
      {[
        {
          n: "01",
          t: "Your code becomes training data.",
          d: "Even with zero-retention promises, you're trusting a vendor's policy. One config flip, one breach, and your moat is in someone else's weights.",
        },
        {
          n: "02",
          t: "You pay for amnesia.",
          d: "Every session re-sends the same context. A 2M-token codebase costs you 2M tokens, every conversation, in perpetuity.",
        },
        {
          n: "03",
          t: "It still doesn't know your stack.",
          d: "Frontier models are great at React tutorials. They're mediocre at your weird internal monorepo with the custom RPC layer no one outside your team has ever seen.",
        },
      ].map((c, i) => (
        <div key={i} style={{
          padding: "36px 32px",
          borderRight: i < 2 ? "1px solid var(--line)" : "none",
          background: i === 1 ? "var(--bg-1)" : "transparent",
        }}>
          <div className="mono-sm" style={{ color: "var(--warn)", marginBottom: 20 }}>PROBLEM {c.n}</div>
          <div className="h-card" style={{ marginBottom: 16 }}>{c.t}</div>
          <div className="body" style={{ fontSize: 14 }}>{c.d}</div>
        </div>
      ))}
    </div>
  </section>
);

/* HOW IT WORKS */
const HowV1 = () => (
  <section style={{ padding: "100px 56px", borderBottom: "1px solid var(--line)" }}>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 64, marginBottom: 72 }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 24 }}>03 — HOW IT WORKS</div>
        <h2 className="h-section">Three steps.<br /><em>Two weeks.</em></h2>
      </div>
      <p className="body-lg" style={{ alignSelf: "end", maxWidth: 520 }}>
        We don't sell you a model and disappear. We embed with your team,
        distill what your engineers actually do, and keep tuning until the
        local model handles 90%+ of your day-to-day.
      </p>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 24 }}>
      {[
        {
          n: "01",
          title: "You give us access.",
          sub: "Code, docs, time.",
          body: "We come on-site (or VPN) and ingest your repos, RFCs, internal wikis, and recent PRs. Nothing copies off your infrastructure. We sign whatever NDA you want.",
          tag: "DAY 1–3",
        },
        {
          n: "02",
          title: "We train your model.",
          sub: "Distilled, quantized, yours.",
          body: "We start from a strong open base, distill it on your patterns, and quantize until it fits comfortably on an M-series Mac. We benchmark it against the model you're currently paying for.",
          tag: "DAY 4–10",
        },
        {
          n: "03",
          title: "You save.",
          sub: "Plugged into your IDE.",
          body: "Lume installs as a local provider in Cursor, Codex, and Antigravity. Hard prompts still escalate to frontier models — everything else stays on the laptop. You watch the bill drop.",
          tag: "DAY 11+",
        },
      ].map((s, i) => (
        <div key={i} style={{
          background: "var(--bg-1)",
          border: "1px solid var(--line)",
          padding: "32px 28px 36px",
          position: "relative",
          minHeight: 320,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 32 }}>
            <span style={{ fontFamily: "var(--serif)", fontSize: 64, lineHeight: 1, color: "var(--acid)" }}>
              {s.n}
            </span>
            <span className="mono-sm" style={{ color: "var(--ink-4)", fontSize: 10 }}>{s.tag}</span>
          </div>
          <div className="h-card" style={{ marginBottom: 6 }}>{s.title}</div>
          <div className="mono-sm" style={{ color: "var(--ink-4)", marginBottom: 18 }}>{s.sub}</div>
          <div className="body" style={{ fontSize: 14 }}>{s.body}</div>
        </div>
      ))}
    </div>
  </section>
);

/* CALCULATOR */
const CalculatorV1 = () => {
  const [seats, setSeats] = useState(25);
  const [spend, setSpend] = useState(180);

  const monthly = seats * spend;
  const saved = Math.round(monthly * 0.62);
  const ourCut = Math.round(saved * 0.1);
  const youKeep = saved - ourCut;
  const annual = youKeep * 12;

  return (
    <section style={{ padding: "100px 56px", borderBottom: "1px solid var(--line)" }}>
      <div className="eyebrow" style={{ marginBottom: 24 }}>04 — LIVE SAVINGS CALCULATOR</div>
      <h2 className="h-section" style={{ marginBottom: 56, maxWidth: 900 }}>
        See what your team would <em>have already saved</em> if you'd<br />
        installed lume last quarter.
      </h2>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 32, alignItems: "stretch" }}>
        {/* Inputs */}
        <div style={{
          background: "var(--bg-1)",
          border: "1px solid var(--line)",
          padding: "36px 36px 32px",
        }}>
          <div className="mono-sm" style={{ color: "var(--ink-4)", marginBottom: 24 }}>INPUTS</div>

          <CalcSlider
            label="Engineers using AI tools"
            value={seats}
            min={5}
            max={500}
            step={5}
            unit="seats"
            onChange={setSeats}
          />
          <CalcSlider
            label="Avg. monthly AI spend per seat"
            value={spend}
            min={50}
            max={800}
            step={10}
            unit="$/mo"
            onChange={setSpend}
          />

          <div style={{ marginTop: 32, paddingTop: 24, borderTop: "1px solid var(--line)" }}>
            <div className="mono-sm" style={{ marginBottom: 8 }}>YOU'RE CURRENTLY SPENDING</div>
            <div style={{ fontFamily: "var(--serif)", fontSize: 48, letterSpacing: "-0.03em" }}>
              ${monthly.toLocaleString()}<span style={{ fontSize: 18, color: "var(--ink-4)", fontFamily: "var(--mono)" }}> / mo</span>
            </div>
          </div>
        </div>

        {/* Output */}
        <div style={{
          background: "linear-gradient(180deg, #0f0f0f, #0a0a0a)",
          border: "1px solid var(--acid)",
          padding: "36px 40px",
          position: "relative",
          overflow: "hidden",
        }}>
          <div style={{
            position: "absolute", top: -100, right: -100,
            width: 300, height: 300, borderRadius: "50%",
            background: "var(--acid-glow)",
            filter: "blur(60px)",
          }} />

          <div style={{ position: "relative", display: "flex", justifyContent: "space-between", marginBottom: 28 }}>
            <span className="mono-sm" style={{ color: "var(--acid)" }}>WITH LUME</span>
            <span className="mono-sm" style={{ color: "var(--ink-4)" }}>~62% of prompts handled locally</span>
          </div>

          <div style={{ position: "relative" }}>
            <div className="mono-sm" style={{ marginBottom: 6, color: "var(--ink-3)" }}>YOU KEEP</div>
            <div className="bignum" style={{ color: "var(--acid)" }}>
              ${youKeep.toLocaleString()}<span style={{ fontSize: 28, color: "var(--ink-3)" }}> /mo</span>
            </div>
          </div>

          <div style={{ marginTop: 32, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, borderTop: "1px solid var(--line)" }}>
            <div style={{ padding: "20px 0", borderRight: "1px solid var(--line)" }}>
              <div className="mono-sm" style={{ color: "var(--ink-4)", marginBottom: 6 }}>OUR CUT (10%)</div>
              <div style={{ fontFamily: "var(--serif)", fontSize: 32 }}>${ourCut.toLocaleString()}<span style={{ fontSize: 14, color: "var(--ink-4)", fontFamily: "var(--mono)" }}>/mo</span></div>
            </div>
            <div style={{ padding: "20px 0 20px 24px" }}>
              <div className="mono-sm" style={{ color: "var(--ink-4)", marginBottom: 6 }}>FIRST YEAR</div>
              <div style={{ fontFamily: "var(--serif)", fontSize: 32, color: "var(--acid)" }}>${annual.toLocaleString()}</div>
            </div>
          </div>

          <div className="body" style={{ marginTop: 28, fontSize: 13, color: "var(--ink-4)", position: "relative" }}>
            Estimates based on early-pilot averages. We only invoice on
            verified savings — measured against your prior 30-day baseline.
          </div>
        </div>
      </div>
    </section>
  );
};

const CalcSlider = ({ label, value, min, max, step, unit, onChange }) => (
  <div style={{ marginBottom: 28 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
      <span style={{ fontSize: 13, color: "var(--ink-2)" }}>{label}</span>
      <span style={{ fontFamily: "var(--mono)", fontSize: 14, color: "var(--acid)" }}>
        {value.toLocaleString()} <span style={{ color: "var(--ink-4)" }}>{unit}</span>
      </span>
    </div>
    <input
      type="range"
      min={min} max={max} step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{
        width: "100%",
        accentColor: "#d4ff3a",
        height: 4,
      }}
    />
  </div>
);

Object.assign(window, {
  Logo, Nav, Footer,
  HeroV1, ProblemV1, HowV1, CalculatorV1, CalcSlider, TerminalCard,
});
