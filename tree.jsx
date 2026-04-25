// Tree component — node-link graph, left-to-right.
// Layout: compute depth-based columns, spread siblings vertically.

const { useMemo, useState, useEffect, useRef } = React;

function layoutTree(nodes, { includeBranches }) {
  // Build children map
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const children = {};
  nodes.forEach((n) => {
    if (!includeBranches && n.isBranch) return;
    if (n.parent) {
      (children[n.parent] = children[n.parent] || []).push(n.id);
    }
  });
  const root = nodes.find((n) => n.parent == null);

  // Assign columns (depth)
  const depth = {};
  const walk = (id, d) => {
    depth[id] = d;
    (children[id] || []).forEach((c) => walk(c, d + 1));
  };
  walk(root.id, 0);

  // Assign rows — DFS ordering, but group branches after main path
  const row = {};
  let cursor = 0;
  const assign = (id) => {
    const kids = children[id] || [];
    if (kids.length === 0) {
      row[id] = cursor++;
      return;
    }
    // Main children first (non-branch), then branches
    const main = kids.filter((k) => !byId[k].isBranch);
    const br = kids.filter((k) => byId[k].isBranch);
    const startCursor = cursor;
    [...main, ...br].forEach((k) => assign(k));
    row[id] = (row[kids[0]] + row[kids[kids.length - 1]]) / 2;
    // Nudge root-ish nodes up if only one child
    if (kids.length === 1) row[id] = row[kids[0]];
  };
  assign(root.id);

  // Positioning in px
  const COL = 172;
  const ROW = 68;
  const PAD_X = 36;
  const PAD_Y = 32;
  const nodesWithPos = nodes
    .filter((n) => includeBranches || !n.isBranch)
    .map((n) => ({
      ...n,
      x: PAD_X + depth[n.id] * COL,
      y: PAD_Y + row[n.id] * ROW,
    }));

  const edges = [];
  nodesWithPos.forEach((n) => {
    if (n.parent && byId[n.parent]) {
      const p = nodesWithPos.find((x) => x.id === n.parent);
      if (p) edges.push({ from: p, to: n, branch: n.isBranch });
    }
  });

  const maxDepth = Math.max(...Object.values(depth));
  const maxRow = Math.max(...Object.values(row));
  return {
    nodes: nodesWithPos,
    edges,
    width: PAD_X * 2 + (maxDepth + 1) * COL,
    height: PAD_Y * 2 + (maxRow + 1) * ROW,
  };
}

function NodeGlyph({ node, selected, onClick }) {
  const r = 18;
  const fill =
    node.id === "n1"
      ? "var(--ink)"
      : node.highlighted
      ? "var(--accent-green)"
      : node.isBranch && node.kind === "experiment"
      ? "var(--accent-amber)"
      : node.isBranch
      ? "var(--surface)"
      : "var(--surface)";
  const stroke =
    node.isBranch && node.kind !== "experiment"
      ? "var(--accent-green)"
      : "var(--border-strong)";
  const textColor =
    node.id === "n1" || node.highlighted || (node.isBranch && node.kind === "experiment")
      ? "#fff"
      : "var(--ink)";

  return (
    <g
      transform={`translate(${node.x}, ${node.y})`}
      onClick={onClick}
      style={{ cursor: "pointer" }}
      className={`node-glyph ${selected ? "is-selected" : ""}`}
    >
      {selected && (
        <circle r={r + 6} fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeDasharray="2 3" />
      )}
      <circle
        r={r}
        fill={fill}
        stroke={stroke}
        strokeWidth={node.highlighted ? 1.5 : 1}
        strokeDasharray={node.isBranch && node.kind !== "experiment" ? "3 2" : "0"}
      />
      <text
        textAnchor="middle"
        y={4}
        fontSize="10"
        fontFamily="var(--font-mono)"
        fontWeight="500"
        fill={textColor}
      >
        {node.label.length > 7 ? node.label.slice(0, 6) + "…" : node.label}
      </text>
      {/* meta below */}
      <g transform={`translate(0, ${r + 14})`}>
        <text textAnchor="middle" fontSize="9" fontFamily="var(--font-mono)" fill="var(--muted)">
          {fmtTok(node.inputTokens + node.outputTokens)} · ${node.cost.toFixed(3)}
        </text>
        <text textAnchor="middle" y={11} fontSize="8.5" fontFamily="var(--font-mono)" fill="var(--muted-2)">
          {shortModel(node.model)}
        </text>
      </g>
      {/* file dots on the right */}
      {node.files.length > 0 && (
        <g transform={`translate(${r + 4}, -${r - 2})`}>
          {node.files.slice(0, 3).map((f, i) => (
            <g key={i} transform={`translate(0, ${i * 10})`}>
              <rect width="3" height="3" fill="var(--muted)" />
              <text x={6} y={3} fontSize="8" fontFamily="var(--font-mono)" fill="var(--muted)">
                {basename(f)}
              </text>
            </g>
          ))}
        </g>
      )}
    </g>
  );
}

