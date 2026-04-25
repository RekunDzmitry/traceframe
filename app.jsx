// Main app — wires together sidebar + tree + detail + branch panel + tweaks.

const { useState: useS, useEffect: useE } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "variant": "default",
  "treeStyle": "classic",
  "density": "dense",
  "showTweaks": false
}/*EDITMODE-END*/;

function TopBar({ trace, view, onView }) {
  return (
    <div className="topbar">
      <div className="brand">
        <div className="brand-glyph">⌘</div>
        <span>traceframe</span>
      </div>
      <div className="divider-v" />
      <div className="top-filters">
        <button className={`chip ${view === "trace" ? "chip-on" : ""}`} onClick={() => onView("trace")}>◎ trace</button>
        <button className={`chip ${view === "wiki" ? "chip-on" : ""}`} onClick={() => onView("wiki")}>§ wiki</button>
        <button className={`chip ${view === "code" ? "chip-on" : ""}`} onClick={() => onView("code")}>◇ code graph</button>
      </div>
      <div className="top-right">
        <span className="mono muted">{trace.repo}</span>
        <span className="divider-v" />
        <span className="mono muted">{trace.startedAt}</span>
        <span className="divider-v" />
        <button className="chip">settings</button>
      </div>
    </div>
  );
}

function Sidebar({ activeTrace, onSelect }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-section">
        <div className="sidebar-section-label">
          <span>Recent traces</span>
          <span className="mono">{window.TRACES.length}</span>
        </div>
        {window.TRACES.map((t) => (
          <div
            key={t.id}
            className={`trace-item ${activeTrace === t.id ? "is-active" : ""}`}
            onClick={() => onSelect(t.id)}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className={`trace-status ${t.status}`} />
              <span className="trace-title">{t.title}</span>
            </div>
            <div className="trace-meta">
              <span>{t.id}</span>
              <span>·</span>
              <span>{(t.duration / 1000).toFixed(0)}s</span>
              <span>·</span>
              <span>${t.totalCost.toFixed(2)}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="sidebar-section">
        <div className="sidebar-section-label"><span>Saved experiments</span><span className="mono">3</span></div>
        <div className="trace-item">
          <div className="trace-title">Cheap model sweep</div>
          <div className="trace-meta"><span className="mono">haiku / gpt-5-mini</span></div>
        </div>
        <div className="trace-item">
          <div className="trace-title">Prompt A/B: planner v2</div>
          <div className="trace-meta"><span className="mono">2 branches</span></div>
        </div>
        <div className="trace-item">
          <div className="trace-title">Temperature ladder</div>
          <div className="trace-meta"><span className="mono">0.0 → 1.0</span></div>
        </div>
      </div>
      <div className="sidebar-section">
        <div className="sidebar-section-label"><span>Metrics (24h)</span></div>
        <div className="kv"><div className="kv-k">runs</div><div className="kv-v mono">42</div></div>
        <div className="kv"><div className="kv-k">spend</div><div className="kv-v mono">$31.07</div></div>
        <div className="kv"><div className="kv-k">avg lat</div><div className="kv-v mono">2.8s</div></div>
        <div className="kv"><div className="kv-k">success</div><div className="kv-v mono">94%</div></div>
      </div>
    </aside>
  );
}

function Tweaks({ state, set }) {
  const setKey = (k, v) => {
    set({ ...state, [k]: v });
    try {
      window.parent.postMessage({ type: "__edit_mode_set_keys", edits: { [k]: v } }, "*");
    } catch {}
  };
  return (
    <div className="tweaks">
      <div className="tweaks-head">
        <span>TWEAKS</span>
        <button className="icon-btn-sm" onClick={() => set({ ...state, showTweaks: false })}>✕</button>
      </div>
      <div className="tweaks-body">
        <div className="tweak-row">
          <div className="tweak-label">theme</div>
          <div className="tweak-opts">
            {["default", "ink", "paper"].map((v) => (
              <button key={v} className={`tweak-opt ${state.variant === v ? "is-on" : ""}`} onClick={() => setKey("variant", v)}>{v}</button>
            ))}
          </div>
        </div>
        <div className="tweak-row">
          <div className="tweak-label">tree style</div>
          <div className="tweak-opts">
            {["classic", "dense", "timeline"].map((v) => (
              <button key={v} className={`tweak-opt ${state.treeStyle === v ? "is-on" : ""}`} onClick={() => setKey("treeStyle", v)}>{v}</button>
            ))}
          </div>
        </div>
        <div className="tweak-row">
          <div className="tweak-label">density</div>
          <div className="tweak-opts">
            {["dense", "comfortable"].map((v) => (
              <button key={v} className={`tweak-opt ${state.density === v ? "is-on" : ""}`} onClick={() => setKey("density", v)}>{v}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [activeTrace, setActiveTrace] = useS("trc_9f2a");
  const [selectedNode, setSelectedNode] = useS(
    localStorage.getItem("selNode") || "n4"
  );
  const [branchOpen, setBranchOpen] = useS(false);
  const [showBranches, setShowBranches] = useS(true);
  const [tweaks, setTweaks] = useS(TWEAK_DEFAULTS);
  const [view, setView] = useS(localStorage.getItem("view") || "trace");

  useE(() => { localStorage.setItem("selNode", selectedNode); }, [selectedNode]);
  useE(() => { localStorage.setItem("view", view); }, [view]);

  // Edit mode protocol
  useE(() => {
    const handler = (e) => {
      const d = e.data || {};
      if (d.type === "__activate_edit_mode") setTweaks((t) => ({ ...t, showTweaks: true }));
      if (d.type === "__deactivate_edit_mode") setTweaks((t) => ({ ...t, showTweaks: false }));
    };
    window.addEventListener("message", handler);
    try { window.parent.postMessage({ type: "__edit_mode_available" }, "*"); } catch {}
    return () => window.removeEventListener("message", handler);
  }, []);

  const trace = window.TRACES.find((t) => t.id === activeTrace);
  const node = window.NODES.find((n) => n.id === selectedNode);

  return (
    <div className="app" data-variant={tweaks.variant} data-density={tweaks.density}>
      <TopBar trace={trace} view={view} onView={setView} />
      <div className="workspace">
        <Sidebar activeTrace={activeTrace} onSelect={setActiveTrace} />
        {view === "trace" && (
          <div className={`main-area ${branchOpen ? "with-branch" : "no-branch"}`}>
            <TreePanel
              selected={selectedNode}
              onSelect={setSelectedNode}
              showBranches={showBranches}
              onToggleBranches={() => setShowBranches((v) => !v)}
              variant={tweaks.treeStyle}
            />
            <NodeDetail
              node={node}
              onBranch={() => setBranchOpen((v) => !v)}
              branchOpen={branchOpen}
              allNodes={window.NODES}
            />
            {branchOpen && (
              <BranchPanel
                node={node}
                allNodes={window.NODES}
                onClose={() => setBranchOpen(false)}
                onSubmit={() => { setBranchOpen(false); alert("Branch queued — it would appear as a new node in the tree."); }}
              />
            )}
          </div>
        )}
        {view === "wiki" && <div className="main-area view-wrap"><WikiView /></div>}
        {view === "code" && <div className="main-area view-wrap"><CodeGraphView /></div>}
      </div>
      {tweaks.showTweaks && <Tweaks state={tweaks} set={setTweaks} />}
    </div>
  );
}

// The TreePanel I wrote wraps itself in a .tree-panel div — override the outer wrapper.
// Simpler: patch — render TreePanel directly, since it already provides its own .tree-panel.
// So adjust App: remove outer div wrapper.
window.__app_root = ReactDOM.createRoot(document.getElementById("root"));
window.__app_root.render(<App />);
