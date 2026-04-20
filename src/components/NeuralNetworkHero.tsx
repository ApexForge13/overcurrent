"use client";
/**
 * NeuralNetworkHero — Overcurrent tactical intelligence galaxy (Phase 13 hero).
 *
 * Ported from the Claude Design handoff bundle `neural-network/project/network.jsx`.
 * Renders a full-viewport Three.js galaxy with three concentric tiers
 * (inner cortex, middle regional sources, outer signal feeds), OrbitControls
 * (drag/zoom/pan), and a 7-phase scripted fact-check sequence with tactical HUD.
 *
 * `interactive` gates drag/zoom/pan + hover raycasting:
 *   - `true`  → consumer_paid+ or admin ("TIER·PREMIUM" badge, full controls)
 *   - `false` → free/unauthenticated ("TIER·READONLY", ambient rotate only)
 *
 * The demo auto-loops on its own for now. Phase 13/17 will wire this to a
 * real subscriber search input driving the pipeline.
 */
import {
  useEffect,
  useRef,
  useReducer,
  useState,
  Fragment,
  type CSSProperties,
} from "react";
import * as THREE from "three";

// ═══════════════ neon palette ═══════════════

const BG = 0x080c14;

const NEON = {
  cyan: 0x00f5d4,
  magenta: 0xff2e88,
  amber: 0xffb627,
  acid: 0xb6ff3c,
  violet: 0xb464ff,
  orange: 0xff6b1a,
  crimson: 0xff3030,
  ice: 0xa8e8ff,
  ocean: 0x2da4ff,
  rose: 0xff7ac2,
  gold: 0xffd24d,
  lime: 0xd0ff3c,
} as const;

const REGION_COLORS: Record<string, number> = {
  NA: 0xa8e8ff,
  EU: 0x7ac8ff,
  AP: 0xffd24d,
  ME: 0xffb627,
  LA: 0xff7ac2,
  AF: 0xb6ff3c,
};

const SIGNAL_COLORS: Record<string, number> = {
  maritime: NEON.ocean,
  satellite: NEON.ice,
  financial: NEON.amber,
  legal: NEON.gold,
  socialX: NEON.cyan,
  socialTG: NEON.violet,
  socialRD: NEON.orange,
  govt: NEON.crimson,
  env: NEON.acid,
  seismic: 0x7fbfff,
  aviation: 0xe8f1ff,
  ofac: NEON.crimson,
  grid: NEON.lime,
  arabic: 0xffd98a,
  spanish: 0xffb3a0,
};

type Annotation = { id: string; label: string; cluster: string };
const ANNOTATIONS: Annotation[] = [
  { id: "narrative", label: "NARRATIVE STREAM", cluster: "inner" },
  { id: "ground", label: "GROUND TRUTH SIGNALS", cluster: "outer_satellite" },
  { id: "psych", label: "PSYCHOLOGICAL LAYER", cluster: "outer_socialX" },
  { id: "military", label: "MILITARY CONFLICT", cluster: "outer_maritime" },
  { id: "trade", label: "TRADE DISPUTE", cluster: "outer_financial" },
  { id: "financial", label: "FINANCIAL SIGNAL", cluster: "outer_financial" },
  { id: "social", label: "SOCIAL / X · TELEGRAM", cluster: "outer_socialTG" },
  { id: "divergence", label: "DIVERGENCE DETECTED", cluster: "outer_govt" },
  { id: "seismic", label: "SEISMIC", cluster: "outer_seismic" },
  { id: "aviation", label: "AVIATION", cluster: "outer_aviation" },
  { id: "legal", label: "LEGAL / PACER", cluster: "outer_legal" },
  { id: "ofac", label: "SANCTIONS / OFAC", cluster: "outer_ofac" },
  { id: "grid", label: "ENERGY GRID", cluster: "outer_grid" },
  { id: "arabic", label: "ARABIC SIGNAL LAYER", cluster: "outer_arabic" },
  { id: "spanish", label: "SPANISH SIGNAL LAYER", cluster: "outer_spanish" },
  { id: "synthesis", label: "ACTIVE SYNTHESIS", cluster: "inner" },
];

// ═══════════════ helpers ═══════════════

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}
function gauss(s = 1) {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * s;
}

function warmShift(hex: number) {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  hsl.h = ((hsl.h * 360 + 25) % 360) / 360;
  hsl.s = Math.min(1, hsl.s + 0.1);
  c.setHSL(hsl.h, hsl.s, Math.min(0.8, hsl.l + 0.08));
  return c.getHex();
}

// Ring radii — inner 14, middle 52, outer 110 world units
const R_INNER = 14;
const R_MIDDLE = 52;
const R_OUTER = 110;

type Node = {
  pos: [number, number, number];
  color: number;
  size: number;
  tier: "inner" | "middle" | "outer";
  cluster: string;
  phase: number;
  pulseSpeed: number;
};

type Edge = { a: number; b: number; kind: EdgeKind };
type EdgeKind = "inner" | "middle" | "outer" | "spoke" | "divergence";

function buildInner(count = 50): Node[] {
  const nodes: Node[] = [];
  const modelCenters: Array<[number, number, number]> = [
    [R_INNER, 4, R_INNER * 0.3],
    [-R_INNER, 3, -R_INNER * 0.3],
    [R_INNER * 0.3, -5, -R_INNER],
    [-R_INNER * 0.3, -4, R_INNER],
  ];
  for (let i = 0; i < 6; i++) {
    nodes.push({
      pos: [gauss(2), gauss(2), gauss(2)],
      color: NEON.cyan,
      size: rand(9, 14),
      tier: "inner",
      cluster: "inner",
      phase: Math.random() * Math.PI * 2,
      pulseSpeed: rand(0.6, 1.0),
    });
  }
  for (const [cx, cy, cz] of modelCenters) {
    for (let i = 0; i < 11; i++) {
      nodes.push({
        pos: [cx + gauss(3), cy + gauss(3), cz + gauss(3)],
        color: NEON.cyan,
        size: rand(5, 9),
        tier: "inner",
        cluster: "inner",
        phase: Math.random() * Math.PI * 2,
        pulseSpeed: rand(0.4, 0.8),
      });
    }
  }
  return nodes.slice(0, count);
}

function buildMiddle(count = 320): Node[] {
  const regionCenters: Array<{ key: string; dir: [number, number, number] }> = [
    { key: "NA", dir: [1, 0.3, 0.5] },
    { key: "EU", dir: [0.2, 0.4, 1] },
    { key: "AP", dir: [-1, 0.2, 0.3] },
    { key: "ME", dir: [0.6, -0.2, -0.8] },
    { key: "LA", dir: [0.4, -0.8, 0.5] },
    { key: "AF", dir: [-0.4, -0.3, -1] },
  ];
  const nodes: Node[] = [];
  const perRegion = Math.floor(count / regionCenters.length);
  for (const { key, dir } of regionCenters) {
    const len = Math.hypot(dir[0], dir[1], dir[2]);
    const nx = dir[0] / len;
    const ny = dir[1] / len;
    const nz = dir[2] / len;
    for (let i = 0; i < 6; i++) {
      const r = R_MIDDLE + gauss(1);
      nodes.push({
        pos: [nx * r + gauss(2), ny * r + gauss(2), nz * r + gauss(2)],
        color: REGION_COLORS[key],
        size: rand(5, 8),
        tier: "middle",
        cluster: "middle_" + key,
        phase: Math.random() * Math.PI * 2,
        pulseSpeed: rand(0.3, 0.6),
      });
    }
    const remaining = perRegion - 6;
    for (let i = 0; i < remaining; i++) {
      const spread = 6 + Math.random() * 10;
      const r = R_MIDDLE + gauss(4);
      nodes.push({
        pos: [
          nx * r + gauss(spread),
          ny * r + gauss(spread),
          nz * r + gauss(spread),
        ],
        color: REGION_COLORS[key],
        size: rand(2.5, 5),
        tier: "middle",
        cluster: "middle_" + key,
        phase: Math.random() * Math.PI * 2,
        pulseSpeed: rand(0.3, 0.6),
      });
    }
  }
  return nodes;
}

function buildOuter(count = 1400): Node[] {
  const signalClusters: Array<{
    key: string;
    dir: [number, number, number];
    n: number;
  }> = [
    { key: "maritime", dir: [1, 0.2, -0.3], n: 120 },
    { key: "satellite", dir: [0.2, 1, 0.1], n: 95 },
    { key: "financial", dir: [-1, 0.1, 0.3], n: 130 },
    { key: "legal", dir: [-0.3, 0.5, -1], n: 75 },
    { key: "socialX", dir: [0.5, -0.2, 1], n: 130 },
    { key: "socialTG", dir: [0.7, -0.4, 0.6], n: 85 },
    { key: "socialRD", dir: [0.4, -0.8, -0.5], n: 80 },
    { key: "govt", dir: [-0.6, -0.5, 0.3], n: 80 },
    { key: "env", dir: [-0.8, 0.6, -0.2], n: 75 },
    { key: "seismic", dir: [0.1, -1, 0.2], n: 70 },
    { key: "aviation", dir: [0.9, 0.6, -0.1], n: 75 },
    { key: "ofac", dir: [-0.9, -0.2, -0.4], n: 60 },
    { key: "grid", dir: [-0.4, 0.9, 0.6], n: 70 },
    { key: "arabic", dir: [0.3, 0.1, -1], n: 85 },
    { key: "spanish", dir: [-0.2, -0.9, 0.7], n: 80 },
  ];
  const nodes: Node[] = [];
  for (const { key, dir, n } of signalClusters) {
    const len = Math.hypot(dir[0], dir[1], dir[2]);
    const nx = dir[0] / len;
    const ny = dir[1] / len;
    const nz = dir[2] / len;
    const nMain = Math.floor(n * 0.8);
    for (let i = 0; i < nMain; i++) {
      const spread = 12 + Math.random() * 16;
      const r = R_OUTER + gauss(8);
      nodes.push({
        pos: [
          nx * r + gauss(spread),
          ny * r + gauss(spread),
          nz * r + gauss(spread),
        ],
        color: SIGNAL_COLORS[key],
        size: rand(1.5, 4),
        tier: "outer",
        cluster: "outer_" + key,
        phase: Math.random() * Math.PI * 2,
        pulseSpeed: rand(0.2, 0.5),
      });
    }
    if (key.startsWith("social") || key === "arabic" || key === "spanish") {
      const nSub = n - nMain;
      const ox = nx + 0.4;
      const oy = ny - 0.15;
      const oz = nz + 0.3;
      const ol = Math.hypot(ox, oy, oz);
      for (let i = 0; i < nSub; i++) {
        const r = R_OUTER + 4 + gauss(6);
        nodes.push({
          pos: [
            (ox / ol) * r + gauss(8),
            (oy / ol) * r + gauss(8),
            (oz / ol) * r + gauss(8),
          ],
          color: warmShift(SIGNAL_COLORS[key]),
          size: rand(1.5, 3.5),
          tier: "outer",
          cluster: "outer_" + key,
          phase: Math.random() * Math.PI * 2,
          pulseSpeed: rand(0.2, 0.5),
        });
      }
    }
  }
  while (nodes.length < count) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = R_OUTER + 4 + gauss(10);
    nodes.push({
      pos: [
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta),
      ],
      color: 0x6890c0,
      size: rand(0.8, 2),
      tier: "outer",
      cluster: "outer_drift",
      phase: Math.random() * Math.PI * 2,
      pulseSpeed: rand(0.2, 0.5),
    });
  }
  return nodes.slice(0, count);
}

