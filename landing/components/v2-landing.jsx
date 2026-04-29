/* global React */
const { useState: useStateV2 } = React;

/* =========================================================
   V2 — EDITORIAL, PRIVACY MANIFESTO
   Type-driven, more whitespace, fewer panels
   ========================================================= */

const NavV2 = () => (
  <nav style={{
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "28px 64px",
  }}>
    <Logo />
    <div style={{ fontFamily: "var(--mono)", fontSize: 11, letterSpacing: "0.12em", color: "var(--ink-4)" }}>
      ISSUE Nº 001 · PRIVATE · LOCAL · YOURS
    </div>
    <button className="btn-acid" data-waitlist style={{ padding: "10px 16px", fontSize: 13 }}>
      Join waitlist →
    </button>
  </nav>
);

const HeroV2 = () => (
  <section style={{ padding: "60px 64px 100px" }}>
    <div className="hairline" style={{ marginBottom: 60 }} />

    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 100, alignItems: "end" }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 32 }}>A MANIFESTO IN THREE LINES</div>
        <h1 style={{
          fontFamily: "var(--serif)", fontSize: 132,
          lineHeight: 0.92, letterSpacing: "-0.045em",
        }}>
          Save<br />
          <span style={{ color: "var(--acid)", fontStyle: "italic" }}>tokens.</span><br />
          Save<br />
          <span style={{ color: "var(--acid)", fontStyle: "italic" }}>privacy.</span><br />
          Save<br />
          <span style={{ color: "var(--acid)", fontStyle: "italic" }}>money.</span>
        </h1>
      </div>

      <div style={{ paddingBottom: 24 }}>
        <p style={{
          fontFamily: "var(--serif)", fontSize: 30, lineHeight: 1.35,
          letterSpacing: "-0.015em", color: "var(--ink)", maxWidth: 520,
        }}>
          We make a coding model that lives on your laptop, knows your codebase
          intimately, and bills you nothing until it's already saved you money.
        </p>

        <p className="body-lg" style={{ marginTop: 32, maxWidth: 480 }}>
          You give us your code, your documentation, and a few weeks of your
          team's time. We give you a private model — distilled to your stack —
          that runs inside Cursor, Codex, and Antigravity on local Macs. No
          hidden fees. Just 10% of what we save you.
        </p>

        <div style={{ marginTop: 40, display: "flex", gap: 12 }}>
          <button className="btn-acid" data-waitlist>Join the waitlist →</button>
          <button className="btn-ghost">Read the white paper</button>
        </div>
      </div>
    </div>

    <div className="hairline" style={{ marginTop: 80 }} />

    <div style={{
      display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
      paddingTop: 28,
    }}>
      {[
        ["TOKEN BILLS CUT BY", "60–70%", "in early pilots"],
        ["PROMPTS HANDLED LOCALLY", "≈93%", "weekly average"],
        ["DATA LEAVING THE LAPTOP", "0 bytes", "by architecture"],
        ["WE EARN", "10%", "of verified savings"],
      ].map(([label, num, sub], i) => (
        <div key={i} style={{ paddingRight: 24 }}>
          <div className="mono-sm" style={{ color: "var(--ink-4)", marginBottom: 12 }}>{label}</div>
          <div style={{ fontFamily: "var(--serif)", fontSize: 44, lineHeight: 1, letterSpacing: "-0.03em" }}>
            {num}
          </div>
          <div className="mono-sm" style={{ color: "var(--ink-4)", marginTop: 8 }}>{sub}</div>
        </div>
      ))}
    </div>
  </section>
);

