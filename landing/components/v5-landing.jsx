/* global React */
const { useState: useStateV5 } = React;

/* =========================================================
   V5 — MINIMAL / SWISS / GRID
   No serifs in headlines (use Inter Tight tight), heavy
   numerical grid, all-caps everywhere, monospace pairings.
   Cool, technical, maximally restrained.
   ========================================================= */

const NavV5 = () => (
  <nav style={{
    display: "grid", gridTemplateColumns: "repeat(12, 1fr)",
    padding: "24px 56px", borderBottom: "1px solid var(--line)",
    alignItems: "center",
  }}>
    <div style={{ gridColumn: "1 / span 3" }}><Logo /></div>
    <div style={{ gridColumn: "4 / span 6", display: "flex", justifyContent: "center", gap: 32, fontFamily: "var(--mono)", fontSize: 11, letterSpacing: "0.16em", color: "var(--ink-3)" }}>
      <a>01 ▸ METHOD</a>
      <a>02 ▸ PRIVACY</a>
      <a>03 ▸ PRICE</a>
      <a>04 ▸ FAQ</a>
    </div>
    <div style={{ gridColumn: "10 / span 3", display: "flex", justifyContent: "flex-end" }}>
      <button className="btn-acid" data-waitlist style={{ padding: "10px 16px", fontSize: 12, fontFamily: "var(--mono)", letterSpacing: "0.08em" }}>
        WAITLIST →
      </button>
    </div>
  </nav>
);

const HeroV5 = () => (
  <section style={{ padding: "80px 56px 100px", borderBottom: "1px solid var(--line)" }}>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 24 }}>
      <div style={{ gridColumn: "1 / span 2" }}>
        <div className="mono-sm" style={{ color: "var(--ink-4)", letterSpacing: "0.16em" }}>
          §00<br/>INTRO
        </div>
      </div>

      <div style={{ gridColumn: "3 / span 10" }}>
        <div className="mono-sm" style={{ color: "var(--acid)", letterSpacing: "0.18em", marginBottom: 32 }}>
          A LOCAL CODING MODEL · DISTILLED TO YOUR STACK · BILLED ON SAVINGS
        </div>

        <h1 style={{
          fontFamily: "var(--sans)",
          fontSize: 132,
          fontWeight: 600,
          lineHeight: 0.94,
          letterSpacing: "-0.05em",
          color: "var(--ink)",
        }}>
          Save<br/>
          tokens.<br/>
          Save<br/>
          <span style={{ color: "var(--acid)" }}>privacy.</span><br/>
          Save<br/>
          money.
        </h1>
      </div>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 24, marginTop: 64 }}>
      <div style={{ gridColumn: "3 / span 6" }}>
        <p className="body-lg" style={{ fontSize: 19 }}>
          You give us your code, your documentation, and a few weeks of your team's time.
          We give you a private model — distilled to your stack — that runs locally inside
          Cursor, Codex, and Antigravity. No hidden fees. Just 10% of what we save you.
        </p>
        <div style={{ marginTop: 32, display: "flex", gap: 12 }}>
          <button className="btn-acid" data-waitlist>Join waitlist →</button>
          <button className="btn-ghost">View documentation</button>
        </div>
      </div>

      <div style={{ gridColumn: "10 / span 3" }}>
        <div className="mono-sm" style={{ color: "var(--ink-4)", letterSpacing: "0.14em", marginBottom: 16 }}>
          STATUS
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, fontFamily: "var(--mono)", fontSize: 12, color: "var(--ink-3)" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>● BETA</span><span>OPEN</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>● SLOTS</span><span>20 / Q2</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>● VERSION</span><span>v0.1</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", color: "var(--acid)" }}>
            <span>● UPTIME</span><span>LOCAL · 100%</span>
          </div>
        </div>
      </div>
    </div>

    {/* Big numerical grid — 4 columns */}
    <div style={{ marginTop: 80, borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)" }}>
        {[
          ["01", "BILL CUT", "60–70%"],
          ["02", "LOCAL ROUTING", "≈93%"],
          ["03", "DATA EGRESS", "0 b"],
          ["04", "OUR FEE", "10%"],
        ].map(([n, l, v], i) => (
          <div key={i} style={{
            padding: "32px 28px",
            borderRight: i < 3 ? "1px solid var(--line)" : "none",
            display: "flex", flexDirection: "column", justifyContent: "space-between",
            minHeight: 200,
          }}>
            <div className="mono-sm" style={{ color: "var(--ink-4)", display: "flex", justifyContent: "space-between" }}>
              <span>[{n}]</span>
              <span>{l}</span>
            </div>
            <div style={{
              fontFamily: "var(--sans)",
              fontSize: 80, fontWeight: 600, lineHeight: 1,
              letterSpacing: "-0.05em",
              color: i === 3 ? "var(--acid)" : "var(--ink)",
              marginTop: 24,
            }}>
              {v}
            </div>
          </div>
        ))}
      </div>
    </div>
  </section>
);

