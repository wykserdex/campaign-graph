"use client";

import { useState } from "react";

// ═══════════════════════════════════════════════════════════════════════════
// Campaign Graph Dashboard — SVG visualization
// ═══════════════════════════════════════════════════════════════════════════

const NODE_TYPES = [
  "Repository", "Commit", "SecretFingerprint", "Provider",
  "Domain", "PhishingURL", "Actor", "Organization",
  "LeakIncident", "SubjectIndex", "Campaign",
] as const;

const SOURCE_CARDS = [
  {
    title: "Secret Exposure Monitor",
    icon: "🔑",
    desc: "Repository, Commit, SecretFingerprint nodes via HMAC canonicalization",
    color: "border-rose-500/30 bg-rose-950/20",
  },
  {
    title: "Leak Intelligence",
    icon: "💧",
    desc: "SubjectIndex (HMAC v3) and LeakIncident correlation, enrichment via ExposureAssessed",
    color: "border-amber-500/30 bg-amber-950/20",
  },
  {
    title: "UntilPhish-Go",
    icon: "🎣",
    desc: "PhishingURL (SHA256), Domain, Actor nodes. Verdict→Confidence fixed table",
    color: "border-cyan-500/30 bg-cyan-950/20",
  },
];

const API_ENDPOINTS = {
  ingestion: [
    ["POST", "/api/v1/ingest/secret-exposure-monitor", "SecretExposureDetected"],
    ["POST", "/api/v1/ingest/leak-intelligence", "ExposureObserved / ExposureAssessed"],
    ["POST", "/api/v1/ingest/until-phish", "PhishingDetected (+ X-Tenant-ID header)"],
  ],
  query: [
    ["GET", "/api/v1/campaigns", "List campaigns (X-Tenant-ID)"],
    ["GET", "/api/v1/campaigns/:id/timeline", "Campaign timeline (3 sources)"],
    ["GET", "/api/v1/campaigns/:id/sources", "Independent sources (excl. __corr_engine__)"],
    ["GET", "/api/v1/hypotheses", "Pending analyst review"],
    ["POST", "/api/v1/hypotheses/:id/approve", "Human-in-the-loop approve"],
    ["POST", "/api/v1/hypotheses/:id/reject", "Reject hypothesis"],
    ["GET", "/api/v1/nodes?type=Repository", "List nodes by type"],
  ],
};

const ARCH_DECISIONS = [
  { label: "Graph Model", value: "Postgres adjacency list (graph_nodes + graph_edges)" },
  { label: "Canonical Keys", value: "Deterministic dedup keys per node type; source_refs map foreign IDs" },
  { label: "Correlation", value: "Noisy-OR with 5 signals; P≥0.7→merge, P≥0.4→review, P<0.4→ignore" },
  { label: "§5.3 Guard", value: "source_system='__correlation_engine__' excluded from source_count" },
  { label: "Human-in-the-loop", value: "Medium confidence → correlation_hypotheses table" },
  { label: "Privacy", value: "No raw email/phone/secret in graph — only HMAC digests" },
  { label: "Idempotency", value: "AT-LEAST-ONCE delivery + effectively-once via raw_events" },
  { label: "Tenant isolation", value: "All queries scoped to tenant_id" },
];

// ═══════════════════════════════════════════════════════════════════════════
// SVG Graph Visualization Component
// ═══════════════════════════════════════════════════════════════════════════