/* PROBLEM */
const ProblemV2 = () => (
  <section style={{ padding: "140px 64px", background: "var(--bg-1)", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
    <div className="eyebrow" style={{ marginBottom: 40 }}>§ 02 — ON THE STATE OF THINGS</div>

    <div style={{ display: "grid", gridTemplateColumns: "0.4fr 1fr", gap: 60 }}>
      <div className="mono-sm" style={{ color: "var(--ink-4)", letterSpacing: "0.1em" }}>
        AN ESSAY,<br />
        IN BRIEF.
      </div>

      <div style={{ maxWidth: 880 }}>
        <p style={{
          fontFamily: "var(--serif)", fontSize: 38, lineHeight: 1.3,
          letterSpacing: "-0.02em", color: "var(--ink)",
        }}>
          The first generation of AI coding tools made a quiet trade. In exchange
          for autocomplete, they shipped your private codebase to a vendor's
          datacenter, charged you per token, and gave you back a model that had
          never seen your monorepo before today.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 56, marginTop: 64 }}>
          <p className="body-lg">
            <span style={{ color: "var(--acid)", fontFamily: "var(--mono)", fontSize: 12, letterSpacing: "0.1em", display: "block", marginBottom: 12 }}>
              ON PRIVACY.
            </span>
            Every keystroke crossed a perimeter. "Zero retention" was a policy,
            not an architecture. The trade was: trust us, or don't use it.
          </p>
          <p className="body-lg">
            <span style={{ color: "var(--acid)", fontFamily: "var(--mono)", fontSize: 12, letterSpacing: "0.1em", display: "block", marginBottom: 12 }}>
              ON COST.
            </span>
            Tokens compounded. A 25-engineer team easily burned through six
            figures a year, mostly on prompts the model would forget by morning.
          </p>
          <p className="body-lg">
            <span style={{ color: "var(--acid)", fontFamily: "var(--mono)", fontSize: 12, letterSpacing: "0.1em", display: "block", marginBottom: 12 }}>
              ON FIT.
            </span>
            Frontier models knew the public web. They did not know your custom
            RPC layer, your weird build system, or the unwritten conventions
            your team enforces in code review.
          </p>
          <p className="body-lg">
            <span style={{ color: "var(--acid)", fontFamily: "var(--mono)", fontSize: 12, letterSpacing: "0.1em", display: "block", marginBottom: 12 }}>
              ON THE FIX.
            </span>
            None of this needed to be true. A small model, distilled on the code
            it serves, running where the code already lives — solves all three
            at once.
          </p>
        </div>
      </div>
    </div>
  </section>
);

/* HOW V2 — three big numbered cards, more typographic */
const HowV2 = () => (
  <section style={{ padding: "140px 64px" }}>
    <div className="eyebrow" style={{ marginBottom: 40 }}>§ 03 — THE METHOD</div>
    <h2 className="h-section" style={{ marginBottom: 100, maxWidth: 1100 }}>
      Three movements. <em>Two weeks.</em><br />
      A model that costs less and knows more.
    </h2>

    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {[
        {
          n: "I.",
          title: "You give.",
          chap: "On collaboration.",
          body: "We come on-site or join your VPN. Code, docs, RFCs, the last six months of merged PRs — we ingest it where it lives. Nothing copies off your hardware. We sign whatever paperwork your security team requires.",
        },
        {
          n: "II.",
          title: "We distill.",
          chap: "On craft.",
          body: "We start from a strong open base, distill it on your team's patterns, and quantize it until it fits comfortably on an M-series Mac. We benchmark relentlessly against the frontier model you're paying for today. We do not ship a model that loses.",
        },
        {
          n: "III.",
          title: "You save.",
          chap: "On payoff.",
          body: "Lume installs as a local provider in Cursor, Codex, and Antigravity. The model handles ~93% of prompts on the laptop. The remaining 7% — genuinely hard reasoning — escalates to a frontier provider with your own key. The bill collapses.",
        },
      ].map((s, i) => (
        <div key={i} style={{
          display: "grid", gridTemplateColumns: "0.5fr 1fr 2fr",
          alignItems: "start",
          padding: "56px 0",
          borderTop: "1px solid var(--line)",
          borderBottom: i === 2 ? "1px solid var(--line)" : "none",
          gap: 56,
        }}>
          <div style={{
            fontFamily: "var(--serif)", fontSize: 96, lineHeight: 1,
            color: "var(--acid)", letterSpacing: "-0.04em",
          }}>
            {s.n}
          </div>
          <div>
            <div className="mono-sm" style={{ color: "var(--ink-4)", marginBottom: 12 }}>{s.chap}</div>
            <h3 style={{ fontFamily: "var(--serif)", fontSize: 56, lineHeight: 1, letterSpacing: "-0.03em" }}>
              {s.title}
            </h3>
          </div>
          <div className="body-lg" style={{ paddingTop: 12 }}>
            {s.body}
          </div>
        </div>
      ))}
    </div>
  </section>
);