function shuffle<T>(a: T[]): T[] {
  const arr = a.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildEdges(allNodes: Node[]): Edge[] {
  const edges: Edge[] = [];
  const byTier: Record<"inner" | "middle" | "outer", number[]> = {
    inner: [],
    middle: [],
    outer: [],
  };
  allNodes.forEach((n, i) => byTier[n.tier].push(i));

  for (let i = 0; i < byTier.inner.length; i++) {
    for (let j = i + 1; j < byTier.inner.length; j++) {
      if (Math.random() < 0.45)
        edges.push({ a: byTier.inner[i], b: byTier.inner[j], kind: "inner" });
    }
  }

  for (const i of byTier.middle) {
    const a = allNodes[i];
    const same = byTier.middle.filter(
      (k) => k !== i && allNodes[k].cluster === a.cluster,
    );
    const picks = shuffle(same).slice(0, 2 + Math.floor(Math.random() * 2));
    for (const k of picks) edges.push({ a: i, b: k, kind: "middle" });
    if (Math.random() < 0.6) {
      const inner =
        byTier.inner[Math.floor(Math.random() * byTier.inner.length)];
      edges.push({ a: i, b: inner, kind: "spoke" });
    }
  }

  for (const i of byTier.outer) {
    const a = allNodes[i];
    const same = byTier.outer.filter(
      (k) => k !== i && allNodes[k].cluster === a.cluster,
    );
    if (same.length) {
      const picks = shuffle(same).slice(0, 1 + Math.floor(Math.random() * 2));
      for (const k of picks) edges.push({ a: i, b: k, kind: "outer" });
    }
    if (Math.random() < 0.5) {
      const mid =
        byTier.middle[Math.floor(Math.random() * byTier.middle.length)];
      edges.push({ a: i, b: mid, kind: "spoke" });
    }
  }

  for (let i = 0; i < 45; i++) {
    const a = byTier.outer[Math.floor(Math.random() * byTier.outer.length)];
    const b = byTier.middle[Math.floor(Math.random() * byTier.middle.length)];
    edges.push({ a, b, kind: "divergence" });
  }

  return edges;
}

function makeGlowTexture() {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.2, "rgba(255,255,255,0.85)");
  g.addColorStop(0.45, "rgba(255,255,255,0.25)");
  g.addColorStop(0.8, "rgba(255,255,255,0.03)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

// ═══════════════ sequencer config ═══════════════

const DEMO_TIME_SCALE = 24; // 1 real second = 24 simulated seconds shown in HUD

type PhaseKey =
  | "idle"
  | "prompt"
  | "ignite"
  | "search"
  | "classify"
  | "debate"
  | "synth"
  | "report"
  | "verdict";

type PhaseDef = {
  key: PhaseKey;
  label: string;
  dur: number;
  color: string;
  realMs: number;
};

const PHASES: PhaseDef[] = [
  { key: "idle", label: "AWAITING QUERY", dur: 0, color: "#7FA0C0", realMs: 0 },
  { key: "prompt", label: "PROMPT RECEIVED", dur: 1400, color: "#FFFFFF", realMs: 8_000 },
  { key: "ignite", label: "CORE IGNITION", dur: 1600, color: "#00F5D4", realMs: 20_000 },
  { key: "search", label: "SEARCHING SIGNALS", dur: 7500, color: "#FFB627", realMs: 240_000 },
  { key: "classify", label: "GEO-CLASSIFYING", dur: 6000, color: "#A8E8FF", realMs: 180_000 },
  { key: "debate", label: "MULTI-MODEL DEBATE", dur: 8000, color: "#FF2E88", realMs: 360_000 },
  { key: "synth", label: "SYNTHESIZING", dur: 4000, color: "#00F5D4", realMs: 120_000 },
  { key: "report", label: "DRAFTING REPORT", dur: 7000, color: "#B464FF", realMs: 240_000 },
  { key: "verdict", label: "REPORT COMPLETE", dur: 999999, color: "#B6FF3C", realMs: 0 },
];

const GEO_REGIONS = [
  { key: "middle_NA", label: "NORTH AMERICA", abbr: "NA", color: "#00F5D4" },
  { key: "middle_EU", label: "EUROPE", abbr: "EU", color: "#A8E8FF" },
  { key: "middle_AP", label: "ASIA-PACIFIC", abbr: "AP", color: "#FFB627" },
  { key: "middle_ME", label: "MIDDLE EAST", abbr: "ME", color: "#FF7AC2" },
  { key: "middle_LA", label: "LATIN AMERICA", abbr: "LA", color: "#B464FF" },
  { key: "middle_AF", label: "AFRICA", abbr: "AF", color: "#B6FF3C" },
] as const;

const EXCERPT_POOL: Array<[string, string]> = [
  ["REUTERS · 14:02Z", "Maritime AIS shows 3 PLAN vessels cold-silent east of Yilan 22h ago"],
  ["AIS · MARINETRAFFIC", "Carrier CVN-17 last beacon 23.4°N 122.1°E — now dark"],
  ["TELEGRAM · @ISW_UA", "Unconfirmed: 3rd corps relocating south of Tokmak — awaiting BDA"],
  ["PLANET LABS · SKYSAT", "Hard-stand imagery 04:11Z: 14 new revetments at Fordow ingress"],
  ["OFAC · SDN DELTA", "Entity BOGATYR-HOLDINGS added 2h ago — correlates with 3 wallet txs"],
  ["SEC · EDGAR", "No 8-K filed for MSTR as of 17:44Z; halt claim unsupported"],
  ["USGS · M3.1 @ 33.72N", "Shallow seismic 12km NNE of Natanz — signature matches subsurface"],
  ["X · @shashj", "Claims 'visible smoke' — geolocates to unrelated refinery fire in Bandar"],
  ["BLOOMBERG · TERM", "No block-trade prints on MSTR above 200k shr since 16:22Z"],
  ["WEIBO · 千里眼", "Port-of-Kaohsiung vessel count nominal; 2 military vessels routine"],
  ["ARABIC · SKY NEWS AR", "Source: IRGC denies enrichment restart, calls it 'Western fabrication'"],
  ["SPANISH · CLARIN", "No local press corroborates carrier claim out of Taiwan bureau"],
  ["GITHUB · DPRK-WATCH", "Commit at 04:22Z ingests 4 new maritime seeds — ground-truth priors"],
  ["FLIGHTAWARE · ADS-B", "RC-135W loitering over Black Sea for 9h — pattern match: recon sweep"],
  ["CNA · 中央社", "Taiwan MND briefing silent on 7th-fleet movement; routine posture"],
  ["DOJ · FARA FILINGS", "No registrations touching the 3 candidate intermediaries last 72h"],
  ["CLAUDE · SYNTHESIS", "Narrative CONTRADICTS primary ground-truth at 2/3 vectors"],
  ["GPT-5 · SYNTHESIS", "Concurs on vector A + B; divergence at vector C (social amplification)"],
];

const SEARCH_ORDER = [
  "outer_socialX", "outer_financial", "outer_satellite",
  "outer_maritime", "outer_aviation", "outer_govt",
  "outer_ofac", "outer_socialTG", "outer_arabic",
  "outer_legal", "outer_env", "outer_grid",
  "outer_spanish", "outer_socialRD", "outer_seismic",
];
const CLASSIFY_ORDER = GEO_REGIONS.map((r) => r.key);
const DEBATE_MODELS = ["CLAUDE-4", "GPT-5", "GEMINI-2", "GROK-3"] as const;

const SAMPLE_QUERIES = [
  "Did China deploy PLAN carrier group east of Taiwan this week?",
  "Is Russia preparing a new Kherson offensive in next 48h?",
  "Has Iran resumed enrichment at Fordow?",
  "Did the SEC halt trading on MicroStrategy today?",
  "Was there a seismic event flagged near Natanz overnight?",
];

// ═══════════════ orbit controls (self-contained) ═══════════════

type OrbitCtrl = {
  update: () => void;
  dispose: () => void;
  setEnabled: (v: boolean) => void;
};

function makeOrbitControls(
  camera: THREE.PerspectiveCamera,
  dom: HTMLElement,
  opts: { enabled?: boolean } = {},
): OrbitCtrl {
  let enabled = opts.enabled !== false;
  const target = new THREE.Vector3(0, 0, 0);
  const spherical = new THREE.Spherical();
  const offset = new THREE.Vector3();
  offset.copy(camera.position).sub(target);
  spherical.setFromVector3(offset);

  let rotating = false;
  let panning = false;
  let last = { x: 0, y: 0 };
  const spinVel = { t: 0.001 };
  let userInput = 0;

  function onDown(e: PointerEvent) {
    if (!enabled) return;
    last = { x: e.clientX, y: e.clientY };
    if (e.button === 2) panning = true;
    else rotating = true;
    dom.style.cursor = "grabbing";
    userInput = performance.now();
  }
  function onMove(e: PointerEvent) {
    if (!enabled) return;
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    if (rotating) {
      spherical.theta -= dx * 0.005;
      spherical.phi -= dy * 0.005;
      spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi));
      userInput = performance.now();
    } else if (panning) {
      const panX = -dx * spherical.radius * 0.0015;
      const panY = dy * spherical.radius * 0.0015;
      const right = new THREE.Vector3();
      const up = new THREE.Vector3();
      camera.matrixWorld.extractBasis(right, up, new THREE.Vector3());
      target.addScaledVector(right, panX).addScaledVector(up, panY);
      userInput = performance.now();
    }
    last = { x: e.clientX, y: e.clientY };
  }
  function onUp() {
    rotating = false;
    panning = false;
    dom.style.cursor = enabled ? "grab" : "default";
  }
  function onWheel(e: WheelEvent) {
    if (!enabled) return;
    // Only zoom when Shift is held — otherwise let the wheel scroll the page
    // so users can reach the feed below the hero. UX affordance: the bottom-
    // right hint line documents "SHIFT+SCROLL · ZOOM".
    if (!e.shiftKey) return;
    e.preventDefault();
    spherical.radius *= 1 + e.deltaY * 0.001;
    spherical.radius = Math.max(30, Math.min(480, spherical.radius));
    userInput = performance.now();
  }
  function onContext(e: Event) {
    e.preventDefault();
  }

  dom.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  dom.addEventListener("wheel", onWheel, { passive: false });
  dom.addEventListener("contextmenu", onContext);

  return {
    update() {
      const idle = performance.now() - userInput > 3000;
      if (idle) spherical.theta += spinVel.t;
      offset.setFromSpherical(spherical);
      camera.position.copy(target).add(offset);
      camera.lookAt(target);
    },
    dispose() {
      dom.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      dom.removeEventListener("wheel", onWheel as EventListener);
      dom.removeEventListener("contextmenu", onContext);
    },
    setEnabled(v: boolean) {
      enabled = v;
      dom.style.cursor = v ? "grab" : "default";
    },
  };
}