function fmtTok(n) {
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return n;
}
function shortModel(m) {
  return m.replace("claude-", "").replace("-4.5", "4.5").replace("-5", "5").replace("gpt-", "gpt");
}
function basename(p) {
  return p.split("/").pop();
}

function Edge({ e }) {
  const dx = e.to.x - e.from.x;
  const midX = e.from.x + dx * 0.5;
  const path = `M ${e.from.x + 18} ${e.from.y} C ${midX} ${e.from.y}, ${midX} ${e.to.y}, ${e.to.x - 18} ${e.to.y}`;
  return (
    <path
      d={path}
      fill="none"
      stroke={e.branch ? "var(--accent-green)" : "var(--border-strong)"}
      strokeWidth="1"
      strokeDasharray={e.branch ? "3 2" : "0"}
      markerEnd="url(#arrow)"
    />
  );
}

function TreePanel({ selected, onSelect, showBranches, onToggleBranches, variant }) {
  const layout = useMemo(
    () => layoutTree(window.NODES, { includeBranches: showBranches }),
    [showBranches]
  );
  const [zoom, setZoom] = useState(1);
  const bodyRef = useRef(null);

  const zoomIn = () => setZoom((z) => Math.min(2.5, +(z + 0.15).toFixed(2)));
  const zoomOut = () => setZoom((z) => Math.max(0.4, +(z - 0.15).toFixed(2)));
  const zoomReset = () => setZoom(1);

  const onWheel = (e) => {
    e.preventDefault();
    setZoom((z) => {
      const next = z - e.deltaY * 0.002;
      return Math.max(0.4, Math.min(2.5, +next.toFixed(2)));
    });
  };

  // Right-button drag to pan horizontally (and vertically)
  const [panning, setPanning] = useState(null);
  const onContextMenu = (e) => { e.preventDefault(); };
  const onMouseDown = (e) => {
    if (e.button !== 2) return;
    e.preventDefault();
    setPanning({ x: e.clientX, y: e.clientY, sl: bodyRef.current.scrollLeft, st: bodyRef.current.scrollTop });
  };
  const onMouseMove = (e) => {
    if (!panning) return;
    bodyRef.current.scrollLeft = panning.sl - (e.clientX - panning.x);
    bodyRef.current.scrollTop  = panning.st - (e.clientY - panning.y);
  };
  const onMouseUp = () => setPanning(null);

  useEffect(() => {
    if (!panning) return;
    const mv = (e) => onMouseMove(e);
    const up = () => setPanning(null);
    window.addEventListener("mousemove", mv);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); };
  }, [panning]);

  return (
    <div className="tree-panel" data-tree={variant}>
      <div className="panel-header">
        <div className="panel-title">
          <span className="dot dot-running" />
          <span>Call tree</span>
          <span className="muted" style={{ marginLeft: 8 }}>
            {layout.nodes.length} nodes · {showBranches ? "with branches" : "main only"}
          </span>
        </div>
        <div className="panel-actions">
          <button
            className={`chip ${showBranches ? "chip-on" : ""}`}
            onClick={onToggleBranches}
          >
            branches
          </button>
          <button className="chip">main</button>
          <button className="chip">errors</button>
          <div className="divider-v" />
          <button className="icon-btn" onClick={zoomOut} title="zoom out (−)">−</button>
          <button className="icon-btn mono" onClick={zoomReset} title="reset zoom" style={{ minWidth: 36 }}>{Math.round(zoom*100)}%</button>
          <button className="icon-btn" onClick={zoomIn} title="zoom in (+)">+</button>
          <button className="icon-btn" title="fit to screen" onClick={() => setZoom(1)}>fit</button>
        </div>
      </div>
      <div className="tree-body" ref={bodyRef} onWheel={onWheel} onMouseDown={onMouseDown} onContextMenu={onContextMenu} style={{ cursor: panning ? "grabbing" : "default" }}>
        <div style={{ transform: `scale(${zoom})`, transformOrigin: "0 0", width: layout.width * zoom, height: layout.height * zoom }}>
        <svg
          width={layout.width}
          height={layout.height}
          style={{ display: "block" }}
        >
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--border-strong)" />
            </marker>
            <pattern id="grid" width="16" height="16" patternUnits="userSpaceOnUse">
              <circle cx="0.5" cy="0.5" r="0.5" fill="var(--border)" />
            </pattern>
          </defs>
          <rect width={layout.width} height={layout.height} fill="url(#grid)" opacity="0.5" />
          {layout.edges.map((e, i) => (
            <Edge key={i} e={e} />
          ))}
          {layout.nodes.map((n) => (
            <NodeGlyph
              key={n.id}
              node={n}
              selected={selected === n.id}
              onClick={() => onSelect(n.id)}
            />
          ))}
        </svg>
        </div>
      </div>
      <div className="tree-legend">
        <span><span className="swatch swatch-ink" /> root</span>
        <span><span className="swatch swatch-green" /> selected path</span>
        <span><span className="swatch swatch-green-out" /> alt model</span>
        <span><span className="swatch swatch-amber" /> experiment</span>
      </div>
    </div>
  );
}

window.TreePanel = TreePanel;