/* CALCULATOR V2 — stripped-down inline pull-quote feel */
const CalculatorV2 = () => {
  const [seats, setSeats] = useStateV2(25);
  const [spend, setSpend] = useStateV2(180);
  const monthly = seats * spend;
  const saved = Math.round(monthly * 0.62);
  const ourCut = Math.round(saved * 0.1);
  const youKeep = saved - ourCut;

  return (
    <section style={{ padding: "140px 64px", background: "var(--bg-1)", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
      <div className="eyebrow" style={{ marginBottom: 40 }}>§ 04 — DO THE ARITHMETIC</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 100, alignItems: "center" }}>
        <div>
          <h2 className="h-section" style={{ marginBottom: 40 }}>
            For a team of <em style={{ color: "var(--acid)" }}>{seats}</em>,<br />
            spending <em style={{ color: "var(--acid)" }}>${spend}</em><br />
            per seat / month —
          </h2>

          <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            <CalcSlider label="Engineers" value={seats} min={5} max={500} step={5} unit="seats" onChange={setSeats} />
            <CalcSlider label="Monthly AI spend per seat" value={spend} min={50} max={800} step={10} unit="$/mo" onChange={setSpend} />
          </div>
        </div>

        <div style={{ borderLeft: "1px solid var(--line)", paddingLeft: 64 }}>
          <div className="mono-sm" style={{ color: "var(--ink-4)", marginBottom: 16 }}>YOU KEEP, EVERY MONTH</div>
          <div style={{
            fontFamily: "var(--serif)", fontSize: 168, lineHeight: 0.9, letterSpacing: "-0.04em",
            color: "var(--acid)",
          }}>
            ${youKeep.toLocaleString()}
          </div>

          <div style={{ marginTop: 40, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0, borderTop: "1px solid var(--line)" }}>
            {[
              ["WAS", `$${monthly.toLocaleString()}`],
              ["NOW", `$${(monthly - saved).toLocaleString()}`],
              ["OUR FEE", `$${ourCut.toLocaleString()}`],
            ].map(([l, v], i) => (
              <div key={i} style={{
                padding: "20px 0",
                borderRight: i < 2 ? "1px solid var(--line)" : "none",
                paddingLeft: i > 0 ? 24 : 0,
              }}>
                <div className="mono-sm" style={{ color: "var(--ink-4)" }}>{l}</div>
                <div style={{ fontFamily: "var(--serif)", fontSize: 28, marginTop: 6 }}>{v}</div>
              </div>
            ))}
          </div>

          <div className="body" style={{ marginTop: 24, fontSize: 13 }}>
            Estimated against your existing 30-day baseline. We invoice only on
            verified savings. If we don't beat baseline, you owe nothing.
          </div>
        </div>
      </div>
    </section>
  );
};

