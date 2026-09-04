"use client";

interface HoldingRef {
  symbol: string;
  name: string;
}

export function ExposureGraph({
  eventLabel,
  company,
  counterpartyName,
  otherHoldings,
  portfolioValueLabel,
}: {
  eventLabel: string;
  company: HoldingRef | null;
  counterpartyName: string;
  otherHoldings: HoldingRef[];
  portfolioValueLabel: string;
}) {
  const nodeH = 56;
  const gapY = 16;
  const colX = [20, 220, 420, 620, 840];
  const width = 1000;

  const otherNodesY = otherHoldings.map((_, i) => 40 + i * (nodeH + gapY));
  const otherBlockHeight = otherHoldings.length > 0 ? otherNodesY[otherNodesY.length - 1] + nodeH : nodeH;
  const height = Math.max(220, otherBlockHeight + 80);

  const midY = height / 2;

  function node(x: number, y: number, w: number, label: string, sub?: string, muted = false) {
    return (
      <g key={`${x}-${y}-${label}`}>
        <rect
          x={x}
          y={y}
          width={w}
          height={nodeH}
          rx={6}
          fill={muted ? "var(--bg-panel-alt)" : "var(--bg-inset)"}
          stroke={muted ? "var(--border)" : "var(--accent)"}
          strokeWidth={muted ? 1 : 1.5}
        />
        <text x={x + w / 2} y={y + nodeH / 2 - (sub ? 8 : 0)} textAnchor="middle" fill="var(--text)" fontSize={13} fontWeight={600}>
          {label}
        </text>
        {sub && (
          <text x={x + w / 2} y={y + nodeH / 2 + 14} textAnchor="middle" fill="var(--text-faint)" fontSize={10}>
            {sub}
          </text>
        )}
      </g>
    );
  }

  function arrow(x1: number, y1: number, x2: number, y2: number) {
    const midX = (x1 + x2) / 2;
    const path = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
    return (
      <path
        key={`${x1}-${y1}-${x2}-${y2}`}
        d={path}
        fill="none"
        stroke="var(--border-strong)"
        strokeWidth={1.5}
        markerEnd="url(#arrowhead)"
      />
    );
  }

  const nodeW = 160;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Exposure propagation graph">
      <defs>
        <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="var(--border-strong)" />
        </marker>
      </defs>

      {node(colX[0], midY - nodeH / 2, nodeW, "Event", eventLabel, true)}
      {arrow(colX[0] + nodeW, midY, colX[1], midY)}

      {company
        ? node(colX[1], midY - nodeH / 2, nodeW, company.symbol, company.name)
        : node(colX[1], midY - nodeH / 2, nodeW, "any dependent holding", undefined, true)}
      {arrow(colX[1] + nodeW, midY, colX[2], midY)}

      {node(colX[2], midY - nodeH / 2, nodeW, counterpartyName, "counterparty")}

      {otherHoldings.length > 0 ? (
        otherHoldings.map((h, i) => (
          <g key={h.symbol}>
            {arrow(colX[2] + nodeW, midY, colX[3], otherNodesY[i] + nodeH / 2)}
            {node(colX[3], otherNodesY[i], nodeW, h.symbol, h.name)}
            {arrow(colX[3] + nodeW, otherNodesY[i] + nodeH / 2, colX[4], midY)}
          </g>
        ))
      ) : (
        arrow(colX[2] + nodeW, midY, colX[4], midY)
      )}

      {node(colX[4], midY - nodeH / 2, nodeW, "Portfolio", portfolioValueLabel)}
    </svg>
  );
}
