// Branch experiment panel — slide-in from right of node detail.
// Multi-variant: each tab is an independent BranchExperimentSpec.
// Submit fans out N parallel runs to POST /branch/run via App's onSubmit.
const { useState: useState_B } = React;

const MODELS = [
  { id: "qwen3.6-plus",      provider: "opencode-go", in: 3,    out: 15  },
  { id: "deepseek-v4-flash", provider: "opencode-go", in: 0.4,  out: 1.6 },
];

// Build the full context chain from node's ancestors.
// Each ancestor contributes: (optional) system (first only), user msg, assistant output, tool_results.
function buildContextChain(node, allNodes) {
  const chain = [];
  let cur = node;
  const path = [];
  while (cur) {
    path.unshift(cur);
    cur = allNodes.find((n) => n.id === cur.parent);
  }
  chain.push({
    role: "system",
    content: "You are a coding agent working on acme/web. Diagnose issues, read files, make minimal patches, and verify with tests.",
    enabled: true,
    source: "system",
  });
  path.forEach((n, i) => {
    const userMatch = n.input && n.input.match(/<user>([\s\S]*?)<\/user>/);
    if (userMatch) {
      chain.push({ role: "user", content: userMatch[1].trim(), enabled: true, source: n.id });
    }
    (n.toolCalls || []).forEach((t) => {
      chain.push({
        role: "tool_result",
        content: `${t.name}(${JSON.stringify(t.args)}) → ${t.result}`,
        enabled: true,
        source: n.id,
      });
    });
    if (i < path.length - 1 && n.output) {
      chain.push({ role: "assistant", content: n.output, enabled: true, source: n.id });
    }
  });
  return chain;
}

const variantLabel = (i) => `variant ${String.fromCharCode(65 + i)}`;
const cloneCtx = (ctx) => ctx.map((c) => ({ ...c }));

