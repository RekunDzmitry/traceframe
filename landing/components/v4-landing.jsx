/* global React */
const { useState: useStateV4 } = React;

/* =========================================================
   V4 — NEWSPAPER / BROADSHEET
   Like V2 but with classified-ad density, rules everywhere,
   small-caps eyebrows, drop caps. Maximalist editorial.
   ========================================================= */

const NavV4 = () => (
  <nav style={{
    display: "grid",
    gridTemplateColumns: "1fr auto 1fr",
    alignItems: "center",
    padding: "20px 64px 16px",
    borderBottom: "3px double var(--line-strong)",
  }}>
    <div className="mono-sm" style={{ color: "var(--ink-4)", letterSpacing: "0.14em" }}>
      VOL. I · ISSUE 001
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <Logo />
    </div>
    <div className="mono-sm" style={{ color: "var(--ink-4)", textAlign: "right", letterSpacing: "0.14em" }}>
      MONDAY · APRIL 27 · 2026
    </div>
  </nav>
);

const HeroV4 = () => (
  <section style={{ padding: "32px 64px 56px", borderBottom: "1px solid var(--line)" }}>
    <div style={{ textAlign: "center", marginBottom: 32 }}>
      <div className="mono-sm" style={{ color: "var(--acid)", letterSpacing: "0.2em", marginBottom: 12 }}>
        ── A NEW DISPATCH ON LOCAL INTELLIGENCE ──
      </div>
      <h1 style={{
        fontFamily: "var(--serif)",
        fontSize: 168,
        lineHeight: 0.92,
        letterSpacing: "-0.04em",
        margin: "0 auto",
      }}>
        Save tokens.<br/>
        Save <em style={{ color: "var(--acid)", fontStyle: "italic" }}>privacy.</em><br/>
        Save money.
      </h1>
      <div className="mono-sm" style={{ color: "var(--ink-4)", marginTop: 24, letterSpacing: "0.16em" }}>
        ━━━━━ A MANIFESTO IN THREE LINES ━━━━━
      </div>
    </div>

    {/* Three-column lede — newspaper style */}
    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr 1fr 1fr",
      gap: 40,
      marginTop: 56,
      borderTop: "1px solid var(--line)",
      borderBottom: "1px solid var(--line)",
      padding: "32px 0",
    }}>
      {[
        { eye: "ON THE PROBLEM", body: "Every keystroke crossed a perimeter. \"Zero retention\" was a policy, not an architecture. The trade was: trust us, or don't use it." },
        { eye: "ON THE BILL", body: "Tokens compounded. A 25-engineer team easily burned through six figures a year, mostly on prompts the model would forget by morning." },
        { eye: "ON THE FIX", body: "A small model, distilled on the code it serves, running where the code already lives — solves all three at once. We charge ten percent of what you save. Nothing else." },
      ].map((c, i) => (
        <div key={i} style={{ paddingRight: i < 2 ? 32 : 0, borderRight: i < 2 ? "1px solid var(--line)" : "none" }}>
          <div className="mono-sm" style={{ color: "var(--acid)", marginBottom: 14, letterSpacing: "0.12em" }}>
            § {c.eye}
          </div>
          <p style={{
            fontFamily: "var(--serif)",
            fontSize: 22,
            lineHeight: 1.45,
            letterSpacing: "-0.01em",
            color: "var(--ink-2)",
          }}>
            {i === 0 && (
              <span style={{
                fontFamily: "var(--serif)",
                fontSize: 64,
                lineHeight: 0.85,
                float: "left",
                marginRight: 8,
                marginTop: 4,
                color: "var(--acid)",
              }}>E</span>
            )}
            {i === 0 ? c.body.slice(1) : c.body}
          </p>
        </div>
      ))}
    </div>

    <div style={{ marginTop: 40, display: "flex", justifyContent: "center", gap: 12 }}>
      <button className="btn-acid" data-waitlist>Subscribe to the waitlist →</button>
      <button className="btn-ghost">Read the full edition</button>
    </div>

    {/* Stats strip with rules */}
    <div style={{
      marginTop: 56,
      display: "grid",
      gridTemplateColumns: "repeat(4, 1fr)",
      borderTop: "3px double var(--line-strong)",
      borderBottom: "3px double var(--line-strong)",
      padding: "24px 0",
    }}>
      {[
        ["TOKEN BILLS", "60–70%", "cut, in pilots"],
        ["LOCAL ROUTING", "≈93%", "of prompts"],
        ["DATA EGRESS", "0 bytes", "by architecture"],
        ["OUR FEE", "10%", "of what we save"],
      ].map(([l, n, s], i) => (
        <div key={i} style={{
          textAlign: "center",
          borderRight: i < 3 ? "1px solid var(--line)" : "none",
        }}>
          <div className="mono-sm" style={{ color: "var(--ink-4)", marginBottom: 10, letterSpacing: "0.14em" }}>
            {l}
          </div>
          <div style={{
            fontFamily: "var(--serif)",
            fontSize: 56,
            lineHeight: 1,
            letterSpacing: "-0.03em",
          }}>
            {n}
          </div>
          <div className="mono-sm" style={{ color: "var(--ink-4)", marginTop: 8 }}>{s}</div>
        </div>
      ))}
    </div>
  </section>
);

