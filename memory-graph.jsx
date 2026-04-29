// Memory graph — force-directed visualization of ~/.claude/projects/*/memory/*.md
// Inspired by GraphRAG / Karpathy-style wiki graphs.

const { useState: useMS, useEffect: useME, useMemo: useMM, useRef: useMR, useCallback: useMC } = React;

const TYPE_COLORS = {
  user: 'oklch(0.66 0.13 220)',       // blue
  feedback: 'oklch(0.72 0.14 75)',    // amber
  project: 'oklch(0.62 0.16 295)',    // purple
  reference: 'oklch(0.6 0.04 260)',   // muted blue-grey
  unknown: 'oklch(0.7 0.02 260)',
};

const TYPE_LABELS = {
  user: 'user',
  feedback: 'feedback',
  project: 'project',
  reference: 'reference',
  unknown: 'unknown',
};

const PROJECT_HUB_COLOR = 'oklch(0.28 0.02 260)'; // near-ink

function useGraphSimulation(rawNodes, rawEdges, width, height) {
  // We mutate node objects in place — d3-force requires this — but expose a render-tick state.
  const simRef = useMR(null);
  const nodesRef = useMR(null);
  const linksRef = useMR(null);
  const [tick, setTick] = useMS(0);

  useME(() => {
    // Clone nodes so d3 can attach x/y/vx/vy without polluting source data.
    const nodes = rawNodes.map((n) => ({ ...n }));
    const idIndex = new Map(nodes.map((n) => [n.id, n]));
    const links = rawEdges
      .map((e) => ({ source: idIndex.get(e.source), target: idIndex.get(e.target), kind: e.kind }))
      .filter((l) => l.source && l.target);

    nodesRef.current = nodes;
    linksRef.current = links;

    const sim = d3
      .forceSimulation(nodes)
      .force(
        'link',
        d3
          .forceLink(links)
          .id((d) => d.id)
          .distance((l) => (l.kind === 'member' ? 70 : 130))
          .strength((l) => (l.kind === 'member' ? 0.7 : 0.18))
      )
      .force('charge', d3.forceManyBody().strength(-260))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force(
        'collide',
        d3.forceCollide().radius((d) => (d.kind === 'project' ? 28 : 16))
      )
      .alpha(1)
      .alphaDecay(0.025);

    let raf = 0;
    sim.on('tick', () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setTick((t) => t + 1);
      });
    });

    simRef.current = sim;
    return () => {
      sim.stop();
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawNodes, rawEdges, width, height]);

  const reheat = useMC(() => {
    if (simRef.current) simRef.current.alpha(0.6).restart();
  }, []);

  return { nodes: nodesRef.current || [], links: linksRef.current || [], reheat, tick };
}

