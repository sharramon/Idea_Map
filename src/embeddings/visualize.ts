import * as fs from 'fs';
import * as path from 'path';
import { readJson } from '../data/store';
import type { EmbeddingsFile, EntryEmbeddingRecord } from './types';
import type { EntriesFile } from '../types';

// ── PCA (pure TS, no packages) ───────────────────────────────────────────────
// For n << dimensions, we work in the n×n gram space rather than the d×d
// covariance space. With 17 entries this is a 17×17 matrix instead of 1536×1536.

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function normalize(v: number[]): number[] {
  const n = Math.sqrt(dot(v, v));
  return n === 0 ? v : v.map(x => x / n);
}

function matVec(M: number[][], v: number[]): number[] {
  return M.map(row => dot(row, v));
}

function deflate(M: number[][], v: number[]): number[][] {
  // Remove component of eigenvector v from M: M -= λ * v * v^T
  const lam = dot(v, matVec(M, v));
  return M.map((row, i) => row.map((x, j) => x - lam * v[i] * v[j]));
}

function powerIteration(M: number[][], iterations = 200): number[] {
  let v = M[0].map(() => Math.random());
  v = normalize(v);
  for (let i = 0; i < iterations; i++) {
    v = normalize(matVec(M, v));
  }
  return v;
}

export function pca2d(vectors: number[][]): [number, number][] {
  const n = vectors.length;
  const d = vectors[0].length;

  // Center vectors
  const mean = new Array(d).fill(0);
  for (const v of vectors) for (let i = 0; i < d; i++) mean[i] += v[i] / n;
  const X = vectors.map(v => v.map((x, i) => x - mean[i]));

  // Gram matrix G = X * X^T  (n×n)
  const G: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => dot(X[i], X[j]))
  );

  // Top 2 eigenvectors of G
  const e1 = powerIteration(G);
  const G2 = deflate(G, e1);
  const e2 = powerIteration(G2);

  // Project: coords[i] = (dot(G_row_i, e1), dot(G_row_i, e2))
  return G.map(row => [dot(row, e1), dot(row, e2)]);
}

// ── Colour palette (matches existing graph) ──────────────────────────────────

const PALETTE = [
  '#58a6ff', '#3fb950', '#d29922', '#f78166', '#bc8cff',
  '#39d353', '#ffa657', '#79c0ff', '#ff7b72', '#56d364',
  '#e3b341', '#a5d6ff', '#ffb3ae', '#b3f0ff', '#d2a8ff',
];

// ── HTML builder ─────────────────────────────────────────────────────────────

interface PlotPoint {
  x: number;
  y: number;
  id: string;
  core_idea: string;
  primary_theme: string;
  tags: string[];
}

