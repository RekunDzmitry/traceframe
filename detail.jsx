// Node detail panel — tabs: Decision, Context, Tools, Files, Compare
const { useState: useState_ND } = React;

function Pill({ children, tone }) {
  return <span className={`pill pill-${tone || "neutral"}`}>{children}</span>;
}

function KV({ k, v, mono }) {
  return (
    <div className="kv">
      <div className="kv-k">{k}</div>
      <div className={`kv-v ${mono ? "mono" : ""}`}>{v}</div>
    </div>
  );
}

function NodeDetail({ node, onBranch, branchOpen, allNodes }) {
  const [tab, setTab] = useState_ND("decision");
  const [decisionSub, setDecisionSub] = useState_ND("structured");

  if (!node) {
    return (
      <div className="detail-panel">
        <div className="empty">Select a node to inspect.</div>
      </div>
    );
  }

  const siblings = allNodes.filter((n) => n.parent === node.parent && n.id !== node.id);
  const parent = allNodes.find((n) => n.id === node.parent);

  return (
    <div className="detail-panel">
      <div className="panel-header">
        <div className="panel-title">
          <span className="breadcrumb">
            {parent && <span className="crumb">{parent.label}</span>}
            {parent && <span className="crumb-sep">›</span>}
            <span className="crumb crumb-active">{node.label}</span>
          </span>
        </div>
        <div className="panel-actions">
          <button
            className={`btn btn-primary ${branchOpen ? "is-active" : ""}`}
            onClick={onBranch}
          >
            {branchOpen ? "close branch" : "+ branch from here"}
          </button>
        </div>
      </div>

      <div className="node-summary">
        <div className="node-summary-main">
          <div className="node-id mono">{node.id}</div>
          <div className="node-label">{node.summary}</div>
        </div>
        <div className="node-stats">
          <KV k="model" v={node.model} mono />
          <KV k="tokens in" v={node.inputTokens.toLocaleString()} mono />
          <KV k="tokens out" v={node.outputTokens.toLocaleString()} mono />
          <KV k="cost" v={`$${node.cost.toFixed(3)}`} mono />
          <KV k="latency" v={`${(node.latency / 1000).toFixed(2)}s`} mono />
          <KV k="ttft" v={`${node.ttft}ms`} mono />
        </div>
      </div>

      <div className="tabs">
        {[
          ["decision", "Decision"],
          ["context", "Context"],
          ["tools", "Tools"],
          ["files", "Files"],
          ["compare", `Compare${siblings.length ? ` · ${siblings.length}` : ""}`],
          ["raw", "Raw"],
        ].map(([k, l]) => (
          <button
            key={k}
            className={`tab ${tab === k ? "tab-active" : ""}`}
            onClick={() => setTab(k)}
          >
            {l}
          </button>
        ))}
      </div>

      <div className="tab-body">
        {tab === "decision" && (
          <DecisionView node={node} parent={parent} sub={decisionSub} onSub={setDecisionSub} />
        )}
        {tab === "context" && <ContextView node={node} />}
        {tab === "tools" && <ToolsView node={node} />}
        {tab === "files" && <FilesView node={node} />}
        {tab === "compare" && <CompareView node={node} siblings={siblings} />}
        {tab === "raw" && <RawView node={node} />}
      </div>
    </div>
  );
}