/* PROBLEM V5 — three columns, sober, no decorations */
const ProblemV5 = () => (
  <section style={{ padding: "120px 56px", borderBottom: "1px solid var(--line)" }}>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 24, marginBottom: 64 }}>
      <div style={{ gridColumn: "1 / span 2" }}>
        <div className="mono-sm" style={{ color: "var(--ink-4)", letterSpacing: "0.16em" }}>§02<br/>PROBLEM</div>
      </div>
      <div style={{ gridColumn: "3 / span 8" }}>
        <h2 style={{
          fontFamily: "var(--sans)",
          fontSize: 64, fontWeight: 500, lineHeight: 1.0,
          letterSpacing: "-0.04em",
        }}>
          Generic frontier models are <span style={{ color: "var(--acid)" }}>expensive strangers</span> reading your private code.
        </h2>
      </div>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 24 }}>
      <div style={{ gridColumn: "3 / span 10" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 0, borderTop: "1px solid var(--line)" }}>
          {[
            { n: "01.", t: "Your code becomes training data.", b: "Even with zero-retention promises, you're trusting a vendor's policy. One config flip and your moat is in someone else's weights." },
            { n: "02.", t: "You pay for amnesia.", b: "Every session re-sends the same context. A 2M-token codebase costs you 2M tokens, every conversation, in perpetuity." },
            { n: "03.", t: "It still doesn't know your stack.", b: "Frontier models are great at React tutorials. They're mediocre at your weird internal monorepo with the custom RPC layer no one outside your team has ever seen." },
          ].map((c, i) => (
            <div key={i} style={{
              padding: "32px 24px 0",
              borderRight: i < 2 ? "1px solid var(--line)" : "none",
            }}>
              <div className="mono-sm" style={{ color: "var(--acid)", marginBottom: 24 }}>{c.n}</div>
              <div style={{ fontFamily: "var(--sans)", fontSize: 22, fontWeight: 500, letterSpacing: "-0.02em", marginBottom: 16, lineHeight: 1.2 }}>
                {c.t}
              </div>
              <div className="body" style={{ fontSize: 14 }}>{c.b}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </section>
);

/* HOW V5 — three steps as a strict 12-col grid */
const HowV5 = () => (
  <section style={{ padding: "120px 56px", borderBottom: "1px solid var(--line)" }}>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 24, marginBottom: 64 }}>
      <div style={{ gridColumn: "1 / span 2" }}>
        <div className="mono-sm" style={{ color: "var(--ink-4)", letterSpacing: "0.16em" }}>§03<br/>METHOD</div>
      </div>
      <div style={{ gridColumn: "3 / span 8" }}>
        <h2 style={{
          fontFamily: "var(--sans)", fontSize: 64, fontWeight: 500, lineHeight: 1.0, letterSpacing: "-0.04em",
        }}>
          Three steps. <span style={{ color: "var(--acid)" }}>Two weeks.</span>
        </h2>
      </div>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 0, border: "1px solid var(--line)" }}>
      {[
        { n: "01", title: "You give.", tag: "DAY 1–3", body: "We come on-site (or VPN) and ingest your repos, RFCs, internal wikis, and recent PRs. Nothing copies off your infrastructure. We sign whatever NDA you want." },
        { n: "02", title: "We train.", tag: "DAY 4–10", body: "We start from a strong open base, distill it on your patterns, and quantize until it fits comfortably on an M-series Mac. We benchmark against the model you're currently paying for." },
        { n: "03", title: "You save.", tag: "DAY 11+", body: "Lume installs as a local provider in Cursor, Codex, and Antigravity. Hard prompts still escalate to frontier models — everything else stays on the laptop. You watch the bill drop." },
      ].map((s, i) => (
        <div key={i} style={{
          padding: "40px 32px",
          borderRight: i < 2 ? "1px solid var(--line)" : "none",
          minHeight: 320, display: "flex", flexDirection: "column", justifyContent: "space-between",
        }}>
          <div>
            <div className="mono-sm" style={{ color: "var(--ink-4)", display: "flex", justifyContent: "space-between", marginBottom: 32 }}>
              <span>[{s.n}]</span><span>{s.tag}</span>
            </div>
            <div style={{
              fontFamily: "var(--sans)", fontSize: 56, fontWeight: 500, lineHeight: 1, letterSpacing: "-0.04em",
              color: "var(--acid)",
            }}>
              {s.title}
            </div>
          </div>
          <div className="body" style={{ fontSize: 14, marginTop: 32 }}>{s.body}</div>
        </div>
      ))}
    </div>
  </section>
);

