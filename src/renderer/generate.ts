import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { getGraph } from '../data/graph';
import { GraphData } from '../types';

function buildHtml(data: GraphData): string {
  const injected = JSON.stringify(data);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Idea Map</title>
  <script src="https://unpkg.com/cytoscape/dist/cytoscape.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0a0e14; color: #c9d1d9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; overflow: hidden; }
    #cy { position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 1; }

    #theme-labels {
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      pointer-events: none; z-index: 2; overflow: hidden;
    }
    .theme-label {
      position: absolute; transform: translate(-50%, -100%);
      font-size: 11px; font-weight: 600; letter-spacing: 0.03em;
      text-align: center; max-width: 180px; line-height: 1.3;
      opacity: 0.55; white-space: normal;
      text-shadow: 0 0 20px rgba(10, 14, 20, 0.98), 0 1px 3px rgba(0,0,0,0.9);
      margin-top: -36px;
    }

    #controls {
      position: fixed; top: 16px; left: 16px; z-index: 10;
      display: flex; flex-direction: column; gap: 10px;
    }
    #controls h1 { font-size: 20px; font-weight: 700; color: #58a6ff; letter-spacing: -0.3px; }
    #stats { font-size: 12px; color: #8b949e; }
    .control-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

    select, button {
      background: #161b22; border: 1px solid #30363d; color: #c9d1d9;
      padding: 6px 12px; border-radius: 6px; font-size: 13px; cursor: pointer;
    }
    select:focus, button:hover { border-color: #58a6ff; outline: none; }
    .btn-primary { background: #1f3a5f; border-color: #388bfd; color: #e6edf3; }
    .btn-primary:hover { background: #264a7a; }

    #info-panel {
      position: fixed; right: 0; top: 0; width: 340px; height: 100vh;
      background: #161b22; border-left: 1px solid #30363d;
      padding: 24px 20px; overflow-y: auto;
      transform: translateX(100%); transition: transform 0.22s ease; z-index: 10;
    }
    #info-panel.open { transform: translateX(0); }
    #info-close {
      position: absolute; top: 14px; right: 14px;
      background: none; border: none; color: #8b949e;
      font-size: 22px; cursor: pointer; padding: 4px 8px; line-height: 1;
    }
    #info-close:hover { color: #c9d1d9; }
    #info-panel h2 { font-size: 15px; color: #e6edf3; margin-bottom: 16px; padding-right: 28px; line-height: 1.45; font-weight: 600; }
    .info-section { margin-bottom: 16px; }
    .info-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; color: #8b949e; margin-bottom: 5px; }
    .info-value { font-size: 13px; color: #c9d1d9; line-height: 1.55; }
    .info-meta { font-size: 12px; color: #8b949e; }
    .tag-list { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 4px; }
    .tag {
      background: #21262d; border: 1px solid #30363d; border-radius: 4px;
      padding: 3px 8px; font-size: 11px; color: #8b949e; cursor: default;
    }
    .tag.clickable { cursor: pointer; }
    .tag.clickable:hover { border-color: #58a6ff; color: #c9d1d9; }
    .theme-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }

    .entry-link {
      display: block; padding: 10px 12px; margin-bottom: 8px;
      background: #0d1117; border: 1px solid #30363d; border-radius: 6px;
      cursor: pointer; text-decoration: none; color: inherit;
    }
    .entry-link:hover { border-color: #58a6ff; }
    .entry-link-title { font-size: 12px; color: #58a6ff; margin-bottom: 4px; }
    .entry-link-snippet { font-size: 12px; color: #8b949e; line-height: 1.45; }

    .legend {
      position: fixed; bottom: 16px; left: 16px; z-index: 11;
      background: #161b22; border: 1px solid #30363d; border-radius: 8px;
      padding: 0; max-height: 220px; overflow: hidden;
      min-width: 160px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.35);
    }
    .legend.legend-collapsed { max-height: none; }
    .legend-header {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 8px 10px 8px 12px; border-bottom: 1px solid #30363d;
    }
    .legend.legend-collapsed .legend-header {
      border-bottom: none; padding: 8px 10px; cursor: pointer;
    }
    .legend.legend-collapsed .legend-header:hover { background: #1c2128; }
    .legend-header-label {
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px;
      color: #8b949e; font-weight: 600;
    }
    #legend-toggle {
      background: #1f3a5f; border: 1px solid #388bfd; color: #e6edf3;
      font-size: 11px; font-weight: 600; line-height: 1;
      padding: 6px 10px; cursor: pointer; border-radius: 5px;
      min-width: 44px; min-height: 32px; flex-shrink: 0;
    }
    #legend-toggle:hover { background: #264a7a; border-color: #58a6ff; }
    .legend-body { padding: 12px 16px; overflow-y: auto; max-height: 180px; }
    .legend.legend-collapsed .legend-body { display: none; }
    .legend-title { font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; color: #8b949e; margin-bottom: 8px; }
    .legend-item { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #c9d1d9; margin-bottom: 5px; }
    .legend-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    .legend-diamond {
      width: 10px; height: 10px; background: #161b22; border: 1px solid #58a6ff;
      transform: rotate(45deg); flex-shrink: 0;
    }

    .hint {
      position: fixed; bottom: 16px; right: 16px; z-index: 10;
      font-size: 11px; color: #6e7681; text-align: right; line-height: 1.65;
    }
    .empty-state {
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      text-align: center; color: #8b949e; z-index: 10;
    }
    .empty-state h2 { font-size: 18px; color: #58a6ff; margin-bottom: 8px; }
    .empty-state p { font-size: 13px; line-height: 1.6; }
    code { background: #21262d; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 12px; }

    #source-modal {
      display: none; position: fixed; inset: 0; z-index: 20;
      background: rgba(0,0,0,0.65); align-items: center; justify-content: center; padding: 24px;
    }
    #source-modal.open { display: flex; }
    #source-modal-inner {
      background: #161b22; border: 1px solid #30363d; border-radius: 10px;
      max-width: 720px; width: 100%; max-height: 85vh; overflow: hidden;
      display: flex; flex-direction: column;
    }
    #source-modal-header {
      padding: 16px 20px; border-bottom: 1px solid #30363d;
      display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;
    }
    #source-modal-header h3 { font-size: 16px; color: #e6edf3; font-weight: 600; }
    #source-modal-meta { font-size: 12px; color: #8b949e; margin-top: 4px; }
    #source-modal-close { background: none; border: none; color: #8b949e; font-size: 24px; cursor: pointer; line-height: 1; }
    #source-modal-body {
      padding: 20px; overflow-y: auto; font-size: 14px; line-height: 1.65; color: #c9d1d9;
      white-space: pre-wrap; font-family: Georgia, 'Times New Roman', serif;
    }
    #tag-tooltip {
      display: none; position: fixed; z-index: 15; pointer-events: none;
      background: #161b22; border: 1px solid #388bfd; border-radius: 5px;
      padding: 4px 8px; font-size: 11px; color: #dce4ec;
      transform: translate(-50%, -120%);
      white-space: nowrap;
    }
  </style>
</head>
<body>
  <div id="cy"></div>
  <div id="theme-labels"></div>
  <div id="tag-tooltip"></div>

  <div id="controls">
    <h1>Idea Map</h1>
    <div id="stats"></div>
    <div class="control-row">
      <select id="theme-filter"><option value="">All themes</option></select>
      <button id="reset-btn">Reset</button>
      <button id="fit-btn">Fit</button>
    </div>
  </div>

  <div id="info-panel">
    <button id="info-close">×</button>
    <h2 id="info-title"></h2>
    <div id="info-content"></div>
  </div>

  <div id="source-modal">
    <div id="source-modal-inner">
      <div id="source-modal-header">
        <div>
          <h3 id="source-modal-title"></h3>
          <div id="source-modal-meta"></div>
        </div>
        <button id="source-modal-close" type="button">×</button>
      </div>
      <div id="source-modal-body"></div>
    </div>
  </div>

  <div class="legend" id="legend"></div>
  <div class="hint">○ ideas · ◇ tags (hover for name) · drag to inspect<br>Click for details · scroll to zoom</div>

  <script>
    const GRAPH_DATA = ${injected};

    const PALETTE = [
      '#4e9af1','#f15a4e','#56d364','#e3b341','#b94ef1',
      '#4ef1e6','#f18c4e','#f14e9a','#79c0ff','#d2a8ff',
      '#ffa657','#7ee787','#ff7b72','#58a6ff','#a5d6ff'
    ];

    const themeColorMap = {};
    GRAPH_DATA.themes.forEach((t, i) => { themeColorMap[t.id] = PALETTE[i % PALETTE.length]; });

    const activeThemeIds = new Set(GRAPH_DATA.themeClusters.map(t => t.id));
    const filterEl = document.getElementById('theme-filter');
    GRAPH_DATA.themeClusters.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      filterEl.appendChild(opt);
    });

    const legendEl = document.getElementById('legend');
    const legendBodyHtml =
      '<div class="legend-title">Themes</div>' +
      GRAPH_DATA.themeClusters.map(t =>
        '<div class="legend-item">' +
          '<div class="legend-dot" style="background:' + themeColorMap[t.id] + '"></div>' +
          t.name +
        '</div>'
      ).join('') +
      '<div class="legend-title" style="margin-top:10px">Nodes</div>' +
      '<div class="legend-item"><div class="legend-dot" style="background:#58a6ff"></div> Entry (circle)</div>' +
      '<div class="legend-item"><div class="legend-diamond"></div> Tag (diamond)</div>';
    legendEl.innerHTML =
      '<div class="legend-header" id="legend-header">' +
        '<span class="legend-header-label" id="legend-header-label">Legend</span>' +
        '<button type="button" id="legend-toggle" aria-label="Hide legend" title="Hide legend">Hide</button>' +
      '</div>' +
      '<div class="legend-body" id="legend-body">' + legendBodyHtml + '</div>';
    const legendHeader = document.getElementById('legend-header');
    const legendToggle = document.getElementById('legend-toggle');
    const legendHeaderLabel = document.getElementById('legend-header-label');
    function setLegendCollapsed(collapsed) {
      legendEl.classList.toggle('legend-collapsed', collapsed);
      legendToggle.textContent = collapsed ? 'Show' : 'Hide';
      legendToggle.setAttribute('aria-label', collapsed ? 'Show legend' : 'Hide legend');
      legendToggle.title = collapsed ? 'Show legend' : 'Hide legend';
      legendHeaderLabel.textContent = collapsed ? 'Legend · tap to expand' : 'Legend';
    }
    function toggleLegend() {
      setLegendCollapsed(!legendEl.classList.contains('legend-collapsed'));
    }
    legendToggle.addEventListener('click', e => {
      e.stopPropagation();
      toggleLegend();
    });
    legendHeader.addEventListener('click', () => toggleLegend());

    const entryCount = GRAPH_DATA.nodes.filter(n => n.node_type === 'entry').length;
    const tagCount   = GRAPH_DATA.nodes.filter(n => n.node_type === 'tag').length;
    const statsEl = document.getElementById('stats');

    function tagTier(count) {
      if (count <= 1) return 'singleton';
      if (count <= 3) return 'recurring';
      return 'frequent';
    }

    function tagSize(count) {
      if (count <= 1) return 8;
      if (count <= 3) return 14;
      return 18;
    }

    function escapeHtml(s) {
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function normalizeWs(s) {
      return String(s).replace(/\\s+/g, ' ').trim();
    }

    /** Highlight evidence excerpt (strong) and surrounding paragraph (soft) in source text. */
    function highlightSourceText(rawText, excerpt) {
      const text = rawText || '';
      if (!excerpt || !text) return escapeHtml(text);

      const parts = excerpt.split(/\\.\\.\\./).map(p => normalizeWs(p)).filter(Boolean);
      let idx = -1;
      let matchLen = 0;

      for (const part of parts) {
        if (part.length < 12) continue;
        const probe = part.slice(0, Math.min(60, part.length));
        const i = text.indexOf(probe.slice(0, 20));
        if (i >= 0) { idx = i; matchLen = part.length; break; }
        const collapsed = normalizeWs(text);
        const j = collapsed.indexOf(probe.slice(0, 30));
        if (j >= 0) {
          const ratio = j / Math.max(1, collapsed.length);
          idx = Math.floor(ratio * text.length);
          matchLen = Math.min(part.length, text.length - idx);
          break;
        }
      }

      if (idx < 0) return escapeHtml(text);

      const paraStart = Math.max(0, text.lastIndexOf('\\n\\n', idx));
      const paraEndRaw = text.indexOf('\\n\\n', idx + matchLen);
      const paraEnd = paraEndRaw >= 0 ? paraEndRaw : text.length;

      const before = text.slice(0, paraStart);
      const softBefore = text.slice(paraStart, idx);
      const strong = text.slice(idx, Math.min(idx + matchLen, text.length));
      const softAfter = text.slice(idx + strong.length, paraEnd);
      const after = text.slice(paraEnd);

      return escapeHtml(before) +
        '<span class="hl-soft">' + escapeHtml(softBefore) + '</span>' +
        '<span class="hl-strong">' + escapeHtml(strong) + '</span>' +
        '<span class="hl-soft">' + escapeHtml(softAfter) + '</span>' +
        escapeHtml(after);
    }

    const MIN_SHAPE_GAP = 44;
    /** Hierarchical cluster pull: primary theme (strong) > secondary theme (weaker) > tags (weakest). */
    const CLUSTER_PULL = { theme: 0.34, secondary: 0.12, tag: 0.05 };
    const CLUSTER_PASSES = 56;

    function nodeCollisionRadius(node) {
      if (node.data('node_type') === 'entry') return 9;
      const size = node.data('size') || 8;
      return size / 2 + 4;
    }

    /** Push overlapping nodes apart until every pair meets MIN_SHAPE_GAP between edges. */
    function enforceMinimumSeparation(cy, minGap, maxPasses) {
      maxPasses = maxPasses || 100;
      const nodes = cy.nodes().toArray();
      for (let pass = 0; pass < maxPasses; pass++) {
        let moved = false;
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            const a = nodes[i];
            const b = nodes[j];
            const pa = a.position();
            const pb = b.position();
            let dx = pb.x - pa.x;
            let dy = pb.y - pa.y;
            let dist = Math.hypot(dx, dy);
            const minDist = nodeCollisionRadius(a) + nodeCollisionRadius(b) + minGap;
            if (dist < 1e-4) {
              const angle = Math.random() * Math.PI * 2;
              dx = Math.cos(angle);
              dy = Math.sin(angle);
              dist = 1;
            }
            if (dist < minDist) {
              const push = (minDist - dist) / 2;
              const ux = dx / dist;
              const uy = dy / dist;
              a.position({ x: pa.x - ux * push, y: pa.y - uy * push });
              b.position({ x: pb.x + ux * push, y: pb.y + uy * push });
              moved = true;
            }
          }
        }
        if (!moved) break;
      }
    }

    function buildSecondaryThemeGroups() {
      const groups = {};
      GRAPH_DATA.nodes.filter(n => n.node_type === 'entry').forEach(n => {
        (n.secondary_themes || []).forEach(st => {
          (groups[st] = groups[st] || []).push(n.id);
        });
      });
      return groups;
    }

    /** Tiered clustering after force layout: theme regions, then secondary affinities, then tag orbit. */
    function applyHierarchicalClustering(cy, themeCenters, secondaryGroups, passes) {
      passes = passes || CLUSTER_PASSES;

      for (let pass = 0; pass < passes; pass++) {
        const fade = 1 - pass / passes;
        const themePull = CLUSTER_PULL.theme * (0.35 + 0.65 * fade);
        const secondaryPull = CLUSTER_PULL.secondary * (0.35 + 0.65 * fade);
        const tagPull = CLUSTER_PULL.tag * (0.35 + 0.65 * fade);

        // Strongest: pull entries toward their primary theme region anchor
        cy.nodes('[node_type = "entry"]').forEach(node => {
          const center = themeCenters[node.data('theme')];
          if (!center) return;
          const p = node.position();
          node.position({
            x: p.x + (center.x - p.x) * themePull,
            y: p.y + (center.y - p.y) * themePull,
          });
        });

        // Weaker: entries sharing a secondary theme drift toward that sub-group centroid
        Object.values(secondaryGroups).forEach(ids => {
          if (ids.length < 2) return;
          const nodes = ids.map(id => cy.getElementById(id)).filter(n => n.nonempty());
          if (nodes.length < 2) return;
          const cx = nodes.reduce((s, n) => s + n.position('x'), 0) / nodes.length;
          const cyPos = nodes.reduce((s, n) => s + n.position('y'), 0) / nodes.length;
          nodes.forEach(node => {
            const p = node.position();
            node.position({
              x: p.x + (cx - p.x) * secondaryPull,
              y: p.y + (cyPos - p.y) * secondaryPull,
            });
          });
        });

        // Weakest: tags orbit just outside their connected entry cluster
        cy.nodes('[node_type = "tag"]').forEach(tag => {
          const entries = tag.neighborhood('node[node_type = "entry"]');
          if (entries.length === 0) return;
          let cx = 0;
          let cyPos = 0;
          entries.forEach(e => { cx += e.position('x'); cyPos += e.position('y'); });
          cx /= entries.length;
          cyPos /= entries.length;

          const theme = entries[0].data('theme');
          const themeAnchor = themeCenters[theme] || { x: cx, y: cyPos };
          let dx = cx - themeAnchor.x;
          let dy = cyPos - themeAnchor.y;
          const len = Math.hypot(dx, dy) || 1;
          dx /= len;
          dy /= len;
          const orbit = 110 + entries.length * 22;
          const targetX = cx + dx * orbit;
          const targetY = cyPos + dy * orbit;

          const p = tag.position();
          tag.position({
            x: p.x + (targetX - p.x) * tagPull,
            y: p.y + (targetY - p.y) * tagPull,
          });
        });

        if (pass % 4 === 3) enforceMinimumSeparation(cy, MIN_SHAPE_GAP, 20);
      }
    }

    function computeThemeCenters(clusters) {
      const n = clusters.length || 1;
      const radius = Math.max(780, n * 240);
      const centers = {};
      clusters.forEach((t, i) => {
        const angle = (2 * Math.PI * i) / n - Math.PI / 2;
        centers[t.id] = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
      });
      return centers;
    }

    function seedPositions(centers) {
      const positions = {};
      const entriesByTheme = {};
      GRAPH_DATA.nodes.filter(n => n.node_type === 'entry').forEach(n => {
        const th = n.theme || 'unknown';
        (entriesByTheme[th] = entriesByTheme[th] || []).push(n);
      });

      Object.entries(entriesByTheme).forEach(([theme, list]) => {
        const c = centers[theme] || { x: 0, y: 0 };
        list.forEach((n, i) => {
          const angle = (2 * Math.PI * i) / list.length;
          const r = 155 + list.length * 44;
          positions[n.id] = {
            x: c.x + Math.cos(angle) * r,
            y: c.y + Math.sin(angle) * r,
          };
        });
      });

      GRAPH_DATA.nodes.filter(n => n.node_type === 'tag').forEach(tag => {
        const linkedIds = GRAPH_DATA.edges.filter(e => e.target === tag.id).map(e => e.source);
        const linkedPos = linkedIds.map(id => positions[id]).filter(Boolean);
        if (!linkedPos.length) {
          positions[tag.id] = { x: (Math.random() - 0.5) * 300, y: (Math.random() - 0.5) * 300 };
          return;
        }
        const cx = linkedPos.reduce((s, p) => s + p.x, 0) / linkedPos.length;
        const cy = linkedPos.reduce((s, p) => s + p.y, 0) / linkedPos.length;
        const entry = GRAPH_DATA.nodes.find(en => en.id === linkedIds[0]);
        const themeCenter = centers[entry?.theme] || { x: cx, y: cy };
        let dx = cx - themeCenter.x;
        let dy = cy - themeCenter.y;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len;
        dy /= len;
        const spread = (linkedPos.length - 1) * 28;
        const push = 200 + spread;
        positions[tag.id] = {
          x: cx + dx * push + (Math.random() - 0.5) * 60,
          y: cy + dy * push + (Math.random() - 0.5) * 60,
        };
      });

      return positions;
    }

    if (entryCount === 0) {
      statsEl.textContent = 'No ideas yet.';
      document.querySelector('.hint').style.display = 'none';
      legendEl.style.display = 'none';
      document.getElementById('theme-labels').style.display = 'none';
      document.getElementById('cy').insertAdjacentHTML('afterend',
        '<div class="empty-state"><h2>Your idea map is empty</h2>' +
        '<p>Process a diary entry to get started:<br>' +
        '<code>npm run process -- --file entry.txt --title "My Entry"</code></p></div>'
      );
    } else {
      statsEl.textContent = entryCount + ' ideas · ' + tagCount + ' tags · ' + activeThemeIds.size + ' theme regions';

      const themeCenters = computeThemeCenters(GRAPH_DATA.themeClusters);
      const secondaryThemeGroups = buildSecondaryThemeGroups();
      const initialPositions = seedPositions(themeCenters);
      const anchoredPositions = {};

      const elements = [];

      GRAPH_DATA.nodes.filter(n => n.node_type === 'entry').forEach(n => {
        elements.push({ group: 'nodes', data: {
          id: n.id,
          node_type: 'entry',
          color: themeColorMap[n.theme] || '#6e7681',
          theme: n.theme,
          secondary_themes: n.secondary_themes || [],
          tags: n.tags || [],
          core_idea: n.core_idea || '',
          evidence_excerpt: n.evidence_excerpt || '',
          source_id: n.source_id || '',
        }, position: initialPositions[n.id] });
      });

      GRAPH_DATA.nodes.filter(n => n.node_type === 'tag').forEach(n => {
        const tier = tagTier(n.connectionCount);
        elements.push({ group: 'nodes', data: {
          id: n.id,
          label: n.label ? n.label.replace(/_/g, ' ') : n.id.replace(/_/g, ' '),
          node_type: 'tag',
          connectionCount: n.connectionCount,
          tagTier: tier,
          size: tagSize(n.connectionCount),
        }, position: initialPositions[n.id] });
      });

      GRAPH_DATA.edges.forEach(e => {
        elements.push({ group: 'edges', data: { id: e.id, source: e.source, target: e.target } });
      });

      const cy = cytoscape({
        container: document.getElementById('cy'),
        elements,
        minZoom: 0.25,
        maxZoom: 3,
        style: [
          {
            selector: 'node[node_type = "entry"]',
            style: {
              'background-color': 'data(color)',
              'width': 12,
              'height': 12,
              'shape': 'ellipse',
              'label': '',
              'border-width': 1.5,
              'border-color': 'data(color)',
              'border-opacity': 0.5,
              'background-opacity': 0.95,
            }
          },
          {
            selector: 'node[node_type = "entry"]:selected',
            style: {
              'border-width': 2.5,
              'border-opacity': 1,
              'border-color': '#ffffff',
              'width': 14,
              'height': 14,
            }
          },
          {
            selector: 'node[node_type = "tag"]',
            style: {
              'background-color': '#12171f',
              'border-color': '#58a6ff',
              'border-width': 1.5,
              'shape': 'diamond',
              'width': 'data(size)',
              'height': 'data(size)',
              'label': '',
            }
          },
          {
            selector: 'node[node_type = "tag"].show-label',
            style: {
              'label': 'data(label)',
              'font-size': '8px',
              'color': '#b1bac4',
              'text-valign': 'bottom',
              'text-halign': 'center',
              'text-margin-y': 5,
              'text-max-width': '64px',
              'text-outline-color': '#0a0e14',
              'text-outline-width': 2,
            }
          },
          {
            selector: 'node[node_type = "tag"][tagTier = "singleton"]',
            style: {
              'opacity': 0.5,
              'border-width': 1,
            }
          },
          {
            selector: 'node[node_type = "tag"][tagTier = "frequent"]',
            style: {
              'border-width': 2,
              'background-color': '#1a2332',
            }
          },
          {
            selector: 'node[node_type = "tag"].active, node[node_type = "tag"]:selected',
            style: {
              'border-color': '#79c0ff',
              'opacity': 1,
            }
          },
          {
            selector: 'edge',
            style: {
              'width': 1.5,
              'line-color': '#484f58',
              'opacity': 0.38,
              'curve-style': 'bezier',
              'target-arrow-shape': 'none',
            }
          },
          {
            selector: 'edge.emphasized',
            style: {
              'opacity': 0.85,
              'line-color': '#58a6ff',
              'width': 2.5,
            }
          },
          {
            selector: 'node.neighbor-emphasis',
            style: { 'opacity': 1, 'border-opacity': 1 }
          },
          { selector: 'node.dimmed', style: { 'opacity': 0.08 } },
          { selector: 'edge.dimmed', style: { 'opacity': 0.06 } },
        ],
        layout: {
          name: 'cose',
          animate: true,
          animationDuration: 700,
          fit: true,
          padding: 200,
          randomize: false,
          nodeRepulsion: 58000,
          nodeOverlap: 64,
          idealEdgeLength: 270,
          edgeElasticity: 0.22,
          nestingFactor: 1,
          gravity: 0.03,
          numIter: 2000,
        },
      });

      // Show labels only on recurring tags; singletons stay quiet until hover
      cy.nodes('[node_type = "tag"][tagTier != "singleton"]').addClass('show-label');

      const themeLabelsEl = document.getElementById('theme-labels');
      const labelEls = {};
      GRAPH_DATA.themeClusters.forEach(t => {
        const el = document.createElement('div');
        el.className = 'theme-label';
        el.textContent = t.name;
        el.style.color = themeColorMap[t.id] || '#6e7681';
        themeLabelsEl.appendChild(el);
        labelEls[t.id] = el;
      });

      function updateThemeLabels() {
        const buckets = {};
        cy.nodes('[node_type = "entry"]').forEach(n => {
          if (n.hasClass('dimmed')) return;
          const th = n.data('theme');
          if (!buckets[th]) buckets[th] = { x: 0, y: 0, n: 0 };
          const p = n.renderedPosition();
          buckets[th].x += p.x;
          buckets[th].y += p.y;
          buckets[th].n += 1;
        });
        Object.entries(labelEls).forEach(([id, el]) => {
          const b = buckets[id];
          if (!b || b.n === 0) { el.style.display = 'none'; return; }
          el.style.display = 'block';
          el.style.left = (b.x / b.n) + 'px';
          el.style.top = (b.y / b.n) + 'px';
        });
      }

      function saveAnchors() {
        cy.nodes().forEach(n => {
          anchoredPositions[n.id()] = { x: n.position('x'), y: n.position('y') };
        });
      }

      /** Snap a dragged node back to its layout anchor. */
      function snapBack(node) {
        const anchor = anchoredPositions[node.id()];
        if (!anchor) return;
        node.animation(
          { position: { x: anchor.x, y: anchor.y } },
          { duration: 400, easing: 'ease-out-cubic', complete: updateThemeLabels },
        ).play();
      }

      // Seed anchors from preset positions until layout finishes
      Object.entries(initialPositions).forEach(([id, pos]) => {
        anchoredPositions[id] = { x: pos.x, y: pos.y };
      });

      cy.on('layoutstop', () => {
        applyHierarchicalClustering(cy, themeCenters, secondaryThemeGroups);
        enforceMinimumSeparation(cy, MIN_SHAPE_GAP);
        saveAnchors();
        updateThemeLabels();
        cy.fit(120);
      });
      cy.on('pan zoom resize', updateThemeLabels);

      cy.nodes().grabify();

      // Cytoscape fires "free" when a grabbed node is released
      cy.on('free', 'node', evt => {
        snapBack(evt.target);
      });

      const panel = document.getElementById('info-panel');
      const infoTitle = document.getElementById('info-title');
      const infoContent = document.getElementById('info-content');
      const sourceModal = document.getElementById('source-modal');

      function closePanel() { panel.classList.remove('open'); }
      function closeSourceModal() { sourceModal.classList.remove('open'); }

      function openSourceView(entryId) {
        const entryNode = GRAPH_DATA.nodes.find(n => n.id === entryId && n.node_type === 'entry');
        if (!entryNode) return;
        const src = GRAPH_DATA.sources[entryNode.source_id];
        if (!src) return;
        document.getElementById('source-modal-title').textContent = src.title;
        document.getElementById('source-modal-meta').textContent =
          (src.created_at ? src.created_at + ' · ' : '') + entryNode.id;
        document.getElementById('source-modal-body').innerHTML =
          highlightSourceText(src.raw_text, entryNode.evidence_excerpt);
        sourceModal.classList.add('open');
      }

      function showEntryPanel(d) {
        const themeData = GRAPH_DATA.themes.find(t => t.id === d.theme);
        const color = themeColorMap[d.theme] || '#888';
        const src = GRAPH_DATA.sources[d.source_id];
        infoTitle.textContent = d.core_idea || 'Entry';
        infoContent.innerHTML =
          (d.evidence_excerpt
            ? '<div class="info-section"><div class="info-label">Evidence</div>' +
              '<div class="info-value" style="font-style:italic;color:#9da7b3">' +
              escapeHtml(d.evidence_excerpt) + '</div></div>'
            : '') +
          '<div class="info-section"><div class="info-label">Theme</div>' +
            '<div class="info-value"><span class="theme-dot" style="background:' + color + '"></span>' +
            (themeData ? themeData.name : d.theme) + '</div></div>' +
          (d.tags && d.tags.length
            ? '<div class="info-section"><div class="info-label">Tags</div><div class="tag-list">' +
              d.tags.map(t => '<span class="tag">' + t.replace(/_/g, ' ') + '</span>').join('') +
              '</div></div>'
            : '') +
          (src
            ? '<div class="info-section"><div class="info-label">Source</div>' +
              '<div class="info-meta">' + escapeHtml(src.title) +
              (src.created_at ? ' · ' + escapeHtml(src.created_at) : '') + '</div></div>'
            : '') +
          (src
            ? '<button type="button" class="btn-primary" id="view-source-btn" style="width:100%;margin-top:8px">' +
              'View full entry</button>'
            : '');
        panel.classList.add('open');
        const btn = document.getElementById('view-source-btn');
        if (btn) btn.onclick = () => openSourceView(d.id);
      }

      function showTagPanel(tagNode) {
        const d = tagNode.data();
        const connEntries = tagNode.neighborhood('node[node_type = "entry"]');
        infoTitle.textContent = d.label || d.id;
        let html =
          '<div class="info-section"><div class="info-label">Recurring motif</div>' +
          '<div class="info-value">' + d.connectionCount + ' connected entr' +
          (d.connectionCount === 1 ? 'y' : 'ies') + '</div></div>' +
          '<div class="info-section"><div class="info-label">Connected ideas</div>';

        connEntries.forEach(n => {
          const ed = n.data();
          const src = GRAPH_DATA.sources[ed.source_id];
          const snippet = ed.core_idea || ed.evidence_excerpt || '';
          html +=
            '<div class="entry-link" data-entry-id="' + ed.id + '">' +
              '<div class="entry-link-title">' + escapeHtml(src ? src.title : ed.id) + '</div>' +
              '<div class="entry-link-snippet">' + escapeHtml(snippet.slice(0, 160)) +
              (snippet.length > 160 ? '…' : '') + '</div>' +
            '</div>';
        });
        html += '</div>';
        infoContent.innerHTML = html;
        panel.classList.add('open');
        infoContent.querySelectorAll('.entry-link').forEach(el => {
          el.addEventListener('click', () => {
            const id = el.getAttribute('data-entry-id');
            cy.nodes('#' + id).select();
            showEntryPanel(cy.nodes('#' + id).data());
          });
        });
      }

      cy.on('mouseover', 'node', evt => {
        const node = evt.target;
        cy.edges().removeClass('emphasized');
        cy.nodes().removeClass('neighbor-emphasis');
        node.connectedEdges().addClass('emphasized');
        node.neighborhood('node').addClass('neighbor-emphasis');
        if (node.data('node_type') === 'tag') {
          node.addClass('active show-label');
        }
      });
      cy.on('mouseout', 'node', evt => {
        const node = evt.target;
        cy.edges().removeClass('emphasized');
        cy.nodes().removeClass('neighbor-emphasis active');
        if (node.data('node_type') === 'tag' && node.data('tagTier') === 'singleton' && !node.selected()) {
          node.removeClass('show-label');
        }
      });

      cy.on('tap', 'node[node_type = "entry"]', evt => {
        showEntryPanel(evt.target.data());
      });
      cy.on('tap', 'node[node_type = "tag"]', evt => {
        showTagPanel(evt.target);
      });

      cy.on('tap', evt => { if (evt.target === cy) closePanel(); });
      document.getElementById('info-close').addEventListener('click', closePanel);
      document.getElementById('source-modal-close').addEventListener('click', closeSourceModal);
      sourceModal.addEventListener('click', e => {
        if (e.target === sourceModal) closeSourceModal();
      });

      filterEl.addEventListener('change', e => {
        const themeId = e.target.value;
        cy.elements().removeClass('dimmed');
        if (!themeId) { updateThemeLabels(); return; }
        cy.nodes('[node_type = "entry"]').forEach(n => {
          if (n.data('theme') !== themeId) n.addClass('dimmed');
        });
        cy.nodes('[node_type = "tag"]').forEach(n => {
          const anyVisible = n.neighborhood('node[node_type = "entry"]').some(en => !en.hasClass('dimmed'));
          if (!anyVisible) n.addClass('dimmed');
        });
        cy.edges().forEach(ed => {
          if (ed.source().hasClass('dimmed') || ed.target().hasClass('dimmed')) ed.addClass('dimmed');
        });
        updateThemeLabels();
      });

      document.getElementById('reset-btn').addEventListener('click', () => {
        cy.elements().removeClass('dimmed');
        filterEl.value = '';
        updateThemeLabels();
      });
      document.getElementById('fit-btn').addEventListener('click', () => {
        cy.fit(80);
        updateThemeLabels();
      });
    }
  </script>
</body>
</html>`;
}

function writeGraphOutputs(html: string): { distPath: string; sitePath: string } {
  const distDir = path.join(__dirname, '../../dist');
  const docsDir = path.join(__dirname, '../../docs');
  fs.mkdirSync(distDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });

  const distPath = path.join(distDir, 'graph.html');
  const sitePath = path.join(docsDir, 'index.html');
  fs.writeFileSync(distPath, html, 'utf-8');
  fs.writeFileSync(sitePath, html, 'utf-8');
  fs.writeFileSync(path.join(docsDir, '.nojekyll'), '', 'utf-8');
  return { distPath, sitePath };
}

export function generateGraph(themeFilter?: string): string {
  const html = buildHtml(getGraph(themeFilter));
  return writeGraphOutputs(html).distPath;
}

/** Build dist/graph.html and docs/index.html for GitHub Pages. */
export function publishSite(themeFilter?: string): { distPath: string; sitePath: string } {
  const html = buildHtml(getGraph(themeFilter));
  return writeGraphOutputs(html);
}

export function githubPagesUrl(repo = 'sharramon/Idea_Map'): string {
  const [owner, name] = repo.split('/');
  return `https://${owner.toLowerCase()}.github.io/${name}/`;
}

export function openInBrowser(filePath: string): void {
  const abs = path.resolve(filePath);
  let cmd: string;
  if (process.platform === 'win32') {
    cmd = 'start "" "' + abs + '"';
  } else if (process.platform === 'darwin') {
    cmd = 'open "' + abs + '"';
  } else {
    cmd = 'xdg-open "' + abs + '"';
  }
  exec(cmd, err => {
    if (err) console.error('Could not open browser:', err.message);
  });
}