// ═══════════════ main component ═══════════════

type AnnPos = Record<string, { x: number; y: number; z: number }>;
type Excerpt = { t: number; source: string; text: string };
type GeoHit = { region: string; atMs: number };
type Verdict = {
  label: string;
  color: string;
  confidence: number;
  divergence: number;
};

/**
 * Real-story overlay. When passed, the sequencer uses this story's query +
 * locks its verdict stats on completion; "VIEW DOSSIER" links to `dossierUrl`.
 * When null/undefined, the hero runs the demo reel with random sample queries.
 */
export interface HeroStory {
  query: string;
  sourceCount: number;
  pageCount: number;
  verdictLabel: string;
  verdictColor: string;
  confidence: number;
  divergence: number;
  dossierUrl: string;
}

export interface NeuralNetworkHeroProps {
  /** Gates drag/zoom/pan + hover raycast. Wire to tier check. */
  interactive?: boolean;
  /** Optional real-story override. When omitted, runs the demo reel. */
  story?: HeroStory | null;
}

export function NeuralNetworkHero({
  interactive = true,
  story = null,
}: NeuralNetworkHeroProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const fpsRef = useRef<HTMLDivElement | null>(null);
  const coordsRef = useRef<HTMLDivElement | null>(null);
  const [annPositions, setAnnPositions] = useState<AnnPos>({});
  const [annLevels, setAnnLevels] = useState<Record<string, number>>({});
  const [phase, setPhase] = useState<PhaseKey>("idle");
  const [phaseProgress, setPhaseProgress] = useState(0);
  const [typedQuery, setTypedQuery] = useState("");
  const [, setActiveFeeds] = useState<string[]>([]);
  const [, setDebateModel] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [queryStartT, setQueryStartT] = useState<number | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [excerpts, setExcerpts] = useState<Excerpt[]>([]);
  const [geoHits, setGeoHits] = useState<GeoHit[]>([]);
  const [sourcesRead, setSourcesRead] = useState(0);
  const kickoffRef = useRef<(() => void) | null>(null);
  // Keep live refs so the (expensive) Three.js effect only mounts once —
  // prop changes update refs, not the effect's deps.
  const storyRef = useRef<HeroStory | null>(story);
  const interactiveRef = useRef(interactive);
  const controlsSetEnabledRef = useRef<((v: boolean) => void) | null>(null);
  useEffect(() => {
    storyRef.current = story;
  }, [story]);
  useEffect(() => {
    interactiveRef.current = interactive;
    controlsSetEnabledRef.current?.(interactive);
  }, [interactive]);
  const devMode =
    typeof window !== "undefined" && /[?&]dev=1/.test(window.location.search);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const W = () => mount.clientWidth || window.innerWidth;
    const H = () => mount.clientHeight || window.innerHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BG);
    scene.fog = new THREE.FogExp2(BG, 0.0038);

    const camera = new THREE.PerspectiveCamera(50, W() / H(), 0.1, 900);
    camera.position.set(0, 40, 240);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W(), H());
    renderer.setClearColor(BG, 1);
    mount.appendChild(renderer.domElement);

    const controls = makeOrbitControls(camera, renderer.domElement, {
      enabled: interactiveRef.current,
    });
    controlsSetEnabledRef.current = (v: boolean) => controls.setEnabled(v);

    // build graph
    const innerNodes = buildInner(50);
    const middleNodes = buildMiddle(320);
    const outerNodes = buildOuter(1400);
    const allNodes = [...innerNodes, ...middleNodes, ...outerNodes];
    const edges = buildEdges(allNodes);

    const tiers = [
      { key: "inner" as const, nodes: innerNodes },
      { key: "middle" as const, nodes: middleNodes },
      { key: "outer" as const, nodes: outerNodes },
    ];
    const tierOffset: Record<"inner" | "middle" | "outer", number> = {
      inner: 0,
      middle: innerNodes.length,
      outer: innerNodes.length + middleNodes.length,
    };

    const glowTex = makeGlowTexture();

    type TierObj = {
      pts: THREE.Points;
      geom: THREE.BufferGeometry;
      mat: THREE.ShaderMaterial;
    };

    function buildNodeTier(tierNodes: Node[]): TierObj {
      const n = tierNodes.length;
      const positions = new Float32Array(n * 3);
      const colors = new Float32Array(n * 3);
      const sizes = new Float32Array(n);
      const activations = new Float32Array(n);
      const col = new THREE.Color();
      tierNodes.forEach((nd, i) => {
        positions[i * 3 + 0] = nd.pos[0];
        positions[i * 3 + 1] = nd.pos[1];
        positions[i * 3 + 2] = nd.pos[2];
        col.setHex(nd.color);
        colors[i * 3 + 0] = col.r;
        colors[i * 3 + 1] = col.g;
        colors[i * 3 + 2] = col.b;
        sizes[i] = nd.size * 10;
      });
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geom.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
      geom.setAttribute("aAct", new THREE.BufferAttribute(activations, 1));

      const mat = new THREE.ShaderMaterial({
        uniforms: {
          glowMap: { value: glowTex },
          uPixelRatio: { value: renderer.getPixelRatio() },
          uScreenH: { value: H() },
        },
        vertexShader: `
          attribute float aSize;
          attribute float aAct;
          varying vec3 vColor;
          varying float vAct;
          uniform float uPixelRatio;
          uniform float uScreenH;
          void main() {
            vColor = color;
            vAct = aAct;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            float dist = -mv.z;
            float scaleBoost = 1.0 + aAct * 0.9;
            gl_PointSize = aSize * scaleBoost * (uScreenH / (dist + 0.001)) * 0.15 * uPixelRatio;
            gl_PointSize = clamp(gl_PointSize, 1.0, 180.0);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: `
          uniform sampler2D glowMap;
          varying vec3 vColor;
          varying float vAct;
          void main() {
            vec4 g = texture2D(glowMap, gl_PointCoord);
            if (g.a < 0.01) discard;
            vec3 hot = mix(vColor, vec3(1.0), vAct * 0.6);
            float a = g.a * (0.9 + vAct * 0.4);
            gl_FragColor = vec4(hot * (1.0 + vAct * 1.8), a);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexColors: true,
      });
      const pts = new THREE.Points(geom, mat);
      pts.frustumCulled = false;
      return { pts, geom, mat };
    }

    const tierObjects: Record<"inner" | "middle" | "outer", TierObj> = {
      inner: buildNodeTier(tiers[0].nodes),
      middle: buildNodeTier(tiers[1].nodes),
      outer: buildNodeTier(tiers[2].nodes),
    };
    for (const t of tiers) scene.add(tierObjects[t.key].pts);

    // edges
    const edgeKindColors: Record<EdgeKind, THREE.Color> = {
      inner: new THREE.Color(NEON.cyan),
      middle: new THREE.Color(0xb8d8ff),
      outer: new THREE.Color(0x88aacc),
      spoke: new THREE.Color(0xcce8ff),
      divergence: new THREE.Color(NEON.magenta),
    };
    const edgeBaseOpacity: Record<EdgeKind, number> = {
      inner: 0.55,
      middle: 0.18,
      outer: 0.09,
      spoke: 0.14,
      divergence: 0.45,
    };

    type EdgeGroup = {
      lines: THREE.LineSegments;
      mat: THREE.LineBasicMaterial;
      list: Edge[];
      kind: EdgeKind;
    };

    function makeEdgeLines(kind: EdgeKind, list: Edge[]): EdgeGroup {
      const positions = new Float32Array(list.length * 2 * 3);
      const colors = new Float32Array(list.length * 2 * 3);
      const col = edgeKindColors[kind];
      list.forEach((e, idx) => {
        const A = allNodes[e.a].pos;
        const B = allNodes[e.b].pos;
        positions.set([A[0], A[1], A[2], B[0], B[1], B[2]], idx * 6);
        colors.set(
          [col.r, col.g, col.b, col.r, col.g, col.b],
          idx * 6,
        );
      });
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      const mat = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: edgeBaseOpacity[kind],
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const lines = new THREE.LineSegments(geom, mat);
      lines.frustumCulled = false;
      scene.add(lines);
      return { lines, mat, list, kind };
    }

    const byKind: Record<EdgeKind, Edge[]> = {
      inner: [],
      middle: [],
      outer: [],
      spoke: [],
      divergence: [],
    };
    edges.forEach((e) => byKind[e.kind].push(e));
    const edgeGroups: Record<EdgeKind, EdgeGroup> = {
      inner: makeEdgeLines("inner", byKind.inner),
      middle: makeEdgeLines("middle", byKind.middle),
      outer: makeEdgeLines("outer", byKind.outer),
      spoke: makeEdgeLines("spoke", byKind.spoke),
      divergence: makeEdgeLines("divergence", byKind.divergence),
    };

    // pulse particles flowing inward/outward along edges
    const PULSE_POOL = 180;
    const pulsePositions = new Float32Array(PULSE_POOL * 3);
    const pulseColors = new Float32Array(PULSE_POOL * 3);
    const pulseSizes = new Float32Array(PULSE_POOL);
    const pulseAlpha = new Float32Array(PULSE_POOL);
    type PulseState = {
      active: boolean;
      edge?: Edge;
      kind?: string;
      t: number;
      speed: number;
    };
    const pulseState: PulseState[] = Array.from({ length: PULSE_POOL }, () => ({
      active: false,
      t: 0,
      speed: 0,
    }));
    const pulseGeom = new THREE.BufferGeometry();
    pulseGeom.setAttribute("position", new THREE.BufferAttribute(pulsePositions, 3));
    pulseGeom.setAttribute("color", new THREE.BufferAttribute(pulseColors, 3));
    pulseGeom.setAttribute("aSize", new THREE.BufferAttribute(pulseSizes, 1));
    pulseGeom.setAttribute("aAlpha", new THREE.BufferAttribute(pulseAlpha, 1));
    const pulseMat = new THREE.ShaderMaterial({
      uniforms: {
        glowMap: { value: glowTex },
        uPixelRatio: { value: renderer.getPixelRatio() },
        uScreenH: { value: H() },
      },
      vertexShader: `
        attribute float aSize;
        attribute float aAlpha;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float uPixelRatio;
        uniform float uScreenH;
        void main() {
          vColor = color;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float dist = -mv.z;
          gl_PointSize = aSize * (uScreenH / (dist + 0.001)) * 0.12 * uPixelRatio;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform sampler2D glowMap;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 g = texture2D(glowMap, gl_PointCoord);
          if (g.a < 0.01) discard;
          gl_FragColor = vec4(vColor * 2.2, g.a * vAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });
    const pulsePoints = new THREE.Points(pulseGeom, pulseMat);
    pulsePoints.frustumCulled = false;
    scene.add(pulsePoints);

    function spawnPulse(edge: Edge, kind: string) {
      for (let i = 0; i < PULSE_POOL; i++) {
        if (!pulseState[i].active) {
          pulseState[i] = {
            active: true,
            edge,
            kind,
            t: 0,
            speed: 0.35 + Math.random() * 0.35,
          };
          let c: THREE.Color;
          if (kind === "divergence") c = edgeKindColors.divergence;
          else if (kind === "inner") c = edgeKindColors.inner;
          else c = new THREE.Color(0xffffff);
          pulseColors[i * 3 + 0] = c.r;
          pulseColors[i * 3 + 1] = c.g;
          pulseColors[i * 3 + 2] = c.b;
          pulseSizes[i] = 18 + Math.random() * 18;
          return;
        }
      }
    }

    // clusters
    const clusters: Record<string, number[]> = {};
    allNodes.forEach((n, i) => {
      (clusters[n.cluster] = clusters[n.cluster] || []).push(i);
    });
    const clusterKeys = Object.keys(clusters);

    // sequencer state
    type Firing = {
      cluster: string;
      t0: number;
      duration: number;
      intensity: number;
    };
    const firings: Firing[] = [];
    const globalActivations = new Float32Array(allNodes.length);
    const coreBloomRef = { v: 0 };

    type Seq = {
      phase: PhaseKey;
      phaseStart: number;
      searchDone: Set<string>;
      classifyDone: Set<string>;
      debateTicks: number;
      debateNext: number;
      searchNext: number;
      classifyNext: number;
      excerptNext: number;
      pageNext: number;
      sourcesNext: number;
      ambientNext: number;
      queryStart: number;
    };
    const seq: Seq = {
      phase: "idle",
      phaseStart: 0,
      searchDone: new Set(),
      classifyDone: new Set(),
      debateTicks: 0,
      debateNext: 0,
      searchNext: 0,
      classifyNext: 0,
      excerptNext: 0,
      pageNext: 0,
      sourcesNext: 0,
      ambientNext: 0,
      queryStart: 0,
    };

    function getPhaseDef(key: PhaseKey) {
      return PHASES.find((p) => p.key === key)!;
    }

    function advancePhase(to: PhaseKey, tNow: number) {
      seq.phase = to;
      seq.phaseStart = tNow;
      seq.searchNext = tNow + 180;
      seq.classifyNext = tNow + 160;
      seq.debateNext = tNow + 300;
      seq.excerptNext = tNow + 400;
      seq.pageNext = tNow + 250;
      seq.sourcesNext = tNow + 80;
      seq.searchDone = new Set();
      seq.classifyDone = new Set();
      setPhase(to);
      if (to === "ignite") {
        coreBloomRef.v = 1.2;
        firings.push({ cluster: "inner", t0: tNow, duration: 2600, intensity: 1.0 });
        const spokes = edgeGroups.spoke.list.slice();
        for (let k = 0; k < 60; k++) {
          const e = spokes[Math.floor(Math.random() * spokes.length)];
          if (e) spawnPulse(e, "spoke-out");
        }
      }
      if (to === "verdict") {
        const s = storyRef.current;
        if (s) {
          // Real-story mode: lock in the story's verdict + snap final counters.
          setVerdict({
            label: s.verdictLabel,
            color: s.verdictColor,
            confidence: s.confidence,
            divergence: s.divergence,
          });
          setSourcesRead(s.sourceCount);
          setPageCount(s.pageCount);
        } else {
          const states: Verdict[] = [
            { label: "CORROBORATED", color: "#B6FF3C", confidence: 92, divergence: 3 },
            { label: "DISPUTED", color: "#FFB627", confidence: 64, divergence: 48 },
            { label: "CONTRADICTED", color: "#FF2E88", confidence: 81, divergence: 127 },
            { label: "UNVERIFIED", color: "#A8E8FF", confidence: 38, divergence: 12 },
          ];
          setVerdict(states[Math.floor(Math.random() * states.length)]);
        }
      }
      if (to !== "verdict") setVerdict(null);
      if (to !== "debate") setDebateModel(null);
    }

    function kickoffQuery() {
      const now = performance.now();
      // Prefer the real-story query when available; otherwise rotate demo samples.
      const q =
        storyRef.current?.query ??
        SAMPLE_QUERIES[Math.floor(Math.random() * SAMPLE_QUERIES.length)];
      setTypedQuery("");
      setQueryStartT(now);
      setPageCount(0);
      setExcerpts([]);
      setGeoHits([]);
      setSourcesRead(0);
      let i = 0;
      const tid = window.setInterval(() => {
        i++;
        setTypedQuery(q.slice(0, i));
        if (i >= q.length) window.clearInterval(tid);
      }, 22);
      advancePhase("prompt", now);
      seq.queryStart = now;
    }
    kickoffRef.current = kickoffQuery;

    // Wait up to 5s for the story fetch, then fire regardless. If the story
    // arrives before the deadline, fire immediately with the real query.
    // Single-shot via kickedOff; never fires twice from this scheduler.
    const mountTs = performance.now();
    let kickedOff = false;
    let pollTid = 0;
    function tryKickoff() {
      if (kickedOff) return;
      const waited = performance.now() - mountTs;
      if (storyRef.current || waited >= 5000) {
        kickedOff = true;
        kickoffQuery();
      } else {
        pollTid = window.setTimeout(tryKickoff, 150);
      }
    }
    const startTimer = window.setTimeout(tryKickoff, 300);

    function tickSequencer(now: number) {
      const def = getPhaseDef(seq.phase);
      const elapsed = now - seq.phaseStart;
      const p = def.dur > 0 ? Math.min(1, elapsed / def.dur) : 0;
      setPhaseProgress(p);

      const isWorkPhase = ["search", "classify", "debate", "synth", "report"].includes(seq.phase);
      if (isWorkPhase) {
        if (now >= seq.sourcesNext) {
          const rate =
            seq.phase === "search" ? 60 : seq.phase === "classify" ? 22 : 8;
          seq.sourcesNext = now + 120;
          setSourcesRead((s) => s + rate + Math.floor(Math.random() * rate));
        }
        if (now >= seq.excerptNext) {
          seq.excerptNext = now + 500 + Math.random() * 700;
          const pool = EXCERPT_POOL.filter((e) => {
            if (seq.phase === "debate")
              return e[0].includes("SYNTHESIS") || Math.random() < 0.4;
            return true;
          });
          const pick = pool[Math.floor(Math.random() * pool.length)];
          setExcerpts((prev) =>
            [{ t: now, source: pick[0], text: pick[1] }, ...prev].slice(0, 6),
          );
        }
      }
      if (seq.phase === "report" && now >= seq.pageNext) {
        seq.pageNext = now + 140 + Math.random() * 180;
        setPageCount((p2) => p2 + 1);
      }

      if (seq.phase === "idle") return;

      if (seq.phase === "prompt") {
        for (const i of clusters.inner || [])
          globalActivations[i] = Math.max(
            globalActivations[i],
            0.3 + 0.2 * Math.sin(now * 0.008),
          );
        if (elapsed >= def.dur) advancePhase("ignite", now);
        return;
      }

      if (seq.phase === "ignite") {
        coreBloomRef.v *= 0.97;
        const waveR = (elapsed / def.dur) * 170;
        const waveWidth = 28;
        for (let i = 0; i < allNodes.length; i++) {
          const n = allNodes[i];
          const d = Math.hypot(n.pos[0], n.pos[1], n.pos[2]);
          const dist = Math.abs(d - waveR);
          if (dist < waveWidth) {
            const act = (1 - dist / waveWidth) * 0.9;
            globalActivations[i] = Math.max(globalActivations[i], act);
          }
        }
        if (elapsed >= def.dur) advancePhase("search", now);
        return;
      }

      if (seq.phase === "search") {
        const stepDur = def.dur / SEARCH_ORDER.length;
        for (let i = 0; i < SEARCH_ORDER.length; i++) {
          const cstart = i * stepDur;
          if (elapsed >= cstart && !seq.searchDone.has(SEARCH_ORDER[i])) {
            const ck = SEARCH_ORDER[i];
            seq.searchDone.add(ck);
            if (clusters[ck]) {
              firings.push({ cluster: ck, t0: now, duration: 1900, intensity: 0.9 });
              const spokes = edgeGroups.spoke.list.filter(
                (e) =>
                  allNodes[e.a].cluster === ck || allNodes[e.b].cluster === ck,
              );
              for (let k = 0; k < Math.min(10, spokes.length); k++) {
                spawnPulse(
                  spokes[Math.floor(Math.random() * spokes.length)],
                  "spoke-out",
                );
              }
            }
          }
        }
        const active: string[] = [];
        for (const f of firings) {
          if (f.cluster.startsWith("outer_")) active.push(f.cluster);
        }
        setActiveFeeds(active);
        if (elapsed >= def.dur) {
          setActiveFeeds([]);
          advancePhase("classify", now);
        }
        return;
      }

      if (seq.phase === "classify") {
        const stepDur = def.dur / CLASSIFY_ORDER.length;
        for (let i = 0; i < CLASSIFY_ORDER.length; i++) {
          const cstart = i * stepDur;
          if (elapsed >= cstart && !seq.classifyDone.has(CLASSIFY_ORDER[i])) {
            const ck = CLASSIFY_ORDER[i];
            seq.classifyDone.add(ck);
            if (clusters[ck]) {
              firings.push({ cluster: ck, t0: now, duration: 2000, intensity: 0.85 });
              const spokes = edgeGroups.spoke.list.filter(
                (e) =>
                  allNodes[e.a].cluster === ck || allNodes[e.b].cluster === ck,
              );
              for (let k = 0; k < Math.min(8, spokes.length); k++) {
                spawnPulse(
                  spokes[Math.floor(Math.random() * spokes.length)],
                  "spoke-in",
                );
              }
              const atRealMs = (now - (seq.queryStart || now)) * DEMO_TIME_SCALE;
              setGeoHits((prev) => [...prev, { region: ck, atMs: atRealMs }]);
            }
          }
        }
        if (elapsed >= def.dur) advancePhase("debate", now);
        return;
      }

      if (seq.phase === "debate") {
        for (const i of clusters.inner || [])
          globalActivations[i] = Math.max(globalActivations[i], 0.85);
        if (now >= seq.debateNext) {
          seq.debateNext = now + 380;
          seq.debateTicks++;
          const mIdx = seq.debateTicks % 4;
          setDebateModel(DEBATE_MODELS[mIdx]);
          const inner = edgeGroups.inner.list;
          for (let k = 0; k < 8; k++) {
            if (inner.length)
              spawnPulse(
                inner[Math.floor(Math.random() * inner.length)],
                "debate",
              );
          }
          if (Math.random() < 0.5 && edgeGroups.divergence.list.length) {
            const e =
              edgeGroups.divergence.list[
                Math.floor(Math.random() * edgeGroups.divergence.list.length)
              ];
            spawnPulse(e, "divergence");
          }
        }
        if (elapsed >= def.dur) advancePhase("synth", now);
        return;
      }

      if (seq.phase === "synth") {
        coreBloomRef.v = Math.min(1.5, coreBloomRef.v + 0.04);
        for (const i of clusters.inner || [])
          globalActivations[i] = Math.max(globalActivations[i], 0.95);
        if (Math.random() < 0.5) {
          const spokes = edgeGroups.spoke.list;
          if (spokes.length)
            spawnPulse(
              spokes[Math.floor(Math.random() * spokes.length)],
              "spoke-in",
            );
        }
        if (elapsed >= def.dur) advancePhase("report", now);
        return;
      }

      if (seq.phase === "report") {
        coreBloomRef.v = Math.max(0.9, coreBloomRef.v * 0.995 + 0.01);
        for (const i of clusters.inner || [])
          globalActivations[i] = Math.max(globalActivations[i], 0.8);
        if (Math.random() < 0.08) {
          const spokes = edgeGroups.spoke.list;
          if (spokes.length)
            spawnPulse(
              spokes[Math.floor(Math.random() * spokes.length)],
              "spoke-out",
            );
        }
        if (elapsed >= def.dur) advancePhase("verdict", now);
        return;
      }

      if (seq.phase === "verdict") {
        coreBloomRef.v *= 0.995;
        coreBloomRef.v = Math.max(0.5, coreBloomRef.v);
        for (const i of clusters.inner || [])
          globalActivations[i] = Math.max(globalActivations[i], 0.75);
        if (elapsed > 5000 && now > seq.ambientNext) {
          seq.ambientNext = now + 900 + Math.random() * 900;
          const keys = clusterKeys.filter(
            (k) => k !== "outer_drift" && k !== "inner",
          );
          const ck = keys[Math.floor(Math.random() * keys.length)];
          firings.push({ cluster: ck, t0: now, duration: 2400, intensity: 0.6 });
          const spokes = edgeGroups.spoke.list.filter(
            (e) =>
              allNodes[e.a].cluster === ck || allNodes[e.b].cluster === ck,
          );
          if (spokes.length)
            spawnPulse(
              spokes[Math.floor(Math.random() * spokes.length)],
              "spoke-in",
            );
        }
      }
    }

    // hover raycast
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points = { threshold: 3 };
    const mouseNDC = new THREE.Vector2(-2, -2);

    function onPointerMove(e: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      if (coordsRef.current) {
        coordsRef.current.textContent = `X ${(mouseNDC.x * 100).toFixed(1).padStart(6)}  Y ${(mouseNDC.y * 100).toFixed(1).padStart(6)}`;
      }
    }
    renderer.domElement.addEventListener("pointermove", onPointerMove);

    function onResize() {
      const w = W();
      const h = H();
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      for (const t of Object.values(tierObjects))
        t.mat.uniforms.uScreenH.value = h;
      pulseMat.uniforms.uScreenH.value = h;
    }
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);
    requestAnimationFrame(onResize);

    // annotation centers — cluster centroid pushed outward
    const annCenters: Record<string, THREE.Vector3> = {};
    for (const a of ANNOTATIONS) {
      const idxs = clusters[a.cluster] || clusters.inner;
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (const i of idxs) {
        cx += allNodes[i].pos[0];
        cy += allNodes[i].pos[1];
        cz += allNodes[i].pos[2];
      }
      cx /= idxs.length;
      cy /= idxs.length;
      cz /= idxs.length;
      const len = Math.hypot(cx, cy, cz) || 1;
      const mag = Math.max(len + 30, R_OUTER + 22);
      annCenters[a.id] = new THREE.Vector3(
        (cx / len) * mag,
        (cy / len) * mag,
        (cz / len) * mag,
      );
    }

    function updateAnnPositions() {
      const positions: AnnPos = {};
      const v = new THREE.Vector3();
      for (const a of ANNOTATIONS) {
        v.copy(annCenters[a.id]).project(camera);
        positions[a.id] = {
          x: (v.x * 0.5 + 0.5) * W(),
          y: (-v.y * 0.5 + 0.5) * H(),
          z: v.z,
        };
      }
      setAnnPositions(positions);
    }

    let frames = 0;
    let fpsStart = performance.now();
    let rafId = 0;
    const clockStart = performance.now();

    function animate() {
      rafId = requestAnimationFrame(animate);
      try {
      const now = performance.now();
      const tSec = (now - clockStart) / 1000;

      controls.update();
      tickSequencer(now);

      // decay
      for (let i = 0; i < globalActivations.length; i++)
        globalActivations[i] *= 0.955;

      // annotation levels from active firings
      const annLevelsLocal: Record<string, number> = {};
      for (const f of firings) {
        const p = (now - f.t0) / f.duration;
        if (p >= 1) continue;
        const e = Math.sin(p * Math.PI) * f.intensity;
        const idxs = clusters[f.cluster];
        if (idxs)
          for (const i of idxs)
            globalActivations[i] = Math.max(globalActivations[i], e);
        for (const a of ANNOTATIONS) {
          if (a.cluster === f.cluster) {
            annLevelsLocal[a.id] = Math.max(annLevelsLocal[a.id] || 0, e);
          }
        }
      }
      for (let fi = firings.length - 1; fi >= 0; fi--) {
        if ((now - firings[fi].t0) / firings[fi].duration >= 1)
          firings.splice(fi, 1);
      }
      if (frames % 4 === 0) setAnnLevels(annLevelsLocal);

      // inner always lit
      for (const i of clusters.inner || [])
        globalActivations[i] = Math.max(globalActivations[i], 0.6);

      // hover raycast (paid tier only)
      if (interactiveRef.current) {
        raycaster.setFromCamera(mouseNDC, camera);
        let best: { hit: THREE.Intersection; tier: TierObj } | null = null;
        let bestDist = Infinity;
        for (const t of Object.values(tierObjects)) {
          const hits = raycaster.intersectObject(t.pts, false);
          if (hits.length && hits[0].distance < bestDist) {
            best = { hit: hits[0], tier: t };
            bestDist = hits[0].distance;
          }
        }
        if (best && typeof best.hit.index === "number") {
          const hoverNode = best.hit.index;
          const tName =
            best.tier === tierObjects.inner
              ? "inner"
              : best.tier === tierObjects.middle
                ? "middle"
                : "outer";
          const global = tierOffset[tName] + hoverNode;
          globalActivations[global] = Math.max(globalActivations[global], 1.0);
        }
      }

      // write activations per tier
      for (const t of tiers) {
        const obj = tierObjects[t.key];
        const acts = obj.geom.attributes.aAct.array as Float32Array;
        for (let i = 0; i < t.nodes.length; i++) {
          const global = tierOffset[t.key] + i;
          const breathe =
            0.5 +
            0.5 * Math.sin(tSec * t.nodes[i].pulseSpeed + t.nodes[i].phase);
          acts[i] = globalActivations[global] + breathe * 0.12;
        }
        obj.geom.attributes.aAct.needsUpdate = true;
      }

      // edge shimmer
      edgeGroups.inner.mat.opacity = 0.45 + 0.15 * Math.sin(tSec * 0.8);
      edgeGroups.middle.mat.opacity = 0.15 + 0.05 * Math.sin(tSec * 0.5 + 1);
      edgeGroups.outer.mat.opacity = 0.07 + 0.03 * Math.sin(tSec * 0.4 + 2);
      edgeGroups.spoke.mat.opacity = 0.12 + 0.06 * Math.sin(tSec * 0.6 + 3);
      edgeGroups.divergence.mat.opacity = 0.35 + 0.2 * Math.sin(tSec * 1.1);

      // pulse particles
      const dt = 0.016;
      for (let i = 0; i < PULSE_POOL; i++) {
        const s = pulseState[i];
        if (!s.active || !s.edge) {
          pulseAlpha[i] = 0;
          continue;
        }
        s.t += dt * s.speed;
        if (s.t >= 1) {
          s.active = false;
          pulseAlpha[i] = 0;
          continue;
        }
        const A = allNodes[s.edge.a].pos;
        const B = allNodes[s.edge.b].pos;
        const distA = Math.hypot(A[0], A[1], A[2]);
        const distB = Math.hypot(B[0], B[1], B[2]);
        const [from, to] = distA > distB ? [A, B] : [B, A];
        const u = s.t;
        pulsePositions[i * 3 + 0] = from[0] + (to[0] - from[0]) * u;
        pulsePositions[i * 3 + 1] = from[1] + (to[1] - from[1]) * u;
        pulsePositions[i * 3 + 2] = from[2] + (to[2] - from[2]) * u;
        pulseAlpha[i] = Math.sin(u * Math.PI);
      }
      pulseGeom.attributes.position.needsUpdate = true;
      pulseGeom.attributes.aAlpha.needsUpdate = true;
      pulseGeom.attributes.aSize.needsUpdate = true;
      pulseGeom.attributes.color.needsUpdate = true;

      frames++;
      if (frames % 5 === 0) updateAnnPositions();
      if (now - fpsStart > 500) {
        const fps = Math.round((frames * 1000) / (now - fpsStart));
        if (fpsRef.current) fpsRef.current.textContent = fps + " FPS";
        frames = 0;
        fpsStart = now;
      }

      renderer.render(scene, camera);
      } catch (err) {
        // Log once and let it bubble — devs get the stack, users see a dead
        // canvas but the rest of the page keeps working.
        console.error("[NeuralNetworkHero] animate error:", err);
        throw err;
      }
    }
    animate();

    return () => {
      kickedOff = true; // prevent any pending tryKickoff from firing after unmount
      cancelAnimationFrame(rafId);
      window.clearTimeout(startTimer);
      window.clearTimeout(pollTid);
      ro.disconnect();
      controls.dispose();
      window.removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
      renderer.dispose();
      // dispose geometries/materials
      for (const t of Object.values(tierObjects)) {
        t.geom.dispose();
        t.mat.dispose();
      }
      for (const g of Object.values(edgeGroups)) {
        g.lines.geometry.dispose();
        g.mat.dispose();
      }
      pulseGeom.dispose();
      pulseMat.dispose();
      glowTex.dispose();
    };
    // Intentionally mount-once: all props read via refs to avoid reinitializing
    // the Three.js scene on every prop tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ═══════════════ HUD ═══════════════
  return (
    <div
      className="relative w-full h-full overflow-hidden"
      style={{ background: "#080C14" }}
    >
      <div
        ref={mountRef}
        className="absolute inset-0"
        style={{ cursor: interactive ? "grab" : "default" }}
      />

      {/* subtle dotted grid */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          opacity: 0.06,
          backgroundImage:
            "radial-gradient(circle, #00F5D4 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      {/* scan line */}
      <div
        className="pointer-events-none absolute left-0 right-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(0,245,212,0.5), transparent)",
          animation: "ocScan 8s linear infinite",
          top: "50%",
          boxShadow: "0 0 18px rgba(0,245,212,0.5)",
        }}
      />

      {/* vignette */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 50%, rgba(8,12,20,0.85) 100%)",
        }}
      />

      {/* top bar */}
      <div className="absolute top-0 left-0 right-0 flex items-start justify-between px-10 pt-7 pointer-events-none select-none">
        <div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              letterSpacing: "0.4em",
              color: "rgba(0,245,212,0.85)",
              marginBottom: 4,
            }}
          >
            ◈ OC / INTEL-01 / LIVE
          </div>
          <div
            style={{
              fontFamily: "'Inter', sans-serif",
              fontVariantCaps: "all-small-caps",
              letterSpacing: "0.32em",
              color: "rgba(255,255,255,0.92)",
              fontSize: 26,
              fontWeight: 500,
              textShadow: "0 0 24px rgba(0,245,212,0.25)",
            }}
          >
            OVERCURRENT
          </div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              letterSpacing: "0.28em",
              color: "rgba(255,255,255,0.45)",
              fontSize: 10,
              marginTop: 6,
            }}
          >
            GLOBAL INTELLIGENCE INFRASTRUCTURE
          </div>
        </div>

        <div
          className="flex flex-col items-end gap-1"
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            letterSpacing: "0.22em",
          }}
        >
          <div
            className="flex items-center gap-3"
            style={{ color: "rgba(255,255,255,0.6)" }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 99,
                background: "#00F5D4",
                boxShadow: "0 0 10px #00F5D4",
                animation: "ocPulse 1.8s ease-in-out infinite",
              }}
            />
            <span>{interactive ? "TIER·PREMIUM" : "TIER·READONLY"}</span>
          </div>
          <div style={{ color: "rgba(255,255,255,0.42)", fontSize: 9 }}>
            NODES·1,370 &nbsp; EDGES·4.2K &nbsp; STREAMS·40+
          </div>
          <div style={{ color: "rgba(0,245,212,0.55)", fontSize: 9 }}>
            <UtcClock />
          </div>
        </div>
      </div>

      <SectorMapToggle />

      <PhaseReadout
        phase={phase}
        phaseProgress={phaseProgress}
        query={typedQuery}
      />

      <LiveStats
        phase={phase}
        queryStartT={queryStartT}
        pageCount={pageCount}
        sourcesRead={sourcesRead}
      />

      <ExcerptFeed excerpts={excerpts} />

      <GeoTimeline hits={geoHits} phase={phase} />

      {verdict && (
        <VerdictCard
          verdict={verdict}
          pageCount={pageCount}
          sourcesRead={sourcesRead}
          elapsed={
            queryStartT ? (performance.now() - queryStartT) * DEMO_TIME_SCALE : 0
          }
          onReset={() => kickoffRef.current?.()}
          dossierUrl={story?.dossierUrl ?? null}
        />
      )}

      {/* controls hint + coords */}
      <div
        className="absolute bottom-8 right-10 pointer-events-none text-right"
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 9,
          letterSpacing: "0.2em",
          color: "rgba(255,255,255,0.4)",
        }}
      >
        <div
          ref={coordsRef}
          style={{ color: "rgba(0,245,212,0.7)", marginBottom: 6 }}
        >
          X 0.0 Y 0.0
        </div>
        <div>
          {interactive
            ? "DRAG · ORBIT | SHIFT+SCROLL · ZOOM | R-CLICK · PAN"
            : "READ-ONLY · UPGRADE TO INTERACT"}
        </div>
      </div>

      {/* crosshair reticle */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2"
        style={{ transform: "translate(-50%,-50%)" }}
      >
        <Reticle />
      </div>

      {/* annotations */}
      {Object.entries(annPositions).map(([id, p]) => {
        const ann = ANNOTATIONS.find((a) => a.id === id);
        if (!ann || p.z > 1 || p.z < -1) return null;
        const level = annLevels[id] || 0;
        return (
          <AnnotationBox key={id} label={ann.label} x={p.x} y={p.y} level={level} />
        );
      })}

      <CornerBrackets />

      {devMode && (
        <div
          ref={fpsRef}
          className="absolute bottom-6 pointer-events-none"
          style={{
            right: "16rem",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            letterSpacing: "0.15em",
            color: "rgba(0,245,212,0.85)",
            padding: "4px 10px",
            border: "1px solid rgba(0,245,212,0.4)",
            background: "rgba(8,12,20,0.75)",
          }}
        >
          -- FPS
        </div>
      )}

      <style>{`
        @keyframes ocPulse { 0%,100% { opacity: 1 } 50% { opacity: 0.3 } }
        @keyframes ocFade  { 0% { opacity: 0.95 } 100% { opacity: 0 } }
        @keyframes ocBlink { 0%,100% { opacity: 1 } 50% { opacity: 0.25 } }
        @keyframes ocScan  { 0% { transform: translateY(-40vh) } 100% { transform: translateY(40vh) } }
        @keyframes ocSpin  { to { transform: rotate(360deg) } }
        @keyframes ocFadeIn { 0% { opacity: 0; transform: translate(-50%, -50%) scale(0.92) } 100% { opacity: 1; transform: translate(-50%, -50%) scale(1) } }
        @keyframes ocGeoPop { 0% { transform: scale(0.4); opacity: 0 } 60% { transform: scale(1.4) } 100% { transform: scale(1); opacity: 1 } }
        @keyframes ocExcIn  { 0% { opacity: 0; transform: translateX(6px) } 100% { opacity: 1; transform: translateX(0) } }
      `}</style>
    </div>
  );
}

// ═══════════════ HUD sub-components ═══════════════

function UtcClock() {
  const [, tick] = useReducer((s: number) => s + 1, 0);
  useEffect(() => {
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  return <span>UTC {new Date().toISOString().slice(11, 19)}Z</span>;
}

function Reticle() {
  const c = "rgba(0,245,212,0.35)";
  return (
    <div style={{ width: 120, height: 120, position: "relative" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          border: `1px dashed ${c}`,
          borderRadius: "50%",
          animation: "ocSpin 60s linear infinite",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 22,
          border: `1px solid ${c}`,
          borderRadius: "50%",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 0,
          bottom: 0,
          width: 1,
          background: c,
          transform: "translateX(-50%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: 0,
          right: 0,
          height: 1,
          background: c,
          transform: "translateY(-50%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: 3,
          height: 3,
          background: "#00F5D4",
          borderRadius: 99,
          transform: "translate(-50%,-50%)",
          boxShadow: "0 0 8px #00F5D4",
        }}
      />
    </div>
  );
}

function AnnotationBox({
  label,
  x,
  y,
  level = 0,
}: {
  label: string;
  x: number;
  y: number;
  level?: number;
}) {
  const a = Math.min(1, level);
  const border = `rgba(0,245,212,${0.18 + a * 0.8})`;
  const text = `rgba(255,255,255,${0.2 + a * 0.78})`;
  const bg =
    a > 0.15 ? `rgba(0,245,212,${a * 0.14})` : "rgba(8,12,20,0.65)";
  const active = a > 0.3;
  const corner: CSSProperties = { position: "absolute", width: 5, height: 5 };
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: x,
        top: y,
        transform: "translate(-50%,-50%)",
        opacity: 0.25 + a * 0.75,
        transition: "opacity 0.5s ease",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "100%",
          width: 1,
          height: 26,
          background: `linear-gradient(to bottom, ${border}, transparent)`,
          transform: "translateX(-50%)",
        }}
      />
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 9,
          letterSpacing: "0.24em",
          color: text,
          padding: "6px 11px",
          background: bg,
          border: `1px solid ${border}`,
          whiteSpace: "nowrap",
          boxShadow: active
            ? `0 0 ${12 + a * 16}px rgba(0,245,212,${a * 0.5})`
            : "none",
          transition: "all 0.35s ease",
          position: "relative",
        }}
      >
        <span
          style={{
            color: active ? "#00F5D4" : "rgba(0,245,212,0.45)",
            marginRight: 8,
          }}
        >
          ◇
        </span>
        {label}
        {active && (
          <span
            style={{
              marginLeft: 8,
              color: "#00F5D4",
              animation: "ocBlink 1.2s ease-in-out infinite",
            }}
          >
            ●
          </span>
        )}
        <span style={{ ...corner, top: -1, left: -1, borderTop: `1px solid ${border}`, borderLeft: `1px solid ${border}` }} />
        <span style={{ ...corner, top: -1, right: -1, borderTop: `1px solid ${border}`, borderRight: `1px solid ${border}` }} />
        <span style={{ ...corner, bottom: -1, left: -1, borderBottom: `1px solid ${border}`, borderLeft: `1px solid ${border}` }} />
        <span style={{ ...corner, bottom: -1, right: -1, borderBottom: `1px solid ${border}`, borderRight: `1px solid ${border}` }} />
      </div>
    </div>
  );
}

function SectorMapToggle() {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="absolute bottom-8 left-10"
      style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 9,
        letterSpacing: "0.22em",
        color: "rgba(255,255,255,0.55)",
        pointerEvents: "auto",
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          background: "rgba(8,12,20,0.7)",
          border: "1px solid rgba(0,245,212,0.35)",
          color: "rgba(0,245,212,0.9)",
          padding: "5px 10px",
          fontSize: 9,
          letterSpacing: "0.25em",
          fontFamily: "inherit",
          cursor: "pointer",
        }}
      >
        ◇ {open ? "HIDE" : "INFO"} · ARCHITECTURE
      </button>
      {open && (
        <div
          style={{
            marginTop: 8,
            padding: "10px 12px",
            background: "rgba(8,12,20,0.85)",
            border: "1px solid rgba(0,245,212,0.25)",
            minWidth: 220,
          }}
        >
          <div style={{ color: "#00F5D4", marginBottom: 8 }}>◇ SECTOR MAP</div>
          {(
            [
              ["INNER · DEBATE", "050", "#00F5D4"],
              ["MIDDLE · SOURCES", "320", "#A8E8FF"],
              ["OUTER · SIGNALS", "1,000+", "#FFB627"],
            ] as Array<[string, string, string]>
          ).map(([l, v, c]) => (
            <div
              key={l}
              className="flex justify-between"
              style={{ padding: "2px 0", color: "rgba(255,255,255,0.6)" }}
            >
              <span>▸ {l}</span>
              <span style={{ color: c, textShadow: `0 0 6px ${c}` }}>{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function fmtTime(ms: number) {
  if (!isFinite(ms) || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function PhaseReadout({
  phase,
  phaseProgress,
  query,
}: {
  phase: PhaseKey;
  phaseProgress: number;
  query: string;
}) {
  const [, tick] = useReducer((s: number) => s + 1, 0);
  useEffect(() => {
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, []);
  const p = PHASES.find((x) => x.key === phase);
  if (!p || phase === "idle") return null;

  const phaseIdx = PHASES.findIndex((x) => x.key === phase);
  const totalReal = PHASES.reduce((s, ph) => s + ph.realMs, 0);
  const doneReal =
    PHASES.slice(0, phaseIdx).reduce((s, ph) => s + ph.realMs, 0) +
    phaseProgress * p.realMs;
  const overall = Math.min(1, doneReal / totalReal);
  const etaRemain = Math.max(0, totalReal - doneReal);

  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: "50%",
        bottom: 44,
        transform: "translateX(-50%)",
        fontFamily: "'JetBrains Mono', monospace",
        textAlign: "center",
        width: 640,
        maxWidth: "calc(100vw - 48px)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          fontSize: 9,
          letterSpacing: "0.32em",
          marginBottom: 6,
          padding: "0 4px",
        }}
      >
        <span style={{ color: p.color, textShadow: `0 0 10px ${p.color}` }}>
          ◈ {p.label}
        </span>
        <span style={{ color: "rgba(255,255,255,0.5)" }}>
          PHASE {phaseIdx}/{PHASES.length - 2} · {Math.round(phaseProgress * 100)}%
        </span>
      </div>

      <div style={{ display: "flex", gap: 3, marginBottom: 8, height: 4 }}>
        {PHASES.slice(1, -1).map((ph, i) => {
          const thisIdx = i + 1;
          const filled =
            thisIdx < phaseIdx ? 1 : thisIdx === phaseIdx ? phaseProgress : 0;
          const isActive = thisIdx === phaseIdx;
          return (
            <div
              key={ph.key}
              style={{
                flex: ph.realMs,
                background: "rgba(255,255,255,0.06)",
                position: "relative",
                border: isActive ? `1px solid ${ph.color}66` : "1px solid transparent",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  width: `${filled * 100}%`,
                  background: ph.color,
                  opacity: filled > 0 ? 0.85 : 0,
                  boxShadow: isActive ? `0 0 10px ${ph.color}` : "none",
                  transition: "width 0.3s ease",
                }}
              />
            </div>
          );
        })}
      </div>

      {query && (
        <div
          style={{
            fontSize: 11,
            letterSpacing: "0.05em",
            color: "rgba(255,255,255,0.88)",
            maxWidth: 640,
            lineHeight: 1.5,
            padding: "8px 14px",
            border: "1px solid rgba(0,245,212,0.28)",
            background: "rgba(8,12,20,0.78)",
            textAlign: "left",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>
            <span style={{ color: "rgba(0,245,212,0.7)", marginRight: 8 }}>▸</span>
            {query}
            <span
              style={{
                color: "#00F5D4",
                marginLeft: 2,
                animation: "ocBlink 0.8s infinite",
              }}
            >
              █
            </span>
          </span>
          <span
            style={{
              color: "rgba(255,255,255,0.4)",
              fontSize: 9,
              letterSpacing: "0.22em",
              paddingLeft: 14,
              borderLeft: "1px solid rgba(255,255,255,0.12)",
              marginLeft: 14,
            }}
          >
            ETA <span style={{ color: p.color }}>{fmtTime(etaRemain)}</span>
            <span style={{ margin: "0 8px", color: "rgba(255,255,255,0.2)" }}>|</span>
            <span style={{ color: "rgba(255,255,255,0.7)" }}>
              {Math.round(overall * 100)}%
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

function LiveStats({
  phase,
  queryStartT,
  pageCount,
  sourcesRead,
}: {
  phase: PhaseKey;
  queryStartT: number | null;
  pageCount: number;
  sourcesRead: number;
}) {
  const [, tick] = useReducer((s: number) => s + 1, 0);
  useEffect(() => {
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, []);
  if (phase === "idle" || !queryStartT) return null;
  const elapsedReal = (performance.now() - queryStartT) * DEMO_TIME_SCALE;
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        top: 112,
        right: 40,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 9,
        letterSpacing: "0.22em",
        color: "rgba(255,255,255,0.7)",
        padding: "10px 14px",
        border: "1px solid rgba(0,245,212,0.28)",
        background: "rgba(8,12,20,0.72)",
        textAlign: "right",
        minWidth: 180,
      }}
    >
      <div
        style={{
          color: "#00F5D4",
          marginBottom: 8,
          letterSpacing: "0.3em",
        }}
      >
        ◇ RUN STATS
      </div>
      <StatsRow label="ELAPSED" v={fmtTime(elapsedReal)} c="#FFFFFF" />
      <StatsRow label="SOURCES" v={sourcesRead.toLocaleString()} c="#A8E8FF" />
      <StatsRow label="PAGES" v={pageCount || "—"} c="#B464FF" />
    </div>
  );
}

function StatsRow({
  label,
  v,
  c,
}: {
  label: string;
  v: string | number;
  c: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 14,
        padding: "2px 0",
        fontSize: 9,
      }}
    >
      <span style={{ color: "rgba(255,255,255,0.45)" }}>{label}</span>
      <span style={{ color: c, textShadow: `0 0 6px ${c}` }}>{v}</span>
    </div>
  );
}

function ExcerptFeed({ excerpts }: { excerpts: Excerpt[] }) {
  if (!excerpts.length) return null;
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        top: 250,
        right: 40,
        width: 280,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 9,
        letterSpacing: "0.06em",
        color: "rgba(255,255,255,0.7)",
      }}
    >
      <div
        style={{
          color: "rgba(0,245,212,0.9)",
          fontSize: 9,
          letterSpacing: "0.3em",
          marginBottom: 10,
        }}
      >
        ◇ SOURCE INGEST · LIVE
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {excerpts.map((e, i) => (
          <div
            key={e.t}
            style={{
              opacity: 1 - i * 0.14,
              padding: "7px 10px",
              background: "rgba(8,12,20,0.65)",
              borderLeft: `2px solid rgba(0,245,212,${0.8 - i * 0.1})`,
              animation: i === 0 ? "ocExcIn 0.45s ease-out" : "none",
            }}
          >
            <div
              style={{
                color: "rgba(0,245,212,0.7)",
                fontSize: 8,
                letterSpacing: "0.2em",
                marginBottom: 3,
              }}
            >
              {e.source}
            </div>
            <div
              style={{
                color: "rgba(255,255,255,0.82)",
                fontSize: 10,
                lineHeight: 1.4,
                letterSpacing: 0,
              }}
            >
              {e.text}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GeoTimeline({
  hits,
  phase,
}: {
  hits: GeoHit[];
  phase: PhaseKey;
}) {
  if (phase === "idle") return null;
  const hitMap = Object.fromEntries(hits.map((h) => [h.region, h.atMs]));
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        bottom: 44,
        left: 40,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 9,
        letterSpacing: "0.22em",
        color: "rgba(255,255,255,0.6)",
        background: "rgba(8,12,20,0.78)",
        border: "1px solid rgba(0,245,212,0.22)",
        padding: "10px 14px",
      }}
    >
      <div
        style={{
          color: "rgba(0,245,212,0.9)",
          marginBottom: 10,
          letterSpacing: "0.3em",
        }}
      >
        ◇ GEOGRAPHIC SPREAD
      </div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 0 }}>
        {GEO_REGIONS.map((r, i) => {
          const hit = hitMap[r.key];
          const active = hit !== undefined;
          const nextActive =
            i < GEO_REGIONS.length - 1 &&
            hitMap[GEO_REGIONS[i + 1].key] !== undefined;
          return (
            <Fragment key={r.key}>
              <div
                style={{
                  textAlign: "center",
                  minWidth: 78,
                  opacity: active ? 1 : 0.35,
                  transition: "opacity 0.5s ease",
                }}
              >
                <div
                  style={{
                    width: 10,
                    height: 10,
                    margin: "0 auto 6px",
                    borderRadius: "50%",
                    background: active ? r.color : "transparent",
                    border: `1px solid ${active ? r.color : "rgba(255,255,255,0.25)"}`,
                    boxShadow: active ? `0 0 12px ${r.color}` : "none",
                    animation: active ? "ocGeoPop 0.5s ease-out" : "none",
                  }}
                />
                <div
                  style={{
                    fontSize: 8,
                    letterSpacing: "0.22em",
                    color: active ? r.color : "rgba(255,255,255,0.4)",
                  }}
                >
                  {r.abbr}
                </div>
                <div
                  style={{
                    fontSize: 8,
                    letterSpacing: "0.08em",
                    marginTop: 3,
                    color: active ? "rgba(255,255,255,0.65)" : "rgba(255,255,255,0.2)",
                  }}
                >
                  {active ? `+${fmtTime(hit)}` : "—:—"}
                </div>
              </div>
              {i < GEO_REGIONS.length - 1 && (
                <div
                  style={{
                    flex: 1,
                    height: 1,
                    marginTop: 15,
                    minWidth: 18,
                    background:
                      active && nextActive
                        ? `linear-gradient(90deg, ${r.color}, ${GEO_REGIONS[i + 1].color})`
                        : active
                          ? `linear-gradient(90deg, ${r.color}, rgba(255,255,255,0.08))`
                          : "rgba(255,255,255,0.08)",
                    opacity: 0.8,
                  }}
                />
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function VerdictCard({
  verdict,
  pageCount,
  sourcesRead,
  elapsed,
  onReset,
  dossierUrl,
}: {
  verdict: Verdict;
  pageCount: number;
  sourcesRead: number;
  elapsed: number;
  onReset: () => void;
  /** When non-null, the "OPEN DOSSIER" button becomes a link to this URL. */
  dossierUrl?: string | null;
}) {
  return (
    <div
      className="absolute"
      style={{
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        fontFamily: "'JetBrains Mono', monospace",
        pointerEvents: "auto",
        minWidth: 480,
        padding: "24px 30px",
        background: "rgba(8,12,20,0.94)",
        border: `1px solid ${verdict.color}`,
        boxShadow: `0 0 52px ${verdict.color}66, inset 0 0 36px rgba(0,0,0,0.7)`,
        backdropFilter: "blur(6px)",
        animation: "ocFadeIn 0.6s ease-out",
      }}
    >
      <div
        style={{
          fontSize: 9,
          letterSpacing: "0.4em",
          color: "rgba(255,255,255,0.55)",
          marginBottom: 4,
        }}
      >
        ◇ REPORT COMPLETE · OC-SYNTHESIS / v4.2
      </div>
      <div
        style={{
          fontSize: 9,
          letterSpacing: "0.28em",
          color: "rgba(255,255,255,0.35)",
          marginBottom: 16,
        }}
      >
        RUN TIME {fmtTime(elapsed)} · {pageCount}-PAGE DOSSIER
      </div>
      <div
        style={{
          fontSize: 30,
          letterSpacing: "0.16em",
          fontWeight: 500,
          color: verdict.color,
          textShadow: `0 0 24px ${verdict.color}`,
          marginBottom: 20,
        }}
      >
        {verdict.label}
      </div>
      <div
        className="grid grid-cols-4 gap-4"
        style={{
          fontSize: 9,
          letterSpacing: "0.2em",
          color: "rgba(255,255,255,0.55)",
        }}
      >
        <VerdictStat label="CONFIDENCE" v={verdict.confidence + "%"} c={verdict.color} />
        <VerdictStat label="SOURCES" v={sourcesRead.toLocaleString()} c="#A8E8FF" />
        <VerdictStat label="PAGES" v={pageCount} c="#B464FF" />
        <VerdictStat label="DIVERGENCE" v={verdict.divergence} c="#FF2E88" />
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
        {dossierUrl ? (
          <a
            href={dossierUrl}
            style={{
              flex: 1,
              background: verdict.color,
              color: "#0a0f18",
              border: "none",
              padding: "9px 12px",
              fontSize: 9,
              letterSpacing: "0.3em",
              fontFamily: "inherit",
              cursor: "pointer",
              fontWeight: 600,
              textAlign: "center",
              textDecoration: "none",
            }}
          >
            ◇ OPEN DOSSIER
          </a>
        ) : (
          <button
            style={{
              flex: 1,
              background: verdict.color,
              color: "#0a0f18",
              border: "none",
              padding: "9px 12px",
              fontSize: 9,
              letterSpacing: "0.3em",
              fontFamily: "inherit",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            ◇ OPEN DOSSIER
          </button>
        )}
        <button
          onClick={onReset}
          style={{
            flex: 1,
            background: "transparent",
            color: "rgba(0,245,212,0.9)",
            border: "1px solid rgba(0,245,212,0.5)",
            padding: "9px 12px",
            fontSize: 9,
            letterSpacing: "0.3em",
            fontFamily: "inherit",
            cursor: "pointer",
          }}
        >
          ◇ NEW QUERY
        </button>
      </div>
    </div>
  );
}

function VerdictStat({
  label,
  v,
  c,
}: {
  label: string;
  v: string | number;
  c: string;
}) {
  return (
    <div>
      <div style={{ marginBottom: 4 }}>{label}</div>
      <div
        style={{
          color: c,
          fontSize: 16,
          letterSpacing: "0.08em",
          textShadow: `0 0 8px ${c}`,
        }}
      >
        {v}
      </div>
    </div>
  );
}

function CornerBrackets() {
  const color = "rgba(0,245,212,0.3)";
  const size = 28;
  const s = (extra: CSSProperties): CSSProperties => ({
    position: "absolute",
    width: size,
    height: size,
    ...extra,
  });
  return (
    <>
      <div style={s({ top: 16, left: 16, borderTop: `1px solid ${color}`, borderLeft: `1px solid ${color}` })} />
      <div style={s({ top: 16, right: 16, borderTop: `1px solid ${color}`, borderRight: `1px solid ${color}` })} />
      <div style={s({ bottom: 16, left: 16, borderBottom: `1px solid ${color}`, borderLeft: `1px solid ${color}` })} />
      <div style={s({ bottom: 16, right: 16, borderBottom: `1px solid ${color}`, borderRight: `1px solid ${color}` })} />
    </>
  );
}

export default NeuralNetworkHero;