/* CALCULATOR V5 — minimal */
const CalculatorV5 = () => {
  const [seats, setSeats] = useStateV5(25);
  const [spend, setSpend] = useStateV5(180);
  const monthly = seats * spend;
  const saved = Math.round(monthly * 0.62);
  const ourCut = Math.round(saved * 0.1);
  const youKeep = saved - ourCut;

  return (
    <section style={{ padding: "120px 56px", borderBottom: "1px solid var(--line)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 24, marginBottom: 56 }}>
        <div style={{ gridColumn: "1 / span 2" }}>
          <div className="mono-sm" style={{ color: "var(--ink-4)", letterSpacing: "0.16em" }}>§04<br/>CALC</div>
        </div>
        <div style={{ gridColumn: "3 / span 8" }}>
          <h2 style={{ fontFamily: "var(--sans)", fontSize: 64, fontWeight: 500, lineHeight: 1.0, letterSpacing: "-0.04em" }}>
            Do the arithmetic.
          </h2>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 24 }}>
        <div style={{ gridColumn: "3 / span 4", borderRight: "1px solid var(--line)", paddingRight: 32 }}>
          <CalcSlider label="Engineers" value={seats} min={5} max={500} step={5} unit="seats" onChange={setSeats} />
          <CalcSlider label="Monthly AI spend per seat" value={spend} min={50} max={800} step={10} unit="$/mo" onChange={setSpend} />

          <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
            <div className="mono-sm" style={{ color: "var(--ink-4)" }}>YOU SPEND TODAY</div>
            <div style={{ fontFamily: "var(--sans)", fontSize: 40, fontWeight: 500, letterSpacing: "-0.03em", marginTop: 6 }}>
              ${monthly.toLocaleString()}<span style={{ fontSize: 14, fontFamily: "var(--mono)", color: "var(--ink-4)" }}>/mo</span>
            </div>
          </div>
        </div>

        <div style={{ gridColumn: "7 / span 6", paddingLeft: 32 }}>
          <div className="mono-sm" style={{ color: "var(--acid)", marginBottom: 16 }}>YOU KEEP, EVERY MONTH</div>
          <div style={{
            fontFamily: "var(--sans)", fontSize: 168, fontWeight: 500,
            lineHeight: 0.92, letterSpacing: "-0.05em",
            color: "var(--acid)",
          }}>
            ${youKeep.toLocaleString()}
          </div>

          <div style={{ marginTop: 32, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 0, borderTop: "1px solid var(--line)" }}>
            {[
              ["WAS", `$${monthly.toLocaleString()}`],
              ["NOW", `$${(monthly - saved).toLocaleString()}`],
              ["OUR FEE", `$${ourCut.toLocaleString()}`],
            ].map(([l, v], i) => (
              <div key={i} style={{ padding: "20px 16px 0 0", borderRight: i < 2 ? "1px solid var(--line)" : "none", paddingLeft: i > 0 ? 16 : 0 }}>
                <div className="mono-sm" style={{ color: "var(--ink-4)" }}>{l}</div>
                <div style={{ fontFamily: "var(--sans)", fontSize: 28, fontWeight: 500, letterSpacing: "-0.02em", marginTop: 6 }}>{v}</div>
              </div>
            ))}
          </div>
          <div className="body" style={{ marginTop: 20, fontSize: 12 }}>
            Estimated against your existing 30-day baseline. We invoice only on verified savings.
          </div>
        </div>
      </div>
    </section>
  );
};

