// Branch experiment panel — slide-in from right of node detail
const { useState: useState_B } = React;

const MODELS = [
  { id: "claude-sonnet-4.5", provider: "anthropic", in: 3, out: 15 },
  { id: "claude-opus-4", provider: "anthropic", in: 15, out: 75 },
  { id: "claude-haiku-4.5", provider: "anthropic", in: 0.8, out: 4 },
  { id: "gpt-5", provider: "openai", in: 5, out: 20 },
  { id: "gpt-5-mini", provider: "openai", in: 0.25, out: 2 },
  { id: "gemini-2.5-pro", provider: "google", in: 2.5, out: 10 },
  { id: "llama-4-405b", provider: "meta", in: 3, out: 3 },
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
  // Root system prompt
  chain.push({
    role: "system",
    content: "You are a coding agent working on acme/web. Diagnose issues, read files, make minimal patches, and verify with tests.",
    enabled: true,
    source: "system",
  });
  path.forEach((n, i) => {
    // Extract user tag or treat input as user if first
    const userMatch = n.input && n.input.match(/<user>([\s\S]*?)<\/user>/);
    if (userMatch) {
      chain.push({ role: "user", content: userMatch[1].trim(), enabled: true, source: n.id });
    }
    // Tool results feeding this node
    (n.toolCalls || []).forEach((t) => {
      chain.push({
        role: "tool_result",
        content: `${t.name}(${JSON.stringify(t.args)}) → ${t.result}`,
        enabled: true,
        source: n.id,
      });
    });
    // Assistant output (don't include the target node's own output — that's what we're re-generating)
    if (i < path.length - 1 && n.output) {
      chain.push({ role: "assistant", content: n.output, enabled: true, source: n.id });
    }
  });
  return chain;
}

function BranchPanel({ node, onClose, onSubmit, allNodes }) {
  const [model, setModel] = useState_B("claude-opus-4");
  const [temp, setTemp] = useState_B(0.3);
  const [topP, setTopP] = useState_B(0.95);
  const userMatch = node.input && node.input.match(/<user>([\s\S]*?)<\/user>/);
  const [userMsg, setUserMsg] = useState_B(
    userMatch ? userMatch[1].trim() : "Diagnose the loop."
  );
  const [ctxMessages, setCtxMessages] = useState_B(() => buildContextChain(node, allNodes));
  const [collapsedIds, setCollapsedIds] = useState_B(new Set());
  const toggleCollapse = (i) => setCollapsedIds((s) => {
    const next = new Set(s); next.has(i) ? next.delete(i) : next.add(i); return next;
  });
  const [addingMsg, setAddingMsg] = useState_B(false);
  const [newMsg, setNewMsg] = useState_B({ role: "user", content: "" });

  const m = MODELS.find((x) => x.id === model);
  const estInTok = ctxMessages.filter((c) => c.enabled).reduce((a, c) => a + c.content.length / 4, 0) + userMsg.length / 4;
  const estOutTok = 600;
  const estCost = (estInTok * m.in + estOutTok * m.out) / 1_000_000;

  const toggleMsg = (i) => {
    setCtxMessages((arr) =>
      arr.map((m, j) => (j === i ? { ...m, enabled: !m.enabled } : m))
    );
  };
  const removeMsg = (i) => setCtxMessages((arr) => arr.filter((_, j) => j !== i));
  const editMsg = (i, content) =>
    setCtxMessages((arr) => arr.map((m, j) => (j === i ? { ...m, content } : m)));

  return (
    <div className="branch-panel">
      <div className="panel-header">
        <div className="panel-title">
          <span className="branch-dot" />
          <span>Branch from <span className="mono">{node.id}</span></span>
          <span className="muted" style={{ marginLeft: 8 }}>experiment</span>
        </div>
        <div className="panel-actions">
          <button className="icon-btn" onClick={onClose} title="close">✕</button>
        </div>
      </div>

      <div className="branch-body">
        <section className="branch-section">
          <div className="section-label">Model</div>
          <div className="model-grid">
            {MODELS.map((mm) => (
              <button
                key={mm.id}
                className={`model-card ${model === mm.id ? "is-selected" : ""}`}
                onClick={() => setModel(mm.id)}
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
                Temperature <span className="mono muted">{temp.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={temp}
                onChange={(e) => setTemp(+e.target.value)}
                className="slider"
              />
            </div>
            <div>
              <div className="section-label">
                Top-p <span className="mono muted">{topP.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={topP}
                onChange={(e) => setTopP(+e.target.value)}
                className="slider"
              />
            </div>
          </div>
        </section>

        <section className="branch-section">
          <div className="section-head">
            <div className="section-label">
              Full context · {ctxMessages.filter((m) => m.enabled).length}/{ctxMessages.length} enabled
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <button className="chip-mini" onClick={() => setCollapsedIds(new Set(ctxMessages.map((_,i)=>i)))}>collapse all</button>
              <button className="chip-mini" onClick={() => setCollapsedIds(new Set())}>expand all</button>
              <button className="chip-mini" onClick={() => setAddingMsg(true)}>+ add</button>
            </div>
          </div>
          <div className="ctx-hint muted mono">inherited from ancestors · every message editable</div>
          <div className="msg-list">
            {ctxMessages.map((m, i) => {
              const collapsed = collapsedIds.has(i);
              const tok = Math.round(m.content.length / 4);
              return (
              <div key={i} className={`msg ${!m.enabled ? "msg-off" : ""}`}>
                <div className="msg-head">
                  <input
                    type="checkbox"
                    checked={m.enabled}
                    onChange={() => toggleMsg(i)}
                  />
                  <span className={`role-tag role-${m.role.replace("_", "")}`}>{m.role}</span>
                  {m.source && m.source !== "system" && (
                    <span className="mono muted" style={{ fontSize: 10 }}>from {m.source}</span>
                  )}
                  <span className="mono muted" style={{ fontSize: 10 }}>~{tok}t</span>
                  <div style={{ flex: 1 }} />
                  <button className="icon-btn-sm" onClick={() => toggleCollapse(i)} title={collapsed ? "expand" : "collapse"}>{collapsed ? "▸" : "▾"}</button>
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
                  <div className="msg-preview mono">{m.content.slice(0, 80)}{m.content.length > 80 ? "…" : ""}</div>
                )}
              </div>
            );})}
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
                        setCtxMessages((a) => [...a, { ...newMsg, enabled: true }]);
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
            value={userMsg}
            rows={4}
            onChange={(e) => setUserMsg(e.target.value)}
          />
        </section>

        <section className="branch-section estimate">
          <div className="estimate-row">
            <KV k="est. input" v={`${Math.round(estInTok).toLocaleString()} tok`} mono />
            <KV k="est. output" v={`${estOutTok} tok`} mono />
            <KV k="est. cost" v={`$${estCost.toFixed(4)}`} mono />
            <KV k="eta" v={`~${(estOutTok / 40).toFixed(1)}s`} mono />
          </div>
        </section>
      </div>

      <div className="branch-footer">
        <button className="btn btn-ghost" onClick={onClose}>cancel</button>
        <button className="btn btn-ghost">save as template</button>
        <button className="btn btn-primary" onClick={() => onSubmit({ model, temp, topP })}>
          ↳ run branch
        </button>
      </div>
    </div>
  );
}

window.BranchPanel = BranchPanel;
