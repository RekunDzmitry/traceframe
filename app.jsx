// Main app — wires together sidebar + tree + detail + branch panel + tweaks.

const { useState: useS, useEffect: useE, useCallback: useCB } = React;

const BRANCH_API = window.location.origin.startsWith("http")
  ? "" // same-origin → relative URLs
  : "http://localhost:4000";

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

function Sidebar({ activeTrace, onSelect, experiments, onLoadExperiment, onDeleteExperiment }) {
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
        <div className="sidebar-section-label">
          <span>Saved experiments</span>
          <span className="mono">{experiments.length}</span>
        </div>
        {experiments.length === 0 && (
          <div className="trace-meta muted" style={{ padding: "6px 10px" }}>
            None yet — save from the branch panel.
          </div>
        )}
        {experiments.map((exp) => {
          const models = exp.specs.map((s) => s.model).filter(Boolean);
          const uniqModels = [...new Set(models)];
          return (
            <div
              key={exp.id}
              className="trace-item"
              onClick={() => onLoadExperiment(exp)}
              title="click to load into branch panel"
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div className="trace-title">{exp.name}</div>
                <span
                  className="icon-btn-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(`Delete experiment "${exp.name}"?`)) onDeleteExperiment(exp.id);
                  }}
                  title="delete"
                >
                  ✕
                </span>
              </div>
              <div className="trace-meta">
                <span className="mono">
                  {exp.specs.length} variant{exp.specs.length > 1 ? "s" : ""}
                </span>
                {uniqModels.length > 0 && <span>·</span>}
                <span className="mono">{uniqModels.slice(0, 2).join(" / ")}</span>
              </div>
            </div>
          );
        })}
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
  const [nodes, setNodes] = useS(window.NODES);
  const [experiments, setExperiments] = useS([]);
  const [pendingSpecs, setPendingSpecs] = useS(null);

  useE(() => { localStorage.setItem("selNode", selectedNode); }, [selectedNode]);
  useE(() => { localStorage.setItem("view", view); }, [view]);

  // Load persisted branch nodes for the active trace.
  useE(() => {
    let cancelled = false;
    fetch(`${BRANCH_API}/branch/nodes?traceId=${encodeURIComponent(activeTrace)}`)
      .then((r) => (r.ok ? r.json() : { nodes: [] }))
      .then(({ nodes: persisted }) => {
        if (cancelled || !persisted?.length) return;
        setNodes((prev) => {
          const existing = new Set(prev.map((n) => n.id));
          const fresh = persisted.filter((n) => !existing.has(n.id));
          if (!fresh.length) return prev;
          window.NODES = [...prev, ...fresh];
          return window.NODES;
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeTrace]);

  const refreshExperiments = useCB(() => {
    fetch(`${BRANCH_API}/experiments`)
      .then((r) => (r.ok ? r.json() : { experiments: [] }))
      .then(({ experiments }) => setExperiments(experiments || []))
      .catch(() => {});
  }, []);
  useE(() => {
    refreshExperiments();
    const h = () => refreshExperiments();
    window.addEventListener("experiments:changed", h);
    return () => window.removeEventListener("experiments:changed", h);
  }, [refreshExperiments]);

  const handleLoadExperiment = (exp) => {
    setPendingSpecs(exp.specs);
    setBranchOpen(true);
  };
  const handleDeleteExperiment = async (id) => {
    await fetch(`${BRANCH_API}/experiments/${encodeURIComponent(id)}`, { method: "DELETE" });
    refreshExperiments();
  };
  const handleSaveTemplate = async ({ name, specs }) => {
    const r = await fetch(`${BRANCH_API}/experiments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, specs }),
    });
    if (!r.ok) throw new Error(await r.text());
    refreshExperiments();
  };

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
  const node = nodes.find((n) => n.id === selectedNode);

  const handleBranchSubmit = async (specs) => {
    const r = await fetch(`${BRANCH_API}/branch/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceNodeId: node.id,
        traceId: trace.id,
        parentNodeId: node.parent || "",
        variants: specs,
      }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      window.alert(`branch run failed: ${r.status} ${detail.slice(0, 200)}`);
      return;
    }
    const { nodes: newNodes } = await r.json();
    setNodes((prev) => {
      const merged = [...prev, ...newNodes];
      window.NODES = merged;
      return merged;
    });
    if (newNodes[0]?.id) setSelectedNode(newNodes[0].id);
    setBranchOpen(false);
    setPendingSpecs(null);
  };

  return (
    <div className="app" data-variant={tweaks.variant} data-density={tweaks.density}>
      <TopBar trace={trace} view={view} onView={setView} />
      <div className="workspace">
        <Sidebar
          activeTrace={activeTrace}
          onSelect={setActiveTrace}
          experiments={experiments}
          onLoadExperiment={handleLoadExperiment}
          onDeleteExperiment={handleDeleteExperiment}
        />
        {view === "trace" && (
          <div className={`main-area ${branchOpen ? "with-branch" : "no-branch"}`}>
            <TreePanel
              selected={selectedNode}
              onSelect={setSelectedNode}
              showBranches={showBranches}
              onToggleBranches={() => setShowBranches((v) => !v)}
              variant={tweaks.treeStyle}
              nodes={nodes}
            />
            <NodeDetail
              node={node}
              onBranch={() => {
                setPendingSpecs(null);
                setBranchOpen((v) => !v);
              }}
              branchOpen={branchOpen}
              allNodes={nodes}
            />
            {branchOpen && (
              <BranchPanel
                key={pendingSpecs ? "loaded" : "fresh"}
                node={node}
                allNodes={nodes}
                onClose={() => { setBranchOpen(false); setPendingSpecs(null); }}
                onSubmit={handleBranchSubmit}
                onSaveTemplate={handleSaveTemplate}
                initialSpecs={pendingSpecs}
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