/* PRIVACY V5 */
const PrivacyV5 = () => (
  <section style={{ padding: "120px 56px", borderBottom: "1px solid var(--line)", background: "var(--bg-1)" }}>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 24, marginBottom: 56 }}>
      <div style={{ gridColumn: "1 / span 2" }}>
        <div className="mono-sm" style={{ color: "var(--ink-4)", letterSpacing: "0.16em" }}>§05<br/>PRIVACY</div>
      </div>
      <div style={{ gridColumn: "3 / span 9" }}>
        <h2 style={{ fontFamily: "var(--sans)", fontSize: 84, fontWeight: 500, lineHeight: 0.96, letterSpacing: "-0.045em" }}>
          The packets <span style={{ color: "var(--acid)" }}>don't leave</span><br/>
          your laptop.
        </h2>
      </div>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 24 }}>
      <div style={{ gridColumn: "3 / span 5" }}>
        <p className="body-lg">
          Lume's weights live in <span style={{ fontFamily: "var(--mono)", color: "var(--acid)" }}>~/.lume/models/</span>.
          Inference happens on your hardware. The router classifies each prompt locally and only escalates the
          genuinely hard ones — and only with your explicit, per-prompt consent.
        </p>
      </div>
      <div style={{ gridColumn: "9 / span 4" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 0, border: "1px solid var(--line)" }}>
          {["AIR-GAPPED INFERENCE", "AUDITABLE ROUTING", "BYO ESCALATION KEYS", "SOC 2 IN PROGRESS", "OPEN-WEIGHT BASE", "ZERO TELEMETRY"].map((t, i) => (
            <div key={t} style={{
              padding: "14px 16px",
              borderTop: i > 0 ? "1px solid var(--line)" : "none",
              fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-2)",
              display: "flex", justifyContent: "space-between",
            }}>
              <span>{t}</span>
              <span style={{ color: "var(--acid)" }}>✓</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  </section>
);

/* COMPARISON V5 — minimal table */
const ComparisonV5 = () => {
  const rows = [
    ["Where your code lives", "Their datacenters", "Their datacenters", "Your laptop"],
    ["Trained on your stack", "No", "No", "Yes"],
    ["Marginal cost / prompt", "$$ per call", "$$ per call", "≈ free"],
    ["Works offline", "No", "No", "Yes"],
    ["If you cancel", "Nothing", "Nothing", "You keep the weights"],
    ["Pricing", "Per-token", "Per-token", "10% of savings"],
  ];
  return (
    <section style={{ padding: "120px 56px", borderBottom: "1px solid var(--line)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 24, marginBottom: 56 }}>
        <div style={{ gridColumn: "1 / span 2" }}>
          <div className="mono-sm" style={{ color: "var(--ink-4)", letterSpacing: "0.16em" }}>§06<br/>VERSUS</div>
        </div>
        <div style={{ gridColumn: "3 / span 9" }}>
          <h2 style={{ fontFamily: "var(--sans)", fontSize: 64, fontWeight: 500, lineHeight: 1.0, letterSpacing: "-0.04em" }}>
            Not competing with GPT-5.<br/>
            <span style={{ color: "var(--acid)" }}>Competing with paying for it.</span>
          </h2>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 24 }}>
        <div style={{ gridColumn: "3 / span 10", border: "1px solid var(--line)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", borderBottom: "1px solid var(--line)" }}>
            <div className="mono-sm" style={{ padding: "16px 20px" }}>FEATURE</div>
            <div className="mono-sm" style={{ padding: "16px 20px", borderLeft: "1px solid var(--line)" }}>OPENAI</div>
            <div className="mono-sm" style={{ padding: "16px 20px", borderLeft: "1px solid var(--line)" }}>ANTHROPIC</div>
            <div className="mono-sm" style={{ padding: "16px 20px", borderLeft: "1px solid var(--acid)", color: "var(--acid)" }}>LUME</div>
          </div>
          {rows.map((r, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", borderBottom: i < rows.length - 1 ? "1px solid var(--line)" : "none" }}>
              <div style={{ padding: "18px 20px", color: "var(--ink-2)", fontSize: 14 }}>{r[0]}</div>
              <div style={{ padding: "18px 20px", borderLeft: "1px solid var(--line)", color: "var(--ink-4)", fontSize: 13, fontFamily: "var(--mono)" }}>{r[1]}</div>
              <div style={{ padding: "18px 20px", borderLeft: "1px solid var(--line)", color: "var(--ink-4)", fontSize: 13, fontFamily: "var(--mono)" }}>{r[2]}</div>
              <div style={{ padding: "18px 20px", borderLeft: "1px solid var(--acid)", color: "var(--acid)", fontSize: 13, fontFamily: "var(--mono)" }}>{r[3]}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

/* PRICING V5 — single huge number, sans */
const PricingV5 = () => (
  <section style={{ padding: "120px 56px", borderBottom: "1px solid var(--line)", background: "var(--bg-1)" }}>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 24, alignItems: "center" }}>
      <div style={{ gridColumn: "1 / span 2" }}>
        <div className="mono-sm" style={{ color: "var(--ink-4)", letterSpacing: "0.16em" }}>§07<br/>PRICE</div>
      </div>
      <div style={{ gridColumn: "3 / span 5" }}>
        <h2 style={{ fontFamily: "var(--sans)", fontSize: 56, fontWeight: 500, lineHeight: 1.05, letterSpacing: "-0.035em" }}>
          Pay <span style={{ color: "var(--acid)" }}>nothing</span> until we save you something.
        </h2>
        <p className="body-lg" style={{ marginTop: 28, maxWidth: 480 }}>
          We measure your AI bill the month before you install Lume. Every month after,
          you pay 10% of the difference. If we don't beat baseline, the invoice is $0.
        </p>
        <div style={{ marginTop: 28, display: "flex", gap: 24, fontSize: 13, color: "var(--ink-3)" }}>
          <span>· No setup fee</span>
          <span>· No seat license</span>
          <span>· No lock-in</span>
        </div>
      </div>
      <div style={{ gridColumn: "9 / span 4", display: "flex", alignItems: "baseline", justifyContent: "center" }}>
        <span style={{ fontFamily: "var(--sans)", fontSize: 320, fontWeight: 500, lineHeight: 0.85, letterSpacing: "-0.06em" }}>10</span>
        <span style={{ fontFamily: "var(--sans)", fontSize: 160, fontWeight: 500, lineHeight: 0.85, color: "var(--acid)" }}>%</span>
      </div>
    </div>
  </section>
);

/* FAQ V5 */
const FAQV5 = () => {
  const [open, setOpen] = useStateV5(0);
  const items = [
    ["Does the local model keep up?", "On code grounded in your stack — yes, often better. We benchmark against your existing frontier model. If we don't beat baseline, we don't deploy."],
    ["What hardware does my team need?", "An M-series Mac with 16GB+ unified memory. Larger distillations on M3 Max / M4 Pro. Linux/CUDA workstations are in beta."],
    ["How is this different from running Llama locally?", "Stock open models don't know your code. We distill them on your repos, RFCs, and recent PRs, and keep tuning monthly."],
    ["What happens during training?", "Training runs on hardware in your office or VPC. Data does not leave your perimeter."],
    ["What if we cancel?", "You keep the weights. No DRM, no expiry. The model is yours."],
  ];
  return (
    <section style={{ padding: "120px 56px", borderBottom: "1px solid var(--line)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 24 }}>
        <div style={{ gridColumn: "1 / span 2" }}>
          <div className="mono-sm" style={{ color: "var(--ink-4)", letterSpacing: "0.16em" }}>§08<br/>FAQ</div>
        </div>
        <div style={{ gridColumn: "3 / span 9" }}>
          <h2 style={{ fontFamily: "var(--sans)", fontSize: 56, fontWeight: 500, lineHeight: 1.05, letterSpacing: "-0.035em", marginBottom: 40 }}>
            Reasonable questions.
          </h2>
          {items.map((it, i) => (
            <div key={i} style={{ borderTop: i === 0 ? "1px solid var(--line)" : "none", borderBottom: "1px solid var(--line)" }}>
              <button onClick={() => setOpen(open === i ? -1 : i)} style={{ width: "100%", padding: "24px 0", display: "flex", justifyContent: "space-between", alignItems: "baseline", textAlign: "left", color: "var(--ink)" }}>
                <span style={{ fontFamily: "var(--sans)", fontSize: 22, fontWeight: 500, letterSpacing: "-0.02em" }}>
                  <span style={{ fontFamily: "var(--mono)", color: "var(--ink-4)", fontSize: 12, marginRight: 24, fontWeight: 400 }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {it[0]}
                </span>
                <span style={{ color: open === i ? "var(--acid)" : "var(--ink-4)", fontSize: 24, fontFamily: "var(--mono)" }}>
                  {open === i ? "−" : "+"}
                </span>
              </button>
              {open === i && (
                <div style={{ paddingBottom: 28, paddingLeft: 56, color: "var(--ink-3)", fontSize: 15, lineHeight: 1.6, maxWidth: 800 }}>
                  {it[1]}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

/* FOUNDER V5 */
const FounderV5 = () => (
  <section style={{ padding: "120px 56px", borderBottom: "1px solid var(--line)" }}>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 24 }}>
      <div style={{ gridColumn: "1 / span 2" }}>
        <div className="mono-sm" style={{ color: "var(--ink-4)", letterSpacing: "0.16em" }}>§09<br/>NOTE</div>
      </div>
      <div style={{ gridColumn: "3 / span 8" }}>
        <p style={{ fontFamily: "var(--sans)", fontSize: 32, fontWeight: 400, lineHeight: 1.4, letterSpacing: "-0.015em", color: "var(--ink)" }}>
          We've watched companies pour millions a year into AI bills, shipping their crown jewels through someone else's API to do it. <span style={{ color: "var(--acid)" }}>This isn't sustainable. It isn't necessary.</span> Lume is the toolchain we wish existed when we were on the other side of this problem. We charge a percentage because we should only get paid when you save.
        </p>

        <div style={{ marginTop: 40, display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{
            width: 48, height: 48,
            background: "linear-gradient(135deg, #1a1a1a, #0a0a0a)",
            border: "1px solid var(--line-strong)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "var(--mono)", fontSize: 16, color: "var(--acid)",
          }}>M·K</div>
          <div className="mono-sm" style={{ color: "var(--ink-3)" }}>
            MAYA & KOSTAS · FOUNDERS · LUME
          </div>
        </div>
      </div>
    </div>
  </section>
);

/* FINAL CTA V5 */
const FinalCTAV5 = () => (
  <section style={{ padding: "140px 56px 120px" }}>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 24 }}>
      <div style={{ gridColumn: "1 / span 2" }}>
        <div className="mono-sm" style={{ color: "var(--ink-4)", letterSpacing: "0.16em" }}>§10<br/>JOIN</div>
      </div>
      <div style={{ gridColumn: "3 / span 9" }}>
        <h2 style={{ fontFamily: "var(--sans)", fontSize: 132, fontWeight: 500, lineHeight: 0.94, letterSpacing: "-0.05em" }}>
          Make<br/>your code<br/><span style={{ color: "var(--acid)" }}>private again.</span>
        </h2>
        <form onSubmit={(e) => e.preventDefault()} style={{ marginTop: 56, display: "flex", maxWidth: 540, border: "1px solid var(--line-strong)", background: "var(--bg-1)" }}>
          <input
            placeholder="you@company.com"
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", padding: "18px 20px", color: "var(--ink)", fontSize: 15 }}
          />
          <button className="btn-acid" data-waitlist style={{ borderRadius: 0, padding: "0 28px", fontFamily: "var(--mono)", fontSize: 12, letterSpacing: "0.08em" }}>
            REQUEST →
          </button>
        </form>
        <div className="mono-sm" style={{ marginTop: 20, color: "var(--ink-4)" }}>20 SLOTS · Q2 2026 · NO SPAM</div>
      </div>
    </div>
  </section>
);

const LandingV5 = () => (
  <div className="lp">
    <NavV5 />
    <HeroV5 />
    <ProblemV5 />
    <HowV5 />
    <CalculatorV5 />
    <PrivacyV5 />
    <ComparisonV5 />
    <PricingV5 />
    <FAQV5 />
    <FounderV5 />
    <FinalCTAV5 />
    <Footer />
  </div>
);

Object.assign(window, { LandingV5 });