/* PROBLEM V4 — single big editorial column with sidenotes */
const ProblemV4 = () => (
  <section style={{ padding: "120px 64px", borderBottom: "1px solid var(--line)" }}>
    <div className="eyebrow" style={{ marginBottom: 28, letterSpacing: "0.16em" }}>
      § 02 — ON THE STATE OF THINGS
    </div>

    <h2 style={{
      fontFamily: "var(--serif)",
      fontSize: 76,
      lineHeight: 0.98,
      letterSpacing: "-0.035em",
      marginBottom: 64,
      maxWidth: 1100,
    }}>
      The first generation of AI coding<br/>
      tools made a <em style={{ color: "var(--acid)" }}>quiet trade.</em>
    </h2>

    <div style={{ display: "grid", gridTemplateColumns: "0.5fr 2fr", gap: 64 }}>
      <aside style={{ paddingTop: 12 }}>
        <div className="mono-sm" style={{ color: "var(--ink-4)", letterSpacing: "0.12em", lineHeight: 2 }}>
          ── MARGINALIA ──<br/>
          ▸ Vendor policies are<br/>
          &nbsp;&nbsp;not architecture.<br/><br/>
          ▸ Frontier prices for<br/>
          &nbsp;&nbsp;general-purpose<br/>
          &nbsp;&nbsp;intuition.<br/><br/>
          ▸ The model forgets<br/>
          &nbsp;&nbsp;your codebase by<br/>
          &nbsp;&nbsp;morning. You pay<br/>
          &nbsp;&nbsp;to re-teach it.<br/><br/>
          ▸ One config flip and<br/>
          &nbsp;&nbsp;your moat is<br/>
          &nbsp;&nbsp;training data.
        </div>
      </aside>

      <div style={{ maxWidth: 820, columnCount: 2, columnGap: 48 }}>
        <p style={{
          fontFamily: "var(--serif)",
          fontSize: 18,
          lineHeight: 1.65,
          color: "var(--ink-2)",
          marginBottom: 16,
        }}>
          <span style={{
            fontFamily: "var(--serif)",
            fontSize: 72,
            lineHeight: 0.85,
            float: "left",
            marginRight: 10,
            marginTop: 4,
            color: "var(--acid)",
          }}>I</span>
          n exchange for autocomplete, the first wave of AI coding tools shipped your private codebase to a vendor's datacenter, charged you per token, and gave you back a model that had never seen your monorepo before today. It was an extraordinary deal, in retrospect.
        </p>

        <p style={{ fontFamily: "var(--serif)", fontSize: 18, lineHeight: 1.65, color: "var(--ink-2)", marginBottom: 16 }}>
          Every keystroke crossed a perimeter. <em>Zero retention</em> was a policy, not an architecture. The trade was simple: trust the vendor, or don't use the tool.
        </p>

        <p style={{ fontFamily: "var(--serif)", fontSize: 18, lineHeight: 1.65, color: "var(--ink-2)", marginBottom: 16 }}>
          Tokens, meanwhile, compounded. A 25-engineer team could burn six figures a year on prompts the model would forget by the next session. Engineers were paying premium frontier rates for general-purpose intuition that did not know their custom RPC layer, their build system, or the unwritten conventions enforced in code review.
        </p>

        <p style={{ fontFamily: "var(--serif)", fontSize: 18, lineHeight: 1.65, color: "var(--ink-2)" }}>
          None of this needed to be true. A small model, distilled on the code it serves and running where that code already lives, solves the privacy problem, the cost problem, and the fit problem at the same time. <em style={{ color: "var(--acid)" }}>That is what we have built.</em>
        </p>
      </div>
    </div>
  </section>
);