/* PRIVACY V2 — full-width quote slab */
const PrivacyV2 = () => (
  <section style={{ padding: "160px 64px", textAlign: "center" }}>
    <div className="eyebrow" style={{ marginBottom: 40, justifyContent: "center", display: "inline-flex" }}>
      § 05 — ON PRIVACY, AS ARCHITECTURE
    </div>
    <h2 style={{
      fontFamily: "var(--serif)", fontSize: 88, lineHeight: 1.0, letterSpacing: "-0.035em",
      maxWidth: 1100, margin: "0 auto",
    }}>
      The packets <em style={{ color: "var(--acid)", fontStyle: "italic" }}>don't leave</em><br />
      your laptop. There is<br />
      no policy to <em style={{ color: "var(--acid)", fontStyle: "italic" }}>break.</em>
    </h2>

    <p className="body-lg" style={{ maxWidth: 720, margin: "48px auto 0" }}>
      Lume's model weights live in <span style={{ fontFamily: "var(--mono)", color: "var(--acid)" }}>~/.lume/models/</span>.
      Inference happens on your hardware. The router classifies each prompt
      locally and only escalates the genuinely hard ones — and only with your
      explicit, per-prompt consent. Everything else is air-gapped by default.
    </p>

    <div style={{ marginTop: 56, display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap", maxWidth: 880, margin: "56px auto 0" }}>
      {["AIR-GAPPED INFERENCE", "AUDITABLE ROUTING", "BYO ESCALATION KEYS", "SOC 2 IN PROGRESS", "OPEN-WEIGHT BASE", "ZERO TELEMETRY", "ON-PREM TRAINING"].map((t) => (
        <span key={t} className="chip" style={{ borderColor: "var(--line-strong)" }}>{t}</span>
      ))}
    </div>
  </section>
);

/* COMPARISON V2 — inline */
const ComparisonV2 = () => {
  const rows = [
    ["WHERE YOUR CODE LIVES", "their datacenters", "their datacenters", "your laptop"],
    ["TRAINED ON YOUR STACK", "no", "no", "yes"],
    ["MARGINAL COST PER PROMPT", "$$ per call", "$$ per call", "≈ free"],
    ["WORKS OFFLINE", "no", "no", "yes"],
    ["IF YOU CANCEL", "nothing", "nothing", "you keep the weights"],
    ["PRICING", "per-token", "per-token", "10% of savings"],
  ];

  return (
    <section style={{ padding: "140px 64px", background: "var(--bg-1)", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
      <div className="eyebrow" style={{ marginBottom: 40 }}>§ 06 — A QUIET COMPARISON</div>
      <h2 className="h-section" style={{ marginBottom: 80, maxWidth: 1000 }}>
        Not a replacement for frontier models.<br />
        <em>A relief from paying for them constantly.</em>
      </h2>

      <div>
        {rows.map((r, i) => (
          <div key={i} style={{
            display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr",
            padding: "28px 0",
            borderTop: "1px solid var(--line)",
            borderBottom: i === rows.length - 1 ? "1px solid var(--line)" : "none",
            alignItems: "baseline",
          }}>
            <div className="mono-sm" style={{ color: "var(--ink-3)" }}>{r[0]}</div>
            <div style={{ fontFamily: "var(--serif)", fontSize: 22, color: "var(--ink-4)", fontStyle: "italic" }}>{r[1]}</div>
            <div style={{ fontFamily: "var(--serif)", fontSize: 22, color: "var(--ink-4)", fontStyle: "italic" }}>{r[2]}</div>
            <div style={{ fontFamily: "var(--serif)", fontSize: 22, color: "var(--acid)", fontStyle: "italic" }}>{r[3]}</div>
          </div>
        ))}
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", marginTop: 16 }}>
          <div />
          <div className="mono-sm" style={{ color: "var(--ink-5)" }}>OPENAI</div>
          <div className="mono-sm" style={{ color: "var(--ink-5)" }}>ANTHROPIC</div>
          <div className="mono-sm" style={{ color: "var(--acid)" }}>LUME · LOCAL</div>
        </div>
      </div>
    </section>
  );
};

/* PRICING V2 */
const PricingV2 = () => (
  <section style={{ padding: "160px 64px", textAlign: "center" }}>
    <div className="eyebrow" style={{ marginBottom: 40, justifyContent: "center", display: "inline-flex" }}>
      § 07 — THE BILL
    </div>

    <h2 style={{ fontFamily: "var(--serif)", fontSize: 64, lineHeight: 1.0, letterSpacing: "-0.03em", marginBottom: 32 }}>
      Ten percent of what we save you.<br />
      <em style={{ color: "var(--ink-3)" }}>Nothing else.</em>
    </h2>

    <div style={{ display: "flex", justifyContent: "center", alignItems: "baseline", gap: 16, margin: "60px 0 16px" }}>
      <span style={{ fontFamily: "var(--serif)", fontSize: 280, lineHeight: 0.9, letterSpacing: "-0.05em" }}>
        10
      </span>
      <span style={{ fontFamily: "var(--serif)", fontSize: 140, lineHeight: 0.9, color: "var(--acid)" }}>%</span>
    </div>

    <p className="body-lg" style={{ maxWidth: 640, margin: "32px auto 0" }}>
      We measure your AI bill the month before you install lume. Every month
      after, you pay 10% of the difference. If we don't save you anything, the
      invoice is zero. There is no setup fee, no seat license, no lock-in.
    </p>

    <div style={{ display: "flex", justifyContent: "center", gap: 56, marginTop: 56, fontSize: 14, color: "var(--ink-3)" }}>
      <span>· No setup fee</span>
      <span>· No per-seat license</span>
      <span>· Cancel and keep your weights</span>
    </div>
  </section>
);

/* FAQ V2 */
const FAQV2 = () => {
  const [open, setOpen] = useStateV2(0);
  const items = [
    ["Does the local model keep up?", "On code grounded in your stack — yes, often better. We benchmark against your existing frontier model. If we don't beat baseline, we don't deploy. Truly novel reasoning still escalates (about 7% of prompts in practice)."],
    ["What hardware does my team need?", "An M-series Mac with 16GB+ unified memory. Larger distillations on M3 Max / M4 Pro. Linux/CUDA workstations are in beta."],
    ["How is this different from running Llama locally?", "Stock open models don't know your code. We distill them on your repos, RFCs, and recent PRs, then keep tuning monthly."],
    ["What happens during training?", "Training runs on hardware in your office or VPC. Data never leaves your perimeter. Air-gapped is supported."],
    ["What if we cancel?", "You keep the weights. No DRM, no expiry. The model is yours. We just stop invoicing."],
  ];

  return (
    <section style={{ padding: "140px 64px", background: "var(--bg-1)", borderTop: "1px solid var(--line)" }}>
      <div className="eyebrow" style={{ marginBottom: 40 }}>§ 08 — REASONABLE QUESTIONS</div>
      <h2 className="h-section" style={{ marginBottom: 56 }}>Asked & answered.</h2>

      <div>
        {items.map((it, i) => (
          <div key={i} style={{ borderTop: "1px solid var(--line)", borderBottom: i === items.length - 1 ? "1px solid var(--line)" : "none" }}>
            <button
              onClick={() => setOpen(open === i ? -1 : i)}
              style={{ width: "100%", padding: "32px 0", display: "flex", justifyContent: "space-between", alignItems: "baseline", textAlign: "left", color: "var(--ink)" }}
            >
              <span style={{ fontFamily: "var(--serif)", fontSize: 28, letterSpacing: "-0.02em" }}>
                <span style={{ fontFamily: "var(--mono)", color: "var(--ink-4)", fontSize: 12, marginRight: 24 }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                {it[0]}
              </span>
              <span style={{ color: open === i ? "var(--acid)" : "var(--ink-4)", fontSize: 28, fontFamily: "var(--mono)" }}>
                {open === i ? "−" : "+"}
              </span>
            </button>
            {open === i && (
              <div style={{ paddingBottom: 32, paddingLeft: 60, color: "var(--ink-3)", fontSize: 16, lineHeight: 1.6, maxWidth: 800 }}>
                {it[1]}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
};

/* FOUNDER V2 */
const FounderV2 = () => (
  <section style={{ padding: "160px 64px" }}>
    <div className="eyebrow" style={{ marginBottom: 40 }}>§ 09 — A LETTER</div>
    <div style={{ maxWidth: 920 }}>
      <p style={{ fontFamily: "var(--serif)", fontSize: 44, lineHeight: 1.3, letterSpacing: "-0.02em" }}>
        We've spent six years inside frontier labs and infra teams, watching
        companies pour millions a year into AI bills — and ship their crown
        jewels through someone else's API to do it. <em style={{ color: "var(--acid)" }}>This isn't sustainable. It isn't necessary.</em>
      </p>
      <p className="body-lg" style={{ marginTop: 40 }}>
        Most of what your engineers ask an LLM is grounded in code that already
        exists in your repo. A small model that actually <em>knows</em> your
        code can answer those prompts faster, cheaper, and without the round-trip.
        Lume is the toolchain we wish existed when we were on the other side
        of this problem.
      </p>
      <p className="body-lg" style={{ marginTop: 24 }}>
        We charge a percentage because we should only get paid when you save.
        If you'd like to talk — really talk — write us. We answer ourselves.
      </p>

      <div style={{ marginTop: 56, display: "flex", alignItems: "center", gap: 24 }}>
        <div style={{
          width: 64, height: 64,
          background: "linear-gradient(135deg, #1a1a1a, #0a0a0a)",
          border: "1px solid var(--line-strong)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: "var(--serif)", fontSize: 24, color: "var(--acid)",
        }}>
          M·K
        </div>
        <div>
          <div style={{ fontFamily: "var(--serif)", fontSize: 22, fontStyle: "italic" }}>Maya & Kostas</div>
          <div className="mono-sm" style={{ color: "var(--ink-4)", marginTop: 4 }}>FOUNDERS · LUME</div>
        </div>
      </div>
    </div>
  </section>
);

/* FINAL CTA V2 */
const FinalCTAV2 = () => (
  <section style={{ padding: "160px 64px 140px", borderTop: "1px solid var(--line)", textAlign: "center" }}>
    <h2 style={{ fontFamily: "var(--serif)", fontSize: 144, lineHeight: 0.92, letterSpacing: "-0.05em" }}>
      Make<br />
      your code<br />
      <em style={{ color: "var(--acid)", fontStyle: "italic" }}>private again.</em>
    </h2>

    <form
      onSubmit={(e) => e.preventDefault()}
      style={{ marginTop: 64, display: "flex", maxWidth: 540, margin: "64px auto 0", borderBottom: "1px solid var(--line-strong)" }}
    >
      <input
        placeholder="you@company.com"
        style={{ flex: 1, background: "transparent", border: "none", outline: "none", padding: "16px 4px", color: "var(--ink)", fontSize: 18, fontFamily: "var(--serif)" }}
      />
      <button className="btn-acid" data-waitlist style={{ borderRadius: 0 }}>
        Request invitation →
      </button>
    </form>

    <div className="mono-sm" style={{ marginTop: 24, color: "var(--ink-4)" }}>
      20 SLOTS · Q2 2026
    </div>
  </section>
);

/* ASSEMBLY V2 */
const LandingV2 = () => (
  <div className="lp">
    <NavV2 />
    <HeroV2 />
    <ProblemV2 />
    <HowV2 />
    <CalculatorV2 />
    <PrivacyV2 />
    <ComparisonV2 />
    <PricingV2 />
    <FAQV2 />
    <FounderV2 />
    <FinalCTAV2 />
    <Footer />
  </div>
);

Object.assign(window, { LandingV2 });