function buildHtml(points: PlotPoint[]): string {
  const themes = [...new Set(points.map(p => p.primary_theme))].sort();
  const themeColor = Object.fromEntries(themes.map((t, i) => [t, PALETTE[i % PALETTE.length]]));
  const data = JSON.stringify(points);
  const colors = JSON.stringify(themeColor);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Embedding Map</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0a0e14; color: #c9d1d9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; overflow: hidden; }
    canvas { display: block; }
    #tooltip {
      position: fixed; pointer-events: none; display: none;
      background: #161b22; border: 1px solid #30363d; border-radius: 8px;
      padding: 10px 14px; max-width: 300px; font-size: 13px; line-height: 1.5; z-index: 10;
    }
    #tooltip .theme { font-size: 11px; color: #8b949e; margin-bottom: 4px; }
    #tooltip .idea { color: #e6edf3; font-weight: 500; }
    #tooltip .tags { font-size: 11px; color: #8b949e; margin-top: 4px; }
    #legend {
      position: fixed; top: 16px; left: 16px; z-index: 10;
      display: flex; flex-direction: column; gap: 6px;
    }
    #legend h2 { font-size: 16px; font-weight: 700; color: #58a6ff; margin-bottom: 4px; }
    .legend-row { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #c9d1d9; }
    .legend-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    #note { position: fixed; bottom: 12px; left: 50%; transform: translateX(-50%);
      font-size: 11px; color: #484f58; }
  </style>
</head>
<body>
<canvas id="c"></canvas>
<div id="tooltip"><div class="theme"></div><div class="idea"></div><div class="tags"></div></div>
<div id="legend">
  <h2>Embedding Map</h2>
  <div style="font-size:11px;color:#8b949e;margin-bottom:6px;">PCA projection · semantic similarity</div>
  ${themes.map(t => `<div class="legend-row"><div class="legend-dot" style="background:${themeColor[t]}"></div>${t}</div>`).join('\n  ')}
</div>
<div id="note">Hover entries · proximity = semantic similarity</div>
<script>
const POINTS = ${data};
const COLORS = ${colors};

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const tooltip = document.getElementById('tooltip');

let W, H, scale, offsetX, offsetY;

function resize() {
  W = canvas.width  = window.innerWidth;
  H = canvas.height = window.innerHeight;
  draw();
}

function project() {
  const xs = POINTS.map(p => p.x), ys = POINTS.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = 0.12;
  const rangeX = maxX - minX || 1, rangeY = maxY - minY || 1;
  scale = Math.min(W * (1 - pad * 2) / rangeX, H * (1 - pad * 2) / rangeY);
  offsetX = W / 2 - ((minX + maxX) / 2) * scale;
  offsetY = H / 2 - ((minY + maxY) / 2) * scale;
}

function toScreen(x, y) {
  return [x * scale + offsetX, y * scale + offsetY];
}

function draw() {
  project();
  ctx.clearRect(0, 0, W, H);

  // Draw edges between nearby points (similarity > threshold)
  ctx.lineWidth = 1;
  for (let i = 0; i < POINTS.length; i++) {
    for (let j = i + 1; j < POINTS.length; j++) {
      const dx = POINTS[i].x - POINTS[j].x, dy = POINTS[i].y - POINTS[j].y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      const maxDist = Math.max(...POINTS.map(p => POINTS.map(q => {
        const d = Math.sqrt((p.x-q.x)**2 + (p.y-q.y)**2); return d;
      })).flat()) * 0.25;
      if (dist < maxDist) {
        const alpha = (1 - dist / maxDist) * 0.2;
        ctx.strokeStyle = \`rgba(88, 166, 255, \${alpha})\`;
        const [x1, y1] = toScreen(POINTS[i].x, POINTS[i].y);
        const [x2, y2] = toScreen(POINTS[j].x, POINTS[j].y);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
    }
  }

  // Draw points and labels
  for (const p of POINTS) {
    const [sx, sy] = toScreen(p.x, p.y);
    const color = COLORS[p.primary_theme] || '#8b949e';

    // Glow
    const grd = ctx.createRadialGradient(sx, sy, 0, sx, sy, 18);
    grd.addColorStop(0, color + '33');
    grd.addColorStop(1, 'transparent');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(sx, sy, 18, 0, Math.PI * 2); ctx.fill();

    // Dot
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(sx, sy, 6, 0, Math.PI * 2); ctx.fill();

    // Label
    const label = p.core_idea.length > 40 ? p.core_idea.slice(0, 38) + '…' : p.core_idea;
    ctx.fillStyle = '#8b949e';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.fillText(label, sx + 10, sy + 4);
  }
}

// Tooltip on hover
canvas.addEventListener('mousemove', e => {
  const mx = e.clientX, my = e.clientY;
  project();
  let hit = null, minDist = 20;
  for (const p of POINTS) {
    const [sx, sy] = toScreen(p.x, p.y);
    const d = Math.sqrt((mx - sx) ** 2 + (my - sy) ** 2);
    if (d < minDist) { minDist = d; hit = p; }
  }
  if (hit) {
    tooltip.style.display = 'block';
    tooltip.style.left = (mx + 16) + 'px';
    tooltip.style.top  = (my - 10) + 'px';
    tooltip.querySelector('.theme').textContent = hit.primary_theme;
    tooltip.querySelector('.idea').textContent  = hit.core_idea;
    tooltip.querySelector('.tags').textContent  = hit.tags.join(', ');
    canvas.style.cursor = 'pointer';
  } else {
    tooltip.style.display = 'none';
    canvas.style.cursor = 'default';
  }
});

window.addEventListener('resize', resize);
resize();
</script>
</body>
</html>`;
}

// ── Main export ──────────────────────────────────────────────────────────────

export function generateEmbeddingMap(outputPath: string): void {
  const embFile = readJson<EmbeddingsFile>('embeddings.json');
  const entFile = readJson<EntriesFile>('entries.json');

  if (!embFile.entries.length) throw new Error('No embeddings found. Run embed-backfill first.');

  const entryMap = new Map(entFile.entries.map(e => [e.id, e]));

  const records = embFile.entries.filter(r => entryMap.has(r.entry_id));
  const vectors = records.map(r => r.vector);
  const coords  = pca2d(vectors);

  const points: PlotPoint[] = records.map((r, i) => {
    const entry = entryMap.get(r.entry_id)!;
    return {
      x: coords[i][0],
      y: coords[i][1],
      id: r.entry_id,
      core_idea: entry.core_idea ?? r.entry_id,
      primary_theme: entry.primary_theme ?? 'unknown',
      tags: entry.tags ?? [],
    };
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buildHtml(points), 'utf-8');
}