function BranchPanel({ node, onClose, onSubmit, onSaveTemplate, allNodes, initialSpecs }) {
  const initialUserMsg = (() => {
    const m = node.input && node.input.match(/<user>([\s\S]*?)<\/user>/);
    return m ? m[1].trim() : "Diagnose the issue.";
  })();

  const makeDefaultVariants = () => {
    const baseCtx = buildContextChain(node, allNodes);
    return [
      {
        label: variantLabel(0),
        model: MODELS[0].id,
        temp: 0.3,
        topP: 0.95,
        userMsg: initialUserMsg,
        branchKind: "experiment",
        ctx: cloneCtx(baseCtx),
      },
    ];
  };

  const fromSpecs = (specs) =>
    specs.map((spec, i) => ({
      label: spec.label || variantLabel(i),
      model: spec.model || MODELS[0].id,
      temp: typeof spec.temperature === "number" ? spec.temperature : 0.3,
      topP: typeof spec.topP === "number" ? spec.topP : 0.95,
      userMsg: spec.userMessage || "",
      branchKind: spec.branchKind || "experiment",
      ctx: (spec.context || []).map((c) => ({
        ...c,
        enabled: c.enabled !== false,
      })),
    }));

  const [variants, setVariants] = useState_B(() =>
    initialSpecs && initialSpecs.length ? fromSpecs(initialSpecs) : makeDefaultVariants()
  );
  const [activeIdx, setActiveIdx] = useState_B(0);
  const [collapsedIds, setCollapsedIds] = useState_B(new Set());
  const [addingMsg, setAddingMsg] = useState_B(false);
  const [newMsg, setNewMsg] = useState_B({ role: "user", content: "" });
  const [saving, setSaving] = useState_B(false);
  const [submitting, setSubmitting] = useState_B(false);

  const v = variants[activeIdx];
  const setActive = (patch) =>
    setVariants((arr) => arr.map((x, i) => (i === activeIdx ? { ...x, ...patch } : x)));

  const setCtx = (fn) => setActive({ ctx: fn(v.ctx) });
  const toggleMsg = (i) =>
    setCtx((arr) => arr.map((m, j) => (j === i ? { ...m, enabled: !m.enabled } : m)));
  const removeMsg = (i) => setCtx((arr) => arr.filter((_, j) => j !== i));
  const editMsg = (i, content) =>
    setCtx((arr) => arr.map((m, j) => (j === i ? { ...m, content } : m)));
  const toggleCollapse = (i) =>
    setCollapsedIds((s) => {
      const next = new Set(s);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  const addVariant = () => {
    if (variants.length >= 6) return;
    const next = variants.length;
    setVariants((arr) => [
      ...arr,
      { ...v, ctx: cloneCtx(v.ctx), label: variantLabel(next) },
    ]);
    setActiveIdx(next);
    setCollapsedIds(new Set());
  };
  const removeVariant = (i) => {
    if (variants.length <= 1) return;
    setVariants((arr) => arr.filter((_, j) => j !== i));
    setActiveIdx((idx) => Math.max(0, Math.min(idx, variants.length - 2)));
  };

  const variantToSpec = (vv) => ({
    label: vv.label,
    branchKind: vv.branchKind,
    model: vv.model,
    provider: (MODELS.find((m) => m.id === vv.model) || {}).provider || "opencode-go",
    temperature: vv.temp,
    topP: vv.topP,
    userMessage: vv.userMsg,
    context: vv.ctx,
  });

  const m = MODELS.find((x) => x.id === v.model) || { in: 3, out: 15 };
  const estInTok =
    v.ctx.filter((c) => c.enabled !== false).reduce((a, c) => a + c.content.length / 4, 0) +
    v.userMsg.length / 4;
  const estOutTok = 600;
  const estCostThis = (estInTok * m.in + estOutTok * m.out) / 1_000_000;
  const totalCost = variants.reduce((sum, vv) => {
    const mm = MODELS.find((x) => x.id === vv.model) || { in: 3, out: 15 };
    const tokIn =
      vv.ctx.filter((c) => c.enabled !== false).reduce((a, c) => a + c.content.length / 4, 0) +
      vv.userMsg.length / 4;
    return sum + (tokIn * mm.in + estOutTok * mm.out) / 1_000_000;
  }, 0);

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(variants.map(variantToSpec));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveTemplate = async () => {
    if (!onSaveTemplate) return;
    const name = window.prompt("Template name", `branch-${variants.length}var`);
    if (!name) return;
    setSaving(true);
    try {
      await onSaveTemplate({ name, specs: variants.map(variantToSpec) });
    } catch (e) {
      window.alert("save failed: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="branch-panel">
      <div className="panel-header">
        <div className="panel-title">
          <span className="branch-dot" />
          <span>
            Branch from <span className="mono">{node.id}</span>
          </span>
          <span className="muted" style={{ marginLeft: 8 }}>
            {variants.length} variant{variants.length > 1 ? "s" : ""}
          </span>
        </div>
        <div className="panel-actions">
          <button className="icon-btn" onClick={onClose} title="close">✕</button>
        </div>
      </div>

      <div className="variant-tabs">
        {variants.map((vv, i) => (
          <button
            key={i}
            className={`variant-tab ${i === activeIdx ? "is-active" : ""}`}
            onClick={() => {
              setActiveIdx(i);
              setCollapsedIds(new Set());
            }}
            title={`${vv.model} · ${vv.label}`}
          >
            <span className="variant-tab-letter">{String.fromCharCode(65 + i)}</span>
            <span className="variant-tab-model mono">{vv.model}</span>
            {variants.length > 1 && (
              <span
                className="variant-tab-x"
                onClick={(e) => {
                  e.stopPropagation();
                  removeVariant(i);
                }}
              >
                ×
              </span>
            )}
          </button>
        ))}
        {variants.length < 6 && (
          <button className="variant-tab variant-tab-add" onClick={addVariant}>
            + add variant
          </button>
        )}
      </div>

      <div className="branch-body">
        <section className="branch-section">
          <div className="section-label">Model</div>
          <div className="model-grid">
            {MODELS.map((mm) => (
              <button
                key={mm.id}
                className={`model-card ${v.model === mm.id ? "is-selected" : ""}`}
                onClick={() => setActive({ model: mm.id })}
              >
                <div className="model-name mono">{mm.id}</div>
                <div className="model-meta mono">
                  <span>{mm.provider}</span>
                  <span>·</span>
                  <span>${mm.in}/{mm.out}</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="branch-section">
          <div className="row-2">
            <div>
              <div className="section-label">
                Temperature <span className="mono muted">{v.temp.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={v.temp}
                onChange={(e) => setActive({ temp: +e.target.value })}
                className="slider"
              />
            </div>
            <div>
              <div className="section-label">
                Top-p <span className="mono muted">{v.topP.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={v.topP}
                onChange={(e) => setActive({ topP: +e.target.value })}
                className="slider"
              />
            </div>
          </div>
        </section>

        <section className="branch-section">
          <div className="section-head">
            <div className="section-label">
              Context · {v.ctx.filter((m) => m.enabled !== false).length}/{v.ctx.length} enabled
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <button className="chip-mini" onClick={() => setCollapsedIds(new Set(v.ctx.map((_, i) => i)))}>
                collapse all
              </button>
              <button className="chip-mini" onClick={() => setCollapsedIds(new Set())}>
                expand all
              </button>
              <button className="chip-mini" onClick={() => setAddingMsg(true)}>+ add</button>
            </div>
          </div>
          <div className="ctx-hint muted mono">
            per-variant · edits to other variants don't affect this one
          </div>
          <div className="msg-list">
            {v.ctx.map((m, i) => {
              const collapsed = collapsedIds.has(i);
              const tok = Math.round(m.content.length / 4);
              const enabled = m.enabled !== false;
              return (
                <div key={i} className={`msg ${!enabled ? "msg-off" : ""}`}>
                  <div className="msg-head">
                    <input type="checkbox" checked={enabled} onChange={() => toggleMsg(i)} />
                    <span className={`role-tag role-${m.role.replace("_", "")}`}>{m.role}</span>
                    {m.source && m.source !== "system" && (
                      <span className="mono muted" style={{ fontSize: 10 }}>from {m.source}</span>
                    )}
                    <span className="mono muted" style={{ fontSize: 10 }}>~{tok}t</span>
                    <div style={{ flex: 1 }} />
                    <button
                      className="icon-btn-sm"
                      onClick={() => toggleCollapse(i)}
                      title={collapsed ? "expand" : "collapse"}
                    >
                      {collapsed ? "▸" : "▾"}
                    </button>
                    <button className="icon-btn-sm" onClick={() => removeMsg(i)}>✕</button>
                  </div>
                  {!collapsed && (
                    <textarea
                      className="msg-body mono"
                      value={m.content}
                      rows={Math.min(10, Math.max(2, m.content.split("\n").length + 1))}
                      onChange={(e) => editMsg(i, e.target.value)}
                    />
                  )}
                  {collapsed && (
                    <div className="msg-preview mono">
                      {m.content.slice(0, 80)}{m.content.length > 80 ? "…" : ""}
                    </div>
                  )}
                </div>
              );
            })}
            {addingMsg && (
              <div className="msg msg-new">
                <div className="msg-head">
                  <select
                    value={newMsg.role}
                    onChange={(e) => setNewMsg({ ...newMsg, role: e.target.value })}
                  >
                    <option value="system">system</option>
                    <option value="user">user</option>
                    <option value="assistant">assistant</option>
                    <option value="tool_result">tool_result</option>
                  </select>
                  <div style={{ flex: 1 }} />
                  <button
                    className="chip-mini"
                    onClick={() => {
                      if (newMsg.content.trim()) {
                        setCtx((a) => [...a, { ...newMsg, enabled: true }]);
                        setNewMsg({ role: "user", content: "" });
                        setAddingMsg(false);
                      }
                    }}
                  >
                    add
                  </button>
                  <button className="icon-btn-sm" onClick={() => setAddingMsg(false)}>✕</button>
                </div>
                <textarea
                  className="msg-body mono"
                  rows={3}
                  placeholder="message content…"
                  value={newMsg.content}
                  onChange={(e) => setNewMsg({ ...newMsg, content: e.target.value })}
                />
              </div>
            )}
          </div>
        </section>

        <section className="branch-section">
          <div className="section-label">User message / task</div>
          <textarea
            className="msg-body mono user-msg"
            value={v.userMsg}
            rows={4}
            onChange={(e) => setActive({ userMsg: e.target.value })}
          />
        </section>

        <section className="branch-section estimate">
          <div className="estimate-row">
            <KV k="this variant" v={`$${estCostThis.toFixed(4)}`} mono />
            <KV k="total est." v={`$${totalCost.toFixed(4)}`} mono />
            <KV k="variants" v={`${variants.length}`} mono />
            <KV k="eta" v={`~${(estOutTok / 40).toFixed(1)}s/each`} mono />
          </div>
        </section>
      </div>

      <div className="branch-footer">
        <button className="btn btn-ghost" onClick={onClose} disabled={submitting}>
          cancel
        </button>
        <button className="btn btn-ghost" onClick={handleSaveTemplate} disabled={saving || submitting}>
          {saving ? "saving…" : "save as template"}
        </button>
        <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
          {submitting
            ? `running ${variants.length}…`
            : `↳ run ${variants.length} branch${variants.length > 1 ? "es" : ""}`}
        </button>
      </div>
    </div>
  );
}

window.BranchPanel = BranchPanel;