/* HOW V4 — three numbered chapters, big serif numerals on the left */
const HowV4 = () => (
  <section style={{ padding: "120px 64px", borderBottom: "1px solid var(--line)", background: "var(--bg-1)" }}>
    <div className="eyebrow" style={{ marginBottom: 28 }}>§ 03 — THE METHOD, IN THREE CHAPTERS</div>
    <h2 className="h-section" style={{ marginBottom: 80, maxWidth: 1100 }}>
      You give us the materials.<br/>
      We deliver <em>the model.</em>
    </h2>

    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {[
        { n: "I.", chap: "Of Materials.", title: "You give.", body: "We come on-site or join your VPN. Code, docs, RFCs, the last six months of merged PRs — all ingested where it lives. Nothing copies off your hardware. We sign the paperwork your security team requires." },
        { n: "II.", chap: "Of Craft.", title: "We distill.", body: "From a strong open base, distilled on your team's patterns and quantized until it fits comfortably on an M-series Mac. We benchmark relentlessly against the frontier model you're paying for today. We do not ship a model that loses." },
        { n: "III.", chap: "Of Payoff.", title: "You save.", body: "Lume installs as a local provider in Cursor, Codex, and Antigravity. The model handles ~93% of prompts on the laptop. The remaining 7% — genuinely hard reasoning — escalates to a frontier provider with your own keys." },
      ].map((s, i) => (
        <div key={i} style={{
          display: "grid",
          gridTemplateColumns: "0.4fr 1fr 2fr",
          gap: 56,
          padding: "48px 0",
          borderTop: i === 0 ? "3px double var(--line-strong)" : "1px solid var(--line)",
          borderBottom: i === 2 ? "3px double var(--line-strong)" : "none",
          alignItems: "baseline",
        }}>
          <div style={{
            fontFamily: "var(--serif)",
            fontSize: 140, lineHeight: 1, color: "var(--acid)",
            letterSpacing: "-0.05em",
            fontStyle: "italic",
          }}>
            {s.n}
          </div>
          <div>
            <div className="mono-sm" style={{ color: "var(--ink-4)", marginBottom: 14, letterSpacing: "0.14em" }}>
              CHAPTER {s.chap}
            </div>
            <h3 style={{
              fontFamily: "var(--serif)",
              fontSize: 64, lineHeight: 1, letterSpacing: "-0.03em",
            }}>
              {s.title}
            </h3>
          </div>
          <p className="body-lg" style={{ paddingTop: 8 }}>{s.body}</p>
        </div>
      ))}
    </div>
  </section>
);

