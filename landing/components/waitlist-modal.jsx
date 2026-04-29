/* global React */
const { useState: useStateWL, useEffect: useEffectWL, useRef: useRefWL } = React;

/* =========================================================
   WaitlistModal — broadsheet/editorial-styled modal
   Used across all variants. Open via window.openWaitlist().
   ========================================================= */

const WaitlistModal = ({ open, onClose }) => {
  const [step, setStep] = useStateWL("form"); // "form" | "done"
  const [form, setForm] = useStateWL({
    email: "",
    company: "",
    seats: "11–25",
    role: "Engineer",
    notes: "",
  });
  const [touched, setTouched] = useStateWL(false);
  const dialogRef = useRefWL(null);

  // Lock body scroll & handle Escape
  useEffectWL(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    // Reset to form on every open
    setStep("form");
    setTouched(false);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
  const canSubmit = emailValid && form.company.trim().length > 0;

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = (e) => {
    e.preventDefault();
    setTouched(true);
    if (!canSubmit) return;
    // No backend — just acknowledge.
    setStep("done");
  };

  // -------- Field styles (inline, broadsheet-ish) --------
  const labelMono = {
    fontFamily: "var(--mono)",
    fontSize: 10,
    letterSpacing: "0.18em",
    color: "var(--ink-4)",
    textTransform: "uppercase",
    display: "block",
    marginBottom: 8,
  };
  const inputBase = {
    width: "100%",
    background: "transparent",
    border: "none",
    borderBottom: "1px solid var(--line-strong)",
    outline: "none",
    padding: "10px 0",
    color: "var(--ink)",
    fontFamily: "var(--serif)",
    fontSize: 22,
    letterSpacing: "-0.01em",
  };
  const inputFocus = {
    borderBottomColor: "var(--acid)",
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="wl-title"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(5, 5, 5, 0.78)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 24px",
        animation: "wl-fade .18s ease-out",
      }}
    >
      <style>{`
        @keyframes wl-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes wl-rise { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
        .wl-pill {
          display: inline-flex; align-items: center; justify-content: center;
          padding: 10px 14px;
          border: 1px solid var(--line-strong);
          background: transparent;
          color: var(--ink-3);
          font-family: var(--mono);
          font-size: 11px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          cursor: pointer;
          transition: border-color .15s, color .15s, background .15s;
        }
        .wl-pill:hover { border-color: var(--ink-3); color: var(--ink); }
        .wl-pill[data-active="true"] {
          border-color: var(--acid);
          color: var(--acid);
          background: var(--acid-glow);
        }
        .wl-input::placeholder { color: var(--ink-5); font-style: italic; }
        .wl-close:hover { color: var(--acid) !important; }
      `}</style>

      <div
        ref={dialogRef}
        style={{
          width: "min(720px, 100%)",
          maxHeight: "calc(100vh - 80px)",
          overflowY: "auto",
          background: "var(--bg)",
          border: "1px solid var(--line-strong)",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.6), 0 30px 80px rgba(0,0,0,0.6)",
          padding: "0",
          position: "relative",
          animation: "wl-rise .22s ease-out",
        }}
      >
        {/* Top masthead */}
        <div style={{
          padding: "20px 32px 14px",
          borderBottom: "3px double var(--line-strong)",
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          gap: 12,
        }}>
          <div className="mono-sm" style={{ color: "var(--ink-4)", letterSpacing: "0.16em" }}>
            № 001 · Q2 · 2026
          </div>
          <div className="mono-sm" style={{ color: "var(--acid)", letterSpacing: "0.2em", textAlign: "center" }}>
            ── INVITATION ──
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="wl-close"
              style={{
                fontFamily: "var(--mono)",
                fontSize: 18,
                color: "var(--ink-3)",
                lineHeight: 1,
                padding: "6px 10px",
                border: "1px solid var(--line-strong)",
                background: "transparent",
              }}
            >
              ×
            </button>
          </div>
        </div>

        {step === "form" ? (
          <form onSubmit={submit} style={{ padding: "36px 40px 40px" }}>
            <div className="mono-sm" style={{ color: "var(--ink-4)", letterSpacing: "0.16em", marginBottom: 12 }}>
              ── REQUEST AN INVITATION ──
            </div>
            <h2 id="wl-title" style={{
              fontFamily: "var(--serif)",
              fontSize: 56,
              lineHeight: 0.98,
              letterSpacing: "-0.035em",
              marginBottom: 14,
            }}>
              Join the <em style={{ color: "var(--acid)", fontStyle: "italic" }}>waitlist.</em>
            </h2>
            <p className="body" style={{ fontSize: 15, maxWidth: 520, marginBottom: 32 }}>
              Twenty teams in the first cohort. We onboard one company at a time so the
              distillation actually fits. Tell us a little about yours.
            </p>

            {/* Email + Company */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, marginBottom: 28 }}>
              <div>
                <label style={labelMono} htmlFor="wl-email">▸ Work email</label>
                <input
                  id="wl-email"
                  className="wl-input"
                  type="email"
                  required
                  placeholder="you@company.com"
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  onFocus={(e) => Object.assign(e.target.style, inputFocus)}
                  onBlur={(e) => { e.target.style.borderBottomColor = "var(--line-strong)"; }}
                  style={inputBase}
                />
                {touched && !emailValid && (
                  <div className="mono-sm" style={{ color: "var(--warn)", marginTop: 6, fontSize: 11 }}>
                    A real work email, please.
                  </div>
                )}
              </div>
              <div>
                <label style={labelMono} htmlFor="wl-company">▸ Company</label>
                <input
                  id="wl-company"
                  className="wl-input"
                  type="text"
                  required
                  placeholder="Acme Robotics"
                  value={form.company}
                  onChange={(e) => set("company", e.target.value)}
                  onFocus={(e) => Object.assign(e.target.style, inputFocus)}
                  onBlur={(e) => { e.target.style.borderBottomColor = "var(--line-strong)"; }}
                  style={inputBase}
                />
                {touched && form.company.trim().length === 0 && (
                  <div className="mono-sm" style={{ color: "var(--warn)", marginTop: 6, fontSize: 11 }}>
                    Required.
                  </div>
                )}
              </div>
            </div>

            {/* Seats */}
            <div style={{ marginBottom: 28 }}>
              <label style={labelMono}>▸ Engineers on AI tools</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {["1–10", "11–25", "26–75", "76–200", "200+"].map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    className="wl-pill"
                    data-active={form.seats === opt}
                    onClick={() => set("seats", opt)}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>

            {/* Role */}
            <div style={{ marginBottom: 28 }}>
              <label style={labelMono}>▸ Your role</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {["Engineer", "Eng Lead", "CTO / VP Eng", "Security", "Other"].map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    className="wl-pill"
                    data-active={form.role === opt}
                    onClick={() => set("role", opt)}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div style={{ marginBottom: 32 }}>
              <label style={labelMono} htmlFor="wl-notes">▸ Anything we should know? <span style={{ textTransform: "none", color: "var(--ink-5)", letterSpacing: 0 }}>(optional)</span></label>
              <textarea
                id="wl-notes"
                className="wl-input"
                rows={3}
                placeholder="Stack, monthly AI spend, hardware, deal-breakers…"
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
                onFocus={(e) => Object.assign(e.target.style, inputFocus)}
                onBlur={(e) => { e.target.style.borderBottomColor = "var(--line-strong)"; }}
                style={{
                  ...inputBase,
                  fontFamily: "var(--sans)",
                  fontSize: 15,
                  resize: "vertical",
                  lineHeight: 1.5,
                  padding: "10px 0",
                }}
              />
            </div>

            {/* Footer / actions */}
            <div style={{
              borderTop: "3px double var(--line-strong)",
              paddingTop: 24,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 16,
              flexWrap: "wrap",
            }}>
              <div className="mono-sm" style={{ color: "var(--ink-4)", letterSpacing: "0.12em", fontSize: 11 }}>
                <span style={{ color: "var(--acid)" }}>20 SLOTS</span> · Q2 2026 · WE ANSWER OURSELVES
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-ghost"
                  style={{ borderRadius: 0 }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-acid"
                  style={{
                    borderRadius: 0,
                    opacity: canSubmit ? 1 : 0.5,
                    cursor: canSubmit ? "pointer" : "not-allowed",
                  }}
                >
                  Request invitation →
                </button>
              </div>
            </div>
          </form>
        ) : (
          <div style={{ padding: "56px 40px 48px", textAlign: "center" }}>
            <div className="mono-sm" style={{ color: "var(--acid)", letterSpacing: "0.2em", marginBottom: 18 }}>
              ── RECEIVED ──
            </div>
            <h2 style={{
              fontFamily: "var(--serif)",
              fontSize: 64,
              lineHeight: 1,
              letterSpacing: "-0.035em",
              marginBottom: 18,
            }}>
              Thank you, <em style={{ color: "var(--acid)", fontStyle: "italic" }}>truly.</em>
            </h2>
            <p className="body-lg" style={{ maxWidth: 460, margin: "0 auto 28px" }}>
              We've added <span style={{ fontFamily: "var(--mono)", color: "var(--acid)" }}>{form.email}</span> to
              the dispatch list. Maya or Kostas will write back within two business days —
              from a real inbox, not a sequence.
            </p>

            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              maxWidth: 480,
              margin: "32px auto 0",
              borderTop: "1px solid var(--line)",
              borderBottom: "1px solid var(--line)",
              padding: "20px 0",
            }}>
              {[
                ["№", "—", "your slot"],
                ["WAVE", "Q2", "2026"],
                ["NEXT", "EMAIL", "from us"],
              ].map(([l, n, s], i) => (
                <div key={i} style={{ borderRight: i < 2 ? "1px solid var(--line)" : "none" }}>
                  <div className="mono-sm" style={{ color: "var(--ink-4)", letterSpacing: "0.14em", fontSize: 10 }}>{l}</div>
                  <div style={{ fontFamily: "var(--serif)", fontSize: 28, marginTop: 4 }}>{n}</div>
                  <div className="mono-sm" style={{ color: "var(--ink-4)", marginTop: 4, fontSize: 10 }}>{s}</div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 36 }}>
              <button
                type="button"
                className="btn-ghost"
                onClick={onClose}
                style={{ borderRadius: 0 }}
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/* ---------- Global host: lets any button call window.openWaitlist() ---------- */
const WaitlistHost = () => {
  const [open, setOpen] = useStateWL(false);

  useEffectWL(() => {
    window.openWaitlist = () => setOpen(true);
    window.closeWaitlist = () => setOpen(false);

    // Click delegation: any element with [data-waitlist] opens the modal.
    const onClick = (e) => {
      const el = e.target.closest && e.target.closest("[data-waitlist]");
      if (el) {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  return <WaitlistModal open={open} onClose={() => setOpen(false)} />;
};

Object.assign(window, { WaitlistModal, WaitlistHost });