function DecisionView({ node, parent, sub, onSub }) {
  const d = node.decision;
  return (
    <div className="decision">
      <div className="subtabs">
        {[
          ["structured", "Structured"],
          ["annotated", "Annotated"],
          ["diff", "Diff vs parent"],
        ].map(([k, l]) => (
          <button
            key={k}
            className={`subtab ${sub === k ? "subtab-active" : ""}`}
            onClick={() => onSub(k)}
          >
            {l}
          </button>
        ))}
      </div>

      {sub === "structured" && (
        <div className="decision-structured">
          <div className="decision-section">
            <div className="section-label">Goal</div>
            <div className="section-body">{d.goal}</div>
          </div>

          <div className="decision-section">
            <div className="section-label">Options considered ({d.options.length})</div>
            <div className="options">
              {d.options.map((o, i) => (
                <div key={i} className={`option ${o.chosen ? "option-chosen" : ""}`}>
                  <div className="option-head">
                    <span className="option-marker">{o.chosen ? "●" : "○"}</span>
                    <span className="option-label">{o.label}</span>
                    {o.chosen && <span className="option-tag">chosen</span>}
                  </div>
                  <div className="option-reason">{o.reason}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="decision-section">
            <div className="section-label">Why this one</div>
            <div className="section-body section-why">{d.why}</div>
          </div>
        </div>
      )}

      {sub === "annotated" && (
        <div className="decision-annotated">
          <div className="transcript">
            <div className="transcript-line">
              <span className="role-tag role-sys">system</span>
              <span>You are a coding agent working on acme/web.</span>
            </div>
            <div className="transcript-line">
              <span className="role-tag role-tool">tool_result</span>
              <span>
                <span className="mono muted">read_file(src/pages/auth/callback.ts)</span>
                <pre className="code-inline">
{`47:  cookies.set('sid', token, {\n       `}<mark className="mark-red">{`domain: '.auth.acme.com'`}</mark>{`,\n       httpOnly: true,\n     });`}
                </pre>
              </span>
            </div>
            <div className="transcript-line">
              <span className="role-tag role-asst">assistant</span>
              <span>
                The cookie is scoped to <mark className="mark-red">'.auth.acme.com'</mark> but the app runs on
                <mark className="mark-red"> 'app.acme.com'</mark>.{" "}
                <mark className="mark-green">Fix: change domain to '.acme.com'</mark> so both subdomains share it.
              </span>
            </div>
          </div>
          <div className="legend-mini">
            <span><mark className="mark-red">red</mark> bug signal</span>
            <span><mark className="mark-green">green</mark> the decision</span>
          </div>
        </div>
      )}

      {sub === "diff" && (
        <div className="decision-diff">
          <div className="diff-col">
            <div className="diff-head">Parent: {parent ? parent.label : "—"}</div>
            <div className="diff-body">
              <div className="diff-row">+ located 4 auth files</div>
              <div className="diff-row">+ read auth middleware (174 lines)</div>
              <div className="diff-row muted">· no bug hypothesis yet</div>
            </div>
          </div>
          <div className="diff-col">
            <div className="diff-head">This node: {node.label}</div>
            <div className="diff-body">
              <div className="diff-row add">+ read callback.ts (98 lines)</div>
              <div className="diff-row add">+ hypothesis: cookie domain mismatch</div>
              <div className="diff-row add">+ target line: 47</div>
              <div className="diff-row remove">- rejected: TTL, session store, CSRF</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ContextView({ node }) {
  return (
    <div className="context">
      <div className="context-head">
        <span className="muted">Context window fed to this call</span>
        <span className="mono muted">{node.inputTokens.toLocaleString()} tok in</span>
      </div>
      <pre className="context-body mono">{node.input}</pre>
      <div className="context-head" style={{ marginTop: 16 }}>
        <span className="muted">Model output</span>
        <span className="mono muted">{node.outputTokens.toLocaleString()} tok out</span>
      </div>
      <pre className="context-body mono">{node.output}</pre>
    </div>
  );
}

function ToolsView({ node }) {
  if (!node.toolCalls || node.toolCalls.length === 0)
    return <div className="empty-small">No tool calls from this node.</div>;
  return (
    <div className="tools-list">
      {node.toolCalls.map((t, i) => (
        <div key={i} className="tool-row">
          <div className="tool-name mono">{t.name}</div>
          <div className="tool-args mono">{JSON.stringify(t.args)}</div>
          <div className="tool-result mono">{t.result}</div>
        </div>
      ))}
    </div>
  );
}

function FilesView({ node }) {
  if (node.files.length === 0) return <div className="empty-small">No files touched.</div>;
  return (
    <div className="files-list">
      {node.files.map((f, i) => (
        <div key={i} className="file-row">
          <span className="file-icon">◫</span>
          <span className="file-path mono">{f}</span>
          <span className="file-action muted">read</span>
        </div>
      ))}
    </div>
  );
}

function CompareView({ node, siblings }) {
  if (siblings.length === 0)
    return <div className="empty-small">No sibling branches to compare.</div>;
  const cols = [node, ...siblings];
  return (
    <div className="compare-grid" style={{ gridTemplateColumns: `repeat(${cols.length}, 1fr)` }}>
      {cols.map((n) => (
        <div key={n.id} className={`compare-col ${n.id === node.id ? "compare-col-active" : ""}`}>
          <div className="compare-head">
            <span className="mono">{n.label}</span>
            {n.isBranch && <Pill tone={n.kind === "experiment" ? "amber" : "green"}>{n.branchLabel}</Pill>}
          </div>
          <KV k="model" v={n.model} mono />
          <KV k="tokens" v={(n.inputTokens + n.outputTokens).toLocaleString()} mono />
          <KV k="cost" v={`$${n.cost.toFixed(3)}`} mono />
          <KV k="latency" v={`${(n.latency / 1000).toFixed(2)}s`} mono />
          <div className="compare-summary">{n.summary}</div>
        </div>
      ))}
    </div>
  );
}

function RawView({ node }) {
  return <pre className="raw-json mono">{JSON.stringify(node, null, 2)}</pre>;
}

window.NodeDetail = NodeDetail;