/* CALCULATOR V4 — embedded inside an editorial frame */
const CalculatorV4 = () => {
  const [seats, setSeats] = useStateV4(25);
  const [spend, setSpend] = useStateV4(180);
  const monthly = seats * spend;
  const saved = Math.round(monthly * 0.62);
  const ourCut = Math.round(saved * 0.1);
  const youKeep = saved - ourCut;

  return (
    <section style={{ padding: "120px 64px", borderBottom: "1px solid var(--line)" }}>
      <div className="eyebrow" style={{ marginBottom: 28 }}>§ 04 — A LITTLE ARITHMETIC</div>

      <div style={{
        border: "3px double var(--line-strong)",
        padding: "56px 64px",
        background: "var(--bg)",
      }}>
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <div className="mono-sm" style={{ color: "var(--ink-4)", letterSpacing: "0.16em", marginBottom: 16 }}>
            ── DO THE MATH ──
          </div>
          <h3 style={{
            fontFamily: "var(--serif)",
            fontSize: 56,
            lineHeight: 1,
            letterSpacing: "-0.03em",
          }}>
            For a team of <em style={{ color: "var(--acid)" }}>{seats}</em>, spending <em style={{ color: "var(--acid)" }}>${spend}</em>/seat —
          </h3>
        </div>

        <div style={{
          fontFamily: "var(--serif)",
          fontSize: 200,
          lineHeight: 0.92,
          letterSpacing: "-0.05em",
          textAlign: "center",
          color: "var(--acid)",
        }}>
          ${youKeep.toLocaleString()}
        </div>
        <div className="mono-sm" style={{ textAlign: "center", color: "var(--ink-4)", letterSpacing: "0.16em", marginTop: 12 }}>
          ── YOU KEEP, EVERY MONTH ──
        </div>

        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 64,
          marginTop: 56,
          paddingTop: 40,
          borderTop: "1px solid var(--line)",
        }}>
          <div>
            <CalcSlider label="Engineers" value={seats} min={5} max={500} step={5} unit="seats" onChange={setSeats} />
            <CalcSlider label="Monthly AI spend per seat" value={spend} min={50} max={800} step={10} unit="$/mo" onChange={setSpend} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0, alignSelf: "center" }}>
            {[
              ["WAS", `$${monthly.toLocaleString()}`],
              ["NOW", `$${(monthly - saved).toLocaleString()}`],
              ["OUR FEE", `$${ourCut.toLocaleString()}`],
            ].map(([l, v], i) => (
              <div key={i} style={{
                padding: "0 16px",
                borderRight: i < 2 ? "1px solid var(--line)" : "none",
                textAlign: "center",
              }}>
                <div className="mono-sm" style={{ color: "var(--ink-4)" }}>{l}</div>
                <div style={{ fontFamily: "var(--serif)", fontSize: 32, marginTop: 6 }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="body" style={{ marginTop: 24, fontSize: 13, textAlign: "center" }}>
        Estimated against your existing 30-day baseline. We invoice only on verified savings.
        If we don't beat baseline, you owe nothing.
      </div>
    </section>
  );
};

/* PRIVACY V4 */
const PrivacyV4 = () => (
  <section style={{ padding: "140px 64px", borderBottom: "1px solid var(--line)", background: "var(--bg-1)", textAlign: "center" }}>
    <div className="eyebrow" style={{ marginBottom: 28, justifyContent: "center", display: "inline-flex" }}>
      § 05 — ON PRIVACY, AS ARCHITECTURE
    </div>
    <h2 style={{
      fontFamily: "var(--serif)",
      fontSize: 96,
      lineHeight: 1.0,
      letterSpacing: "-0.035em",
      maxWidth: 1100,
      margin: "0 auto",
    }}>
      The packets <em style={{ color: "var(--acid)", fontStyle: "italic" }}>don't leave</em><br/>
      your laptop. There is<br/>
      no policy to <em style={{ color: "var(--acid)", fontStyle: "italic" }}>break.</em>
    </h2>

    <p className="body-lg" style={{ maxWidth: 720, margin: "40px auto 0" }}>
      Lume's model weights live in <span style={{ fontFamily: "var(--mono)", color: "var(--acid)" }}>~/.lume/models/</span>.
      Inference happens on your hardware. The router classifies each prompt locally and only escalates the genuinely
      hard ones — and only with your explicit, per-prompt consent. Everything else is air-gapped by default.
    </p>

    <div style={{ marginTop: 48, display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap", maxWidth: 880, margin: "48px auto 0" }}>
      {["AIR-GAPPED INFERENCE", "AUDITABLE ROUTING", "BYO ESCALATION KEYS", "SOC 2 IN PROGRESS", "OPEN-WEIGHT BASE", "ZERO TELEMETRY", "ON-PREM TRAINING"].map((t) => (
        <span key={t} className="chip">{t}</span>
      ))}
    </div>
  </section>
);

/* COMPARISON V4 — same data, traditional table */
const ComparisonV4 = () => {
  const rows = [
    ["WHERE YOUR CODE LIVES", "their datacenters", "their datacenters", "your laptop"],
    ["TRAINED ON YOUR STACK", "no", "no", "yes"],
    ["MARGINAL COST PER PROMPT", "$$ per call", "$$ per call", "≈ free"],
    ["WORKS OFFLINE", "no", "no", "yes"],
    ["IF YOU CANCEL", "nothing", "nothing", "you keep the weights"],
    ["PRICING", "per-token", "per-token", "10% of savings"],
  ];
  return (
    <section style={{ padding: "120px 64px", borderBottom: "1px solid var(--line)" }}>
      <div className="eyebrow" style={{ marginBottom: 28 }}>§ 06 — A QUIET COMPARISON</div>
      <h2 className="h-section" style={{ marginBottom: 56, maxWidth: 1000 }}>
        Not a replacement for frontier models.<br/>
        <em>A relief from paying for them constantly.</em>
      </h2>
      <div>
        {rows.map((r, i) => (
          <div key={i} style={{
            display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr",
            padding: "24px 0",
            borderTop: i === 0 ? "3px double var(--line-strong)" : "1px solid var(--line)",
            borderBottom: i === rows.length - 1 ? "3px double var(--line-strong)" : "none",
            alignItems: "baseline",
          }}>
            <div className="mono-sm" style={{ color: "var(--ink-3)" }}>{r[0]}</div>
            <div style={{ fontFamily: "var(--serif)", fontSize: 22, color: "var(--ink-4)", fontStyle: "italic" }}>{r[1]}</div>
            <div style={{ fontFamily: "var(--serif)", fontSize: 22, color: "var(--ink-4)", fontStyle: "italic" }}>{r[2]}</div>
            <div style={{ fontFamily: "var(--serif)", fontSize: 22, color: "var(--acid)", fontStyle: "italic" }}>{r[3]}</div>
          </div>
        ))}
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", marginTop: 12 }}>
          <div />
          <div className="mono-sm" style={{ color: "var(--ink-5)" }}>OPENAI</div>
          <div className="mono-sm" style={{ color: "var(--ink-5)" }}>ANTHROPIC</div>
          <div className="mono-sm" style={{ color: "var(--acid)" }}>LUME · LOCAL</div>
        </div>
      </div>
    </section>
  );
};

/* PRICING V4 — broadsheet "advertisement" treatment */
const PricingV4 = () => (
  <section style={{ padding: "120px 64px", borderBottom: "1px solid var(--line)", background: "var(--bg-1)" }}>
    <div className="eyebrow" style={{ marginBottom: 28 }}>§ 07 — THE BILL, ITEMIZED</div>

    <div style={{
      border: "3px double var(--line-strong)",
      padding: "64px 56px",
      textAlign: "center",
      maxWidth: 1100,
      margin: "0 auto",
    }}>
      <div className="mono-sm" style={{ color: "var(--acid)", letterSpacing: "0.18em", marginBottom: 24 }}>
        ◆ ◆ ◆ &nbsp; A SINGLE NUMBER &nbsp; ◆ ◆ ◆
      </div>

      <div style={{ display: "flex", justifyContent: "center", alignItems: "baseline", gap: 16 }}>
        <span style={{ fontFamily: "var(--serif)", fontSize: 280, lineHeight: 0.9, letterSpacing: "-0.05em" }}>10</span>
        <span style={{ fontFamily: "var(--serif)", fontSize: 140, lineHeight: 0.9, color: "var(--acid)" }}>%</span>
      </div>

      <div className="mono-sm" style={{ color: "var(--ink-4)", letterSpacing: "0.14em", marginTop: 12 }}>
        OF VERIFIED SAVINGS — NOTHING ELSE
      </div>

      <p style={{
        fontFamily: "var(--serif)",
        fontSize: 22, lineHeight: 1.5,
        maxWidth: 680, margin: "32px auto 0",
        color: "var(--ink-2)",
      }}>
        We measure your AI bill the month before you install Lume. Every month after,
        you pay 10% of the difference. If we don't save you anything, the invoice is zero.
      </p>

      <div style={{ display: "flex", justifyContent: "center", gap: 56, marginTop: 40, fontSize: 13, color: "var(--ink-3)", flexWrap: "wrap" }}>
        <span>· No setup fee</span>
        <span>· No per-seat license</span>
        <span>· Cancel and keep your weights</span>
      </div>
    </div>
  </section>
);

/* FAQ V4 */
const FAQV4 = () => {
  const [open, setOpen] = useStateV4(0);
  const items = [
    ["Does the local model keep up?", "On code grounded in your stack — yes, often better. We benchmark against your existing frontier model. If we don't beat baseline, we don't deploy. Truly novel reasoning still escalates (about 7% of prompts in practice)."],
    ["What hardware does my team need?", "An M-series Mac with 16GB+ unified memory. Larger distillations on M3 Max / M4 Pro. Linux/CUDA workstations are in beta."],
    ["How is this different from running Llama locally?", "Stock open models don't know your code. We distill them on your repos, RFCs, and recent PRs, then keep tuning monthly."],
    ["What happens during training?", "Training runs on hardware in your office or VPC. Data never leaves your perimeter. Air-gapped is supported."],
    ["What if we cancel?", "You keep the weights. No DRM, no expiry. The model is yours. We just stop invoicing."],
  ];
  return (
    <section style={{ padding: "120px 64px", borderBottom: "1px solid var(--line)" }}>
      <div className="eyebrow" style={{ marginBottom: 28 }}>§ 08 — REASONABLE QUESTIONS</div>
      <h2 className="h-section" style={{ marginBottom: 56 }}>Asked <em>& answered.</em></h2>
      <div>
        {items.map((it, i) => (
          <div key={i} style={{ borderTop: i === 0 ? "3px double var(--line-strong)" : "1px solid var(--line)", borderBottom: i === items.length - 1 ? "3px double var(--line-strong)" : "none" }}>
            <button onClick={() => setOpen(open === i ? -1 : i)} style={{ width: "100%", padding: "28px 0", display: "flex", justifyContent: "space-between", alignItems: "baseline", textAlign: "left", color: "var(--ink)" }}>
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
              <div style={{ paddingBottom: 28, paddingLeft: 60, color: "var(--ink-3)", fontSize: 16, lineHeight: 1.6, maxWidth: 800 }}>
                {it[1]}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
};

/* FOUNDER V4 */
const FounderV4 = () => (
  <section style={{ padding: "140px 64px", borderBottom: "1px solid var(--line)", background: "var(--bg-1)" }}>
    <div className="eyebrow" style={{ marginBottom: 28 }}>§ 09 — A LETTER FROM THE EDITORS</div>
    <div style={{ maxWidth: 920 }}>
      <p style={{ fontFamily: "var(--serif)", fontSize: 44, lineHeight: 1.3, letterSpacing: "-0.02em", fontStyle: "italic" }}>
        "We've spent six years inside frontier labs and infra teams, watching companies pour millions a year into AI bills — and ship their crown jewels through someone else's API to do it. <em style={{ color: "var(--acid)" }}>This isn't sustainable. It isn't necessary.</em>"
      </p>
      <p className="body-lg" style={{ marginTop: 36 }}>
        Most of what your engineers ask an LLM is grounded in code that already exists in your repo.
        A small model that actually <em>knows</em> your code can answer those prompts faster, cheaper,
        and without the round-trip. Lume is the toolchain we wish existed when we were on the other
        side of this problem.
      </p>
      <p className="body-lg" style={{ marginTop: 20 }}>
        We charge a percentage because we should only get paid when you save. If you'd like to
        talk — really talk — write us. We answer ourselves.
      </p>

      <div style={{ marginTop: 48, display: "flex", alignItems: "center", gap: 24, paddingTop: 32, borderTop: "1px solid var(--line)" }}>
        <div style={{
          width: 64, height: 64,
          background: "linear-gradient(135deg, #1a1a1a, #0a0a0a)",
          border: "1px solid var(--line-strong)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: "var(--serif)", fontSize: 24, color: "var(--acid)",
        }}>M·K</div>
        <div>
          <div style={{ fontFamily: "var(--serif)", fontSize: 22, fontStyle: "italic" }}>Maya & Kostas</div>
          <div className="mono-sm" style={{ color: "var(--ink-4)", marginTop: 4 }}>FOUNDERS · LUME</div>
        </div>
      </div>
    </div>
  </section>
);

/* FINAL CTA V4 — classifieds style */
const FinalCTAV4 = () => (
  <section style={{ padding: "140px 64px 120px", textAlign: "center" }}>
    <div className="mono-sm" style={{ color: "var(--acid)", letterSpacing: "0.2em", marginBottom: 28 }}>
      ── A FINAL NOTICE ──
    </div>
    <h2 style={{ fontFamily: "var(--serif)", fontSize: 144, lineHeight: 0.92, letterSpacing: "-0.045em" }}>
      Make<br/>
      your code<br/>
      <em style={{ color: "var(--acid)", fontStyle: "italic" }}>private again.</em>
    </h2>

    <form onSubmit={(e) => { e.preventDefault(); window.openWaitlist && window.openWaitlist(); }} style={{ marginTop: 64, display: "flex", maxWidth: 540, margin: "64px auto 0", borderBottom: "1px solid var(--line-strong)" }}>
      <input
        placeholder="you@company.com"
        style={{ flex: 1, background: "transparent", border: "none", outline: "none", padding: "16px 4px", color: "var(--ink)", fontSize: 18, fontFamily: "var(--serif)" }}
      />
      <button className="btn-acid" style={{ borderRadius: 0 }} data-waitlist>Request invitation →</button>
    </form>
    <div className="mono-sm" style={{ marginTop: 24, color: "var(--ink-4)" }}>20 SLOTS · Q2 2026</div>
  </section>
);

const LandingV4 = () => (
  <div className="lp">
    <NavV4 />
    <HeroV4 />
    <ProblemV4 />
    <HowV4 />
    <CalculatorV4 />
    <PrivacyV4 />
    <ComparisonV4 />
    <PricingV4 />
    <FAQV4 />
    <FounderV4 />
    <FinalCTAV4 />
    <Footer />
  </div>
);

Object.assign(window, { LandingV4 });
