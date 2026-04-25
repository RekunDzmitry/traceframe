// Wiki + Code Graph views — top-level navigation alongside the trace view.

const { useState: useWS, useMemo: useWM } = React;

// ───────── WIKI ─────────
const WIKI_PAGES = {
  "README": {
    title: "acme/web",
    tags: ["root", "overview"],
    updated: "2026-04-18",
    body: `# acme/web

Monorepo for the Acme customer-facing app. Built on Next.js 15 with a Hono auth proxy.

## Architecture
The frontend lives in \`app/\` with server components; auth is delegated to the [[SSO Proxy]].
Session state uses signed cookies (see [[Cookie Policy]]).

## Onboarding
- Run \`pnpm i && pnpm dev\`
- Hit localhost:3000
- Read [[Runbook: Auth]] before touching middleware

## Active incidents
- [[INC-142 SSO redirect loop]] — fixing now via trc_9f2a
`,
    links: ["SSO Proxy", "Cookie Policy", "Runbook: Auth", "INC-142 SSO redirect loop"],
  },
  "SSO Proxy": {
    title: "SSO Proxy",
    tags: ["auth", "service"],
    updated: "2026-04-12",
    body: `# SSO Proxy

Sits at \`auth.acme.com\`. Handles OIDC handshake with Okta and issues session cookies.

## Flow
1. User hits app.acme.com → middleware checks \`sid\` cookie
2. If missing → 302 to auth.acme.com/login
3. Okta callback → auth.acme.com/callback sets \`sid\` cookie
4. 302 back to app.acme.com

See [[Cookie Policy]] for domain rules.
Related trace: trc_9f2a.`,
    links: ["Cookie Policy"],
  },
  "Cookie Policy": {
    title: "Cookie Policy",
    tags: ["auth", "security"],
    updated: "2026-04-20",
    body: `# Cookie Policy

**Canonical domain for all session cookies: \`.acme.com\`** (parent domain).

This ensures \`auth.acme.com\` and \`app.acme.com\` share the same \`sid\`.

> ⚠ Historical bug: setting domain to \`.auth.acme.com\` caused the redirect loop fixed in trc_9f2a.

Use \`src/lib/cookies.ts\` → \`setSessionCookie()\` — never call \`cookies.set\` directly.`,
    links: ["SSO Proxy"],
  },
  "Runbook: Auth": {
    title: "Runbook: Auth",
    tags: ["runbook"],
    updated: "2026-03-29",
    body: `# Runbook: Auth incidents

## Symptom: redirect loop
1. Check [[Cookie Policy]] — domain should be \`.acme.com\`
2. Inspect Set-Cookie header on /callback response
3. Curl middleware with/without cookie

## Symptom: 401 on every request
- Check Okta app config didn't rotate

Link to trace: trc_9f2a.`,
    links: ["Cookie Policy"],
  },
  "INC-142 SSO redirect loop": {
    title: "INC-142 — SSO redirect loop",
    tags: ["incident", "p1", "resolved"],
    updated: "2026-04-20",
    body: `# INC-142 — SSO redirect loop

**Status:** 🟢 resolved · **Owner:** agent (trc_9f2a)

## Summary
After SSO, users bounced between /callback and /login indefinitely.

## Root cause
Cookie domain on \`src/pages/auth/callback.ts:47\` was \`.auth.acme.com\`; app runs on \`app.acme.com\`. Browser dropped the cookie.

## Fix
Changed to \`.acme.com\`. Verified with full auth suite. See [[Cookie Policy]].

## Follow-ups
- Centralize cookie config (branch trc_9f2a/n4b proposed this)
- Add regression test for cross-subdomain session`,
    links: ["Cookie Policy", "SSO Proxy"],
  },
  "Agent playbook": {
    title: "Agent playbook",
    tags: ["agent"],
    updated: "2026-04-15",
    body: `# Agent playbook

How our coding agent approaches issues.

1. **Plan** — read issue, form hypotheses ranked by probability
2. **Locate** — glob/grep for relevant files
3. **Understand** — read full files when small, windows when large
4. **Diagnose** — pick the narrowest hypothesis, verify
5. **Patch** — smallest viable change
6. **Verify** — targeted tests first, then full suite

See [[Runbook: Auth]] for incident-specific playbooks.`,
    links: ["Runbook: Auth"],
  },
};