function GraphVisualization() {
  // Static graph layout: 3 sources → nodes → campaign
  const nodes = [
    { id: "sem", label: "Secret\nExposure\nMonitor", x: 120, y: 80, color: "#f43f5e", type: "source" },
    { id: "li", label: "Leak\nIntelligence", x: 120, y: 230, color: "#f59e0b", type: "source" },
    { id: "up", label: "UntilPhish", x: 120, y: 370, color: "#06b6d4", type: "source" },

    { id: "repo", label: "Repository", x: 350, y: 40, color: "#fb7185", type: "entity" },
    { id: "commit", label: "Commit", x: 350, y: 110, color: "#fb7185", type: "entity" },
    { id: "secret", label: "SecretFP", x: 480, y: 60, color: "#e11d48", type: "entity" },
    { id: "subject", label: "SubjectIdx", x: 350, y: 180, color: "#fbbf24", type: "entity" },
    { id: "leak", label: "LeakIncident", x: 350, y: 260, color: "#fbbf24", type: "entity" },
    { id: "phish", label: "PhishingURL", x: 350, y: 340, color: "#22d3ee", type: "entity" },
    { id: "domain", label: "Domain", x: 480, y: 340, color: "#22d3ee", type: "entity" },
    { id: "actor", label: "Actor", x: 480, y: 410, color: "#22d3ee", type: "entity" },

    { id: "campaign", label: "🎯 Campaign", x: 650, y: 200, color: "#8b5cf6", type: "campaign" },
  ];

  const edges = [
    { from: "sem", to: "repo", label: "CONTAINS" },
    { from: "sem", to: "commit", label: "" },
    { from: "repo", to: "commit", label: "CONTAINS_COMMIT" },
    { from: "commit", to: "secret", label: "EXPOSED" },
    { from: "li", to: "subject", label: "" },
    { from: "li", to: "leak", label: "" },
    { from: "subject", to: "leak", label: "OBSERVED_IN" },
    { from: "up", to: "phish", label: "" },
    { from: "up", to: "domain", label: "" },
    { from: "phish", to: "domain", label: "USES_DOMAIN" },
    { from: "phish", to: "actor", label: "AUTHORED_BY" },
    { from: "secret", to: "campaign", label: "MEMBER_OF", style: "dashed", color: "#8b5cf6" },
    { from: "leak", to: "campaign", label: "MEMBER_OF", style: "dashed", color: "#8b5cf6" },
    { from: "domain", to: "campaign", label: "MEMBER_OF", style: "dashed", color: "#8b5cf6" },
  ];

  const getNodePos = (id: string) => nodes.find((n) => n.id === id)!;

  return (
    <div className="flex justify-center">
      <svg viewBox="0 0 800 500" className="w-full max-w-3xl h-auto">
        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#666" />
          </marker>
          <marker id="arrowhead-purple" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#8b5cf6" />
          </marker>
        </defs>

        {/* Edges */}
        {edges.map((edge, i) => {
          const from = getNodePos(edge.from);
          const to = getNodePos(edge.to);
          const isCorr = edge.style === "dashed";
          return (
            <g key={`edge-${i}`}>
              <line
                x1={from.x + 50}
                y1={from.y + 18}
                x2={to.x}
                y2={to.y + 18}
                stroke={isCorr ? "#8b5cf6" : "#444"}
                strokeWidth={isCorr ? 1.5 : 1}
                strokeDasharray={isCorr ? "6,3" : "none"}
                markerEnd={isCorr ? "url(#arrowhead-purple)" : "url(#arrowhead)"}
                opacity={0.7}
              />
              {edge.label && (
                <text
                  x={(from.x + to.x) / 2 + 25}
                  y={(from.y + to.y) / 2 + 14}
                  fill={isCorr ? "#a78bfa" : "#666"}
                  fontSize="8"
                  textAnchor="middle"
                >
                  {edge.label}
                </text>
              )}
            </g>
          );
        })}

        {/* Nodes */}
        {nodes.map((node) => (
          <g key={node.id}>
            <rect
              x={node.x}
              y={node.y}
              width={node.type === "source" ? 80 : node.type === "campaign" ? 110 : 70}
              height={node.type === "source" ? 50 : node.type === "campaign" ? 55 : 35}
              rx={6}
              fill={node.color + "20"}
              stroke={node.color}
              strokeWidth={1.5}
            />
            {node.label.split("\n").map((line, li) => (
              <text
                key={li}
                x={node.x + (node.type === "source" ? 40 : node.type === "campaign" ? 55 : 35)}
                y={node.y + (node.type === "source" ? 16 : node.type === "campaign" ? 20 : 14) + li * 14}
                fill={node.color}
                fontSize={node.type === "campaign" ? 12 : 10}
                fontWeight={node.type === "campaign" ? "bold" : "normal"}
                textAnchor="middle"
                dominantBaseline="hanging"
              >
                {line}
              </text>
            ))}
          </g>
        ))}

        {/* Legend */}
        <rect x={10} y={440} width={10} height={10} rx={2} fill="#f43f5e" opacity={0.3} />
        <text x={25} y={449} fill="#888" fontSize="9">Source Systems</text>
        <rect x={140} y={440} width={10} height={10} rx={2} fill="#8b5cf6" opacity={0.3} />
        <text x={155} y={449} fill="#888" fontSize="9">Correlation Engine (§5.3)</text>
        <line x1={320} y1={445} x2={350} y2={445} stroke="#8b5cf6" strokeWidth={1.5} strokeDasharray="6,3" />
        <text x={355} y={449} fill="#888" fontSize="9">Inferred edges</text>
      </svg>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Status Badge
// ═══════════════════════════════════════════════════════════════════════════

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ok: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    warn: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    err: "bg-rose-500/20 text-rose-400 border-rose-500/30",
  };
  const color = colors[status] ?? colors.ok;
  return (
    <span className={`px-2 py-0.5 rounded text-xs border ${color}`}>
      {status === "ok" ? "✓ ONLINE" : status === "warn" ? "⚠ DEGRADED" : "✗ OFFLINE"}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Dashboard Page
// ═══════════════════════════════════════════════════════════════════════════

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<"overview" | "api" | "architecture">("overview");

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-primary)" }}>
      {/* Header */}
      <header className="border-b px-6 py-4" style={{ borderColor: "var(--border-subtle)" }}>
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
              🕸️ Campaign Graph
            </h1>
            <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)" }}>
              Threat Intelligence Graph Engine — correlating signals across 3 sources
            </p>
          </div>
          <div className="flex items-center gap-4">
            <StatusBadge status="ok" />
            <span className="text-xs px-3 py-1 rounded-full border" style={{
              borderColor: "var(--border-subtle)",
              color: "var(--text-secondary)",
            }}>
              v1.0.0 — Merged (14 models)
            </span>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="max-w-6xl mx-auto px-6 pt-4">
        <div className="flex gap-1 border-b pb-0" style={{ borderColor: "var(--border-subtle)" }}>
          {(["overview", "api", "architecture"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="px-4 py-2 text-sm rounded-t transition-colors"
              style={{
                background: activeTab === tab ? "var(--bg-card)" : "transparent",
                color: activeTab === tab ? "var(--text-primary)" : "var(--text-secondary)",
                border: activeTab === tab ? "1px solid var(--border-subtle)" : "1px solid transparent",
                borderBottom: activeTab === tab ? "1px solid var(--bg-card)" : "none",
                marginBottom: "-1px",
              }}
            >
              {tab === "overview" ? "📊 Overview" : tab === "api" ? "🔌 API Reference" : "🏗️ Architecture"}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="max-w-6xl mx-auto px-6 py-6">
        {activeTab === "overview" && (
          <div className="space-y-6">
            {/* Graph Visualization */}
            <div className="p-4 rounded-lg border" style={{
              background: "var(--bg-card)",
              borderColor: "var(--border-subtle)",
            }}>
              <h2 className="text-sm font-semibold mb-4" style={{ color: "var(--text-secondary)" }}>
                Graph Topology — 3 Sources → 11 Node Types → Campaign Correlation
              </h2>
              <GraphVisualization />
            </div>

            {/* Source Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {SOURCE_CARDS.map((src) => (
                <div
                  key={src.title}
                  className={`p-4 rounded-lg border ${src.color}`}
                >
                  <div className="text-2xl mb-2">{src.icon}</div>
                  <h3 className="font-semibold text-sm mb-1">{src.title}</h3>
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{src.desc}</p>
                </div>
              ))}
            </div>

            {/* Node Types */}
            <div className="p-4 rounded-lg border" style={{
              background: "var(--bg-card)",
              borderColor: "var(--border-subtle)",
            }}>
              <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-secondary)" }}>
                Graph Node Types
              </h3>
              <div className="flex flex-wrap gap-2">
                {NODE_TYPES.map((nt) => (
                  <span
                    key={nt}
                    className="px-2.5 py-1 rounded text-xs border"
                    style={{
                      background: "var(--bg-secondary)",
                      borderColor: "var(--border-subtle)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {nt}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === "api" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Ingestion API */}
            <div className="p-4 rounded-lg border" style={{
              background: "var(--bg-card)",
              borderColor: "var(--border-subtle)",
            }}>
              <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-secondary)" }}>
                📥 Ingestion API
              </h3>
              <div className="space-y-2">
                {API_ENDPOINTS.ingestion.map(([method, path, desc]) => (
                  <div key={path} className="flex items-start gap-2 text-xs p-2 rounded" style={{
                    background: "var(--bg-secondary)",
                  }}>
                    <span className="font-mono font-bold px-1.5 py-0.5 rounded" style={{
                      background: method === "POST" ? "var(--accent-emerald)" + "20" : "var(--accent-cyan)" + "20",
                      color: method === "POST" ? "var(--accent-emerald)" : "var(--accent-cyan)",
                    }}>
                      {method}
                    </span>
                    <code className="font-mono" style={{ color: "var(--text-primary)" }}>{path}</code>
                    <span style={{ color: "var(--text-secondary)" }}>{desc}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Query API */}
            <div className="p-4 rounded-lg border" style={{
              background: "var(--bg-card)",
              borderColor: "var(--border-subtle)",
            }}>
              <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-secondary)" }}>
                📤 Query & Admin API
              </h3>
              <div className="space-y-2">
                {API_ENDPOINTS.query.map(([method, path, desc]) => (
                  <div key={path} className="flex items-start gap-2 text-xs p-2 rounded" style={{
                    background: "var(--bg-secondary)",
                  }}>
                    <span className="font-mono font-bold px-1.5 py-0.5 rounded" style={{
                      background: method === "GET" ? "var(--accent-cyan)" + "20" : "var(--accent-emerald)" + "20",
                      color: method === "GET" ? "var(--accent-cyan)" : "var(--accent-emerald)",
                    }}>
                      {method}
                    </span>
                    <code className="font-mono" style={{ color: "var(--text-primary)" }}>{path}</code>
                    <span style={{ color: "var(--text-secondary)" }}>{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === "architecture" && (
          <div className="space-y-4">
            {ARCH_DECISIONS.map((item) => (
              <div key={item.label} className="p-3 rounded-lg border" style={{
                background: "var(--bg-card)",
                borderColor: "var(--border-subtle)",
              }}>
                <span className="text-xs font-bold" style={{ color: "var(--accent-violet)" }}>
                  {item.label}:
                </span>
                <span className="text-xs ml-2" style={{ color: "var(--text-secondary)" }}>
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t px-6 py-4 mt-8" style={{ borderColor: "var(--border-subtle)" }}>
        <div className="max-w-6xl mx-auto text-xs text-center" style={{ color: "var(--text-secondary)" }}>
          Campaign Graph
        </div>
      </footer>
    </div>
  );
}