function MemoryGraphView() {
  const data = window.MEMORY_GRAPH || { nodes: [], edges: [] };
  const [selected, setSelected] = useMS(null);
  const [hover, setHover] = useMS(null);
  const [query, setQuery] = useMS('');
  const [enabledTypes, setEnabledTypes] = useMS(() => new Set(['user', 'feedback', 'project', 'reference']));
  const svgRef = useMR(null);
  const [size, setSize] = useMS({ w: 900, h: 600 });

  // Resize observer
  useME(() => {
    if (!svgRef.current) return;
    const el = svgRef.current.parentElement;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const r = e.contentRect;
        setSize({ w: Math.max(400, r.width), h: Math.max(300, r.height) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { nodes, links, reheat } = useGraphSimulation(data.nodes, data.edges, size.w, size.h);

  // Filtering: matches search query and (for memories) type is enabled
  const matchesFilter = useMC(
    (n) => {
      if (n.kind === 'memory' && !enabledTypes.has(n.type)) return false;
      if (!query) return true;
      const q = query.toLowerCase();
      return (
        (n.label || '').toLowerCase().includes(q) ||
        (n.description || '').toLowerCase().includes(q) ||
        (n.body || '').toLowerCase().includes(q) ||
        (n.projectLabel || '').toLowerCase().includes(q)
      );
    },
    [query, enabledTypes]
  );

  const dimmed = useMC((n) => !matchesFilter(n), [matchesFilter]);

  // Drag handlers
  const dragRef = useMR({ active: null, offX: 0, offY: 0 });

  const onPointerDown = (n, e) => {
    e.stopPropagation();
    dragRef.current.active = n;
    n.fx = n.x;
    n.fy = n.y;
    reheat();
  };
  const onPointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag.active || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    drag.active.fx = e.clientX - rect.left;
    drag.active.fy = e.clientY - rect.top;
  };
  const onPointerUp = () => {
    const drag = dragRef.current;
    if (drag.active) {
      drag.active.fx = null;
      drag.active.fy = null;
      drag.active = null;
    }
  };
  useME(() => {
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, []);

  // Group memories by project for sidebar
  const grouped = useMM(() => {
    const map = new Map();
    for (const n of data.nodes) {
      if (n.kind !== 'memory') continue;
      if (!map.has(n.project)) map.set(n.project, []);
      map.get(n.project).push(n);
    }
    return Array.from(map.entries()).map(([proj, mems]) => {
      const hub = data.nodes.find((p) => p.kind === 'project' && p.folder === proj);
      return { project: proj, label: hub?.label || proj, mems };
    });
  }, [data.nodes]);

  const selectedNode = selected ? data.nodes.find((n) => n.id === selected) : null;

  const toggleType = (t) => {
    setEnabledTypes((s) => {
      const ns = new Set(s);
      if (ns.has(t)) ns.delete(t);
      else ns.add(t);
      return ns;
    });
  };

  return (
    <div className="memgraph">
      <aside className="mg-side">
        <div className="mg-search">
          <input
            placeholder="Search memories…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="mg-types">
          {Object.keys(TYPE_LABELS).filter((t) => t !== 'unknown').map((t) => (
            <button
              key={t}
              className={`mg-type-chip ${enabledTypes.has(t) ? 'is-on' : ''}`}
              onClick={() => toggleType(t)}
              style={{ '--mg-type-c': TYPE_COLORS[t] }}
            >
              <span className="mg-type-dot" />
              {TYPE_LABELS[t]}
            </button>
          ))}
        </div>
        <div className="mg-list">
          {grouped.map((g) => (
            <div key={g.project} className="mg-list-group">
              <div className="mg-list-group-head">
                <span className="mono">◇ {g.label}</span>
                <span className="mono muted">{g.mems.length}</span>
              </div>
              {g.mems
                .filter(matchesFilter)
                .map((m) => (
                  <div
                    key={m.id}
                    className={`mg-list-item ${selected === m.id ? 'is-active' : ''}`}
                    onClick={() => setSelected(m.id)}
                    onMouseEnter={() => setHover(m.id)}
                    onMouseLeave={() => setHover(null)}
                  >
                    <span
                      className="mg-list-dot"
                      style={{ background: TYPE_COLORS[m.type] || TYPE_COLORS.unknown }}
                    />
                    <div className="mg-list-text">
                      <div className="mg-list-title">{m.label}</div>
                      <div className="mg-list-desc mono">{m.description}</div>
                    </div>
                  </div>
                ))}
            </div>
          ))}
          {grouped.length === 0 && (
            <div className="mg-empty mono">
              No memories found.<br />
              Run <code>node bin/scan-memories.mjs</code> to rescan.
            </div>
          )}
        </div>
      </aside>

      <div className="mg-canvas">
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          viewBox={`0 0 ${size.w} ${size.h}`}
          preserveAspectRatio="xMidYMid meet"
          onClick={() => setSelected(null)}
        >
          <defs>
            <marker id="mg-arrow" viewBox="0 0 10 10" refX="14" refY="5" markerWidth="4" markerHeight="4" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--muted-2)" />
            </marker>
          </defs>
          {/* Edges */}
          {links.map((l, i) => {
            const a = l.source, b = l.target;
            if (!a || !b || a.x == null || b.x == null) return null;
            const isMember = l.kind === 'member';
            const isHL =
              hover && (a.id === hover || b.id === hover) ||
              selected && (a.id === selected || b.id === selected);
            const op = dimmed(a) || dimmed(b) ? 0.12 : isHL ? 0.95 : 0.45;
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={isMember ? 'var(--border-strong)' : 'var(--accent-amber)'}
                strokeWidth={isMember ? 1 : 1.2}
                strokeDasharray={isMember ? '0' : '3 2'}
                opacity={op}
                markerEnd={isMember ? null : 'url(#mg-arrow)'}
              />
            );
          })}
          {/* Nodes */}
          {nodes.map((n) => {
            if (n.x == null) return null;
            const isProject = n.kind === 'project';
            const r = isProject ? 16 + Math.min(8, (n.memberCount || 0) * 1.4) : 8;
            const fill = isProject ? PROJECT_HUB_COLOR : TYPE_COLORS[n.type] || TYPE_COLORS.unknown;
            const isSel = selected === n.id;
            const isHov = hover === n.id;
            const op = dimmed(n) ? 0.18 : 1;
            return (
              <g
                key={n.id}
                transform={`translate(${n.x},${n.y})`}
                style={{ cursor: 'pointer', opacity: op }}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelected(n.id);
                }}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(null)}
                onPointerDown={(e) => onPointerDown(n, e)}
              >
                {(isSel || isHov) && (
                  <circle r={r + 6} fill="none" stroke={fill} strokeWidth={1} opacity={0.4} />
                )}
                <circle
                  r={r}
                  fill={fill}
                  stroke={isSel ? 'var(--ink)' : 'var(--bg)'}
                  strokeWidth={isSel ? 2 : 1.5}
                />
                {isProject && (
                  <text
                    textAnchor="middle"
                    y={4}
                    fontSize="10"
                    fontFamily="var(--font-mono)"
                    fill="var(--bg)"
                    style={{ pointerEvents: 'none' }}
                  >
                    {n.memberCount}
                  </text>
                )}
                <text
                  textAnchor="middle"
                  y={r + 14}
                  fontSize={isProject ? 11 : 10}
                  fontFamily={isProject ? 'var(--font-mono)' : 'var(--font)'}
                  fontWeight={isProject ? 500 : 400}
                  fill={isHov || isSel ? 'var(--ink)' : 'var(--muted)'}
                  style={{ pointerEvents: 'none' }}
                >
                  {truncate(n.label, isProject ? 24 : 32)}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="mg-canvas-legend mono">
          <span><span className="mg-leg-line mg-leg-member" /> member-of</span>
          <span><span className="mg-leg-line mg-leg-mentions" /> mentions</span>
          <span className="muted">drag nodes · click to inspect</span>
        </div>
      </div>

      <aside className="mg-detail">
        {selectedNode ? (
          <>
            <div className="mg-detail-head">
              <div className="mg-detail-kind mono">
                <span
                  className="mg-detail-kind-dot"
                  style={{
                    background:
                      selectedNode.kind === 'project'
                        ? PROJECT_HUB_COLOR
                        : TYPE_COLORS[selectedNode.type] || TYPE_COLORS.unknown,
                  }}
                />
                {selectedNode.kind === 'project' ? 'project hub' : selectedNode.type}
              </div>
              <div className="mg-detail-title">{selectedNode.label}</div>
              {selectedNode.description && (
                <div className="mg-detail-desc">{selectedNode.description}</div>
              )}
            </div>
            <div className="mg-detail-body">
              {selectedNode.kind === 'memory' ? (
                <>
                  <div className="section-label">Frontmatter</div>
                  <KVRow k="file" v={selectedNode.file} />
                  <KVRow k="type" v={selectedNode.type} />
                  <KVRow k="project" v={selectedNode.projectLabel} />
                  <div style={{ marginTop: 14 }} className="section-label">Body</div>
                  <pre className="mg-body">{selectedNode.body}</pre>
                </>
              ) : (
                <>
                  <KVRow k="folder" v={selectedNode.folder} />
                  <KVRow k="memories" v={selectedNode.memberCount} />
                </>
              )}
            </div>
          </>
        ) : (
          <div className="mg-detail-empty">
            <div className="mono muted">click any node</div>
            <div className="mg-detail-stats">
              <KVRow k="projects" v={data.nodes.filter((n) => n.kind === 'project').length} />
              <KVRow k="memories" v={data.nodes.filter((n) => n.kind === 'memory').length} />
              <KVRow k="edges" v={data.edges.length} />
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function KVRow({ k, v }) {
  return (
    <div className="mg-kv">
      <div className="mg-kv-k mono muted">{k}</div>
      <div className="mg-kv-v mono">{String(v)}</div>
    </div>
  );
}

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function MemoryGraphApp() {
  return (
    <div className="app" style={{ gridTemplateRows: '44px 1fr' }}>
      <div className="topbar">
        <div className="brand">
          <div className="brand-glyph">⌘</div>
          <span>traceframe</span>
        </div>
        <div className="divider-v" />
        <div className="top-filters">
          <a className="chip" href="index.html">◎ trace</a>
          <span className="chip chip-on">◈ memory graph</span>
        </div>
        <div className="top-right">
          <span className="mono muted">~/.claude/projects/*/memory</span>
          <span className="divider-v" />
          <button className="chip" onClick={() => window.location.reload()}>reload</button>
        </div>
      </div>
      <div style={{ overflow: 'hidden', height: '100%' }}>
        <MemoryGraphView />
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<MemoryGraphApp />);