function WikiView() {
  const slugs = Object.keys(WIKI_PAGES);
  const [active, setActive] = useWS("README");
  const [q, setQ] = useWS("");

  const filtered = slugs.filter(
    (s) => s.toLowerCase().includes(q.toLowerCase()) || WIKI_PAGES[s].body.toLowerCase().includes(q.toLowerCase())
  );

  const page = WIKI_PAGES[active];
  const backlinks = slugs.filter((s) => s !== active && WIKI_PAGES[s].links?.includes(active));

  // Render body: markdown-lite with [[links]]
  const renderBody = (body) => {
    const lines = body.split("\n");
    return lines.map((ln, i) => {
      if (ln.startsWith("# ")) return <h1 key={i} className="w-h1">{ln.slice(2)}</h1>;
      if (ln.startsWith("## ")) return <h2 key={i} className="w-h2">{ln.slice(3)}</h2>;
      if (ln.startsWith("> ")) return <blockquote key={i} className="w-bq">{parseInline(ln.slice(2), setActive)}</blockquote>;
      if (/^\d+\.\s/.test(ln)) return <li key={i} className="w-ol">{parseInline(ln.replace(/^\d+\.\s/, ""), setActive)}</li>;
      if (ln.startsWith("- ")) return <li key={i} className="w-ul">{parseInline(ln.slice(2), setActive)}</li>;
      if (ln.trim() === "") return <div key={i} className="w-br" />;
      return <p key={i} className="w-p">{parseInline(ln, setActive)}</p>;
    });
  };

  return (
    <div className="wiki">
      <aside className="wiki-sidebar">
        <div className="wiki-search">
          <input
            placeholder="Search pages…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="wiki-list">
          {filtered.map((s) => (
            <div
              key={s}
              className={`wiki-item ${active === s ? "is-active" : ""}`}
              onClick={() => setActive(s)}
            >
              <div className="wiki-item-title">{WIKI_PAGES[s].title}</div>
              <div className="wiki-item-meta mono">
                {WIKI_PAGES[s].tags.slice(0, 2).join(" · ")}
              </div>
            </div>
          ))}
        </div>
      </aside>

      <div className="wiki-main">
        <div className="wiki-breadcrumb">
          <span className="mono muted">/ wiki / {page.title}</span>
          <span className="wiki-tags">
            {page.tags.map((t) => <span key={t} className="wiki-tag mono">#{t}</span>)}
          </span>
          <span className="mono muted">updated {page.updated}</span>
        </div>
        <div className="wiki-body">{renderBody(page.body)}</div>
        {backlinks.length > 0 && (
          <div className="wiki-backlinks">
            <div className="section-label">Linked from ({backlinks.length})</div>
            {backlinks.map((b) => (
              <div key={b} className="backlink" onClick={() => setActive(b)}>
                ← {WIKI_PAGES[b].title}
              </div>
            ))}
          </div>
        )}
      </div>

      <aside className="wiki-graph">
        <div className="section-label" style={{ padding: "10px 12px 4px" }}>Local graph</div>
        <WikiGraph active={active} onNavigate={setActive} />
      </aside>
    </div>
  );
}

function parseInline(text, navigate) {
  // [[wikilinks]]
  const parts = [];
  let last = 0;
  const re = /\[\[([^\]]+)\]\]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const key = m[1];
    parts.push(
      <span key={m.index} className="wikilink" onClick={() => navigate(key)}>{key}</span>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function WikiGraph({ active, onNavigate }) {
  // Force-directed-ish layout, precomputed positions per page.
  const slugs = Object.keys(WIKI_PAGES);
  const positions = useWM(() => {
    const pos = {};
    slugs.forEach((s, i) => {
      const a = (i / slugs.length) * Math.PI * 2;
      pos[s] = { x: 120 + Math.cos(a) * 72, y: 130 + Math.sin(a) * 72 };
    });
    // Center the active
    pos[active] = { x: 120, y: 130 };
    return pos;
  }, [active, slugs.length]);

  const edges = [];
  slugs.forEach((s) => {
    (WIKI_PAGES[s].links || []).forEach((l) => {
      if (WIKI_PAGES[l]) edges.push([s, l]);
    });
  });

  return (
    <svg viewBox="0 0 240 260" width="100%" style={{ padding: 8 }}>
      {edges.map(([a, b], i) => {
        const pa = positions[a], pb = positions[b];
        const hl = a === active || b === active;
        return <line key={i} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke={hl ? "var(--accent-green)" : "var(--border)"} strokeWidth={hl ? 1 : 0.6} />;
      })}
      {slugs.map((s) => {
        const p = positions[s];
        const isActive = s === active;
        return (
          <g key={s} transform={`translate(${p.x},${p.y})`} onClick={() => onNavigate(s)} style={{ cursor: "pointer" }}>
            <circle r={isActive ? 5 : 3.5} fill={isActive ? "var(--accent-green)" : "var(--surface)"} stroke="var(--ink)" strokeWidth={isActive ? 1.2 : 0.8} />
            <text y={-8} textAnchor="middle" fontSize="8" fontFamily="var(--font-mono)" fill={isActive ? "var(--ink)" : "var(--muted)"}>{s.slice(0, 14)}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ───────── CODE GRAPH (AST / semantic model) ─────────
const CODE_NODES = [
  { id: "auth.ts",       label: "auth.ts",       kind: "module", x: 160, y: 80 },
  { id: "callback.ts",   label: "callback.ts",   kind: "module", x: 380, y: 80 },
  { id: "login.ts",      label: "login.ts",      kind: "module", x: 560, y: 160 },
  { id: "session.ts",    label: "session.ts",    kind: "module", x: 280, y: 240 },
  { id: "cookies.ts",    label: "cookies.ts",    kind: "module", x: 480, y: 260 },

  { id: "isValidSession",kind: "fn",     parent: "auth.ts",     label: "isValidSession", x: 80,  y: 40 },
  { id: "middleware",    kind: "fn",     parent: "auth.ts",     label: "middleware",     x: 240, y: 40, hot: true },
  { id: "setSid",        kind: "fn",     parent: "callback.ts", label: "setSid",         x: 380, y: 40, warn: true },
  { id: "handleCallback",kind: "fn",     parent: "callback.ts", label: "handleCallback", x: 480, y: 140 },
  { id: "signSession",   kind: "fn",     parent: "session.ts",  label: "signSession",    x: 200, y: 280 },
  { id: "verifySession", kind: "fn",     parent: "session.ts",  label: "verifySession",  x: 340, y: 300 },
  { id: "COOKIE_DOMAIN", kind: "const",  parent: "cookies.ts",  label: "COOKIE_DOMAIN",  x: 560, y: 320 },
];
const CODE_EDGES = [
  ["middleware", "isValidSession", "calls"],
  ["isValidSession", "verifySession", "calls"],
  ["handleCallback", "setSid", "calls"],
  ["setSid", "signSession", "calls"],
  ["verifySession", "signSession", "uses"],
  ["setSid", "COOKIE_DOMAIN", "reads", "proposed"],
  ["middleware", "setSid", "redirect-loop", "bug"],
];

function CodeGraphView() {
  const [hover, setHover] = useWS(null);
  const [sel, setSel] = useWS("setSid");

  const node = CODE_NODES.find((n) => n.id === sel);

  return (
    <div className="codegraph">
      <aside className="cg-side">
        <div className="section-label" style={{ padding: "10px 12px 4px" }}>Symbols</div>
        <div className="cg-tree">
          {CODE_NODES.filter((n) => n.kind === "module").map((m) => (
            <div key={m.id}>
              <div className="cg-module mono">◫ {m.label}</div>
              {CODE_NODES.filter((n) => n.parent === m.id).map((fn) => (
                <div
                  key={fn.id}
                  className={`cg-symbol mono ${sel === fn.id ? "is-sel" : ""}`}
                  onClick={() => setSel(fn.id)}
                >
                  <span className={`cg-marker cg-marker-${fn.kind}`}>
                    {fn.kind === "fn" ? "ƒ" : fn.kind === "const" ? "k" : "•"}
                  </span>
                  {fn.label}
                  {fn.hot && <span className="cg-badge cg-badge-hot">hot</span>}
                  {fn.warn && <span className="cg-badge cg-badge-warn">warn</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="section-label" style={{ padding: "10px 12px 4px" }}>Legend</div>
        <div className="cg-legend mono">
          <div><span className="cg-marker cg-marker-fn">ƒ</span> function</div>
          <div><span className="cg-marker cg-marker-const">k</span> constant</div>
          <div><span className="cg-edge-demo" /> calls</div>
          <div><span className="cg-edge-demo cg-edge-bug" /> bug path</div>
          <div><span className="cg-edge-demo cg-edge-proposed" /> proposed (trc_9f2a/n4b)</div>
        </div>
      </aside>

      <div className="cg-canvas">
        <svg width="100%" height="100%" viewBox="0 0 700 420" preserveAspectRatio="xMidYMid meet">
          <defs>
            <marker id="cg-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--muted)" />
            </marker>
            <marker id="cg-arrow-bug" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--accent-red)" />
            </marker>
          </defs>
          {/* Module containers */}
          {CODE_NODES.filter((n) => n.kind === "module").map((m) => {
            const kids = CODE_NODES.filter((k) => k.parent === m.id);
            if (!kids.length) return null;
            const xs = kids.map((k) => k.x);
            const ys = kids.map((k) => k.y);
            const minX = Math.min(...xs) - 40, maxX = Math.max(...xs) + 40;
            const minY = Math.min(...ys) - 20, maxY = Math.max(...ys) + 20;
            return (
              <g key={m.id}>
                <rect x={minX} y={minY} width={maxX - minX} height={maxY - minY} rx={6}
                      fill="var(--surface)" stroke="var(--border)" strokeDasharray="3 3" />
                <text x={minX + 8} y={minY + 14} fontSize="9" fontFamily="var(--font-mono)" fill="var(--muted)">{m.label}</text>
              </g>
            );
          })}
          {/* Edges */}
          {CODE_EDGES.map(([a, b, kind, tag], i) => {
            const na = CODE_NODES.find((n) => n.id === a);
            const nb = CODE_NODES.find((n) => n.id === b);
            if (!na || !nb) return null;
            const isBug = tag === "bug";
            const isProposed = tag === "proposed";
            return (
              <g key={i}>
                <line
                  x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
                  stroke={isBug ? "var(--accent-red)" : isProposed ? "var(--accent-amber)" : "var(--muted)"}
                  strokeWidth={isBug ? 1.5 : 0.8}
                  strokeDasharray={isProposed ? "3 3" : isBug ? "0" : "0"}
                  markerEnd={isBug ? "url(#cg-arrow-bug)" : "url(#cg-arrow)"}
                  opacity={isBug ? 0.9 : 0.7}
                />
                <text
                  x={(na.x + nb.x) / 2} y={(na.y + nb.y) / 2 - 3}
                  fontSize="8" fontFamily="var(--font-mono)"
                  fill={isBug ? "var(--accent-red)" : "var(--muted)"}
                  textAnchor="middle"
                >
                  {kind}
                </text>
              </g>
            );
          })}
          {/* Function nodes */}
          {CODE_NODES.filter((n) => n.kind !== "module").map((n) => {
            const isSel = sel === n.id;
            const isHover = hover === n.id;
            return (
              <g key={n.id} transform={`translate(${n.x},${n.y})`}
                 onClick={() => setSel(n.id)} onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}
                 style={{ cursor: "pointer" }}>
                <rect x={-48} y={-11} width={96} height={22} rx={3}
                      fill={n.hot ? "var(--accent-green-soft)" : n.warn ? "var(--accent-red-soft)" : "var(--bg)"}
                      stroke={isSel ? "var(--ink)" : "var(--border-strong)"}
                      strokeWidth={isSel ? 1.5 : 1} />
                <text textAnchor="middle" y={3} fontSize="10" fontFamily="var(--font-mono)" fill="var(--ink)">
                  {n.kind === "fn" ? "ƒ " : n.kind === "const" ? "k " : ""}{n.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <aside className="cg-detail">
        {node && (
          <>
            <div className="panel-header" style={{ padding: "10px 12px" }}>
              <div className="panel-title">
                <span className="mono">{node.kind === "fn" ? "ƒ" : "k"} {node.label}</span>
              </div>
            </div>
            <div className="cg-detail-body">
              <KV k="file" v={node.parent} mono />
              <KV k="kind" v={node.kind} mono />
              <KV k="callers" v={CODE_EDGES.filter(([,b]) => b === node.id).length} mono />
              <KV k="callees" v={CODE_EDGES.filter(([a]) => a === node.id).length} mono />
              <div style={{ marginTop: 12 }} className="section-label">Signature</div>
              <pre className="cg-signature mono">
{node.id === "setSid" ? `function setSid(token: string, res: Response): void`
: node.id === "middleware" ? `async function middleware(req: Request): Promise<Response>`
: node.id === "isValidSession" ? `function isValidSession(req: Request): boolean`
: node.id === "COOKIE_DOMAIN" ? `const COOKIE_DOMAIN: string = ".acme.com"`
: `// signature unavailable`}
              </pre>
              <div style={{ marginTop: 12 }} className="section-label">Touched by traces</div>
              <div className="cg-touch">
                <div className="mono">· trc_9f2a (main fix)</div>
                <div className="mono muted">· trc_9f2a/n4b (proposed refactor)</div>
              </div>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

window.WikiView = WikiView;
window.CodeGraphView = CodeGraphView;
