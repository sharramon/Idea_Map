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
    body { background: #0d1117; color: #c9d1d9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; overflow: hidden; }
    #cy { position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; }

    #controls {
      position: fixed; top: 16px; left: 16px; z-index: 10;
      display: flex; flex-direction: column; gap: 10px;
    }
    #controls h1 { font-size: 20px; font-weight: 700; color: #58a6ff; letter-spacing: -0.3px; }
    #stats { font-size: 12px; color: #8b949e; }
    .control-row { display: flex; gap: 8px; align-items: center; }

    select, button {
      background: #161b22; border: 1px solid #30363d; color: #c9d1d9;
      padding: 6px 12px; border-radius: 6px; font-size: 13px; cursor: pointer;
    }
    select:focus, button:hover { border-color: #58a6ff; outline: none; }

    #info-panel {
      position: fixed; right: 0; top: 0; width: 320px; height: 100vh;
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
    #info-panel h2 { font-size: 14px; color: #58a6ff; margin-bottom: 16px; padding-right: 28px; line-height: 1.5; }
    .info-section { margin-bottom: 14px; }
    .info-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; color: #8b949e; margin-bottom: 4px; }
    .info-value { font-size: 13px; color: #c9d1d9; line-height: 1.55; }
    .tag-list { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
    .tag { background: #21262d; border: 1px solid #30363d; border-radius: 4px; padding: 2px 7px; font-size: 11px; color: #8b949e; }
    .theme-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }

    .legend {
      position: fixed; bottom: 16px; left: 16px; z-index: 10;
      background: #161b22; border: 1px solid #30363d; border-radius: 8px;
      padding: 12px 16px; max-height: 240px; overflow-y: auto;
    }
    .legend-title { font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; color: #8b949e; margin-bottom: 8px; }
    .legend-item { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #c9d1d9; margin-bottom: 5px; }
    .legend-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }

    .hint { position: fixed; bottom: 16px; right: 16px; font-size: 11px; color: #6e7681; text-align: right; line-height: 1.6; }
    .empty-state { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center; color: #8b949e; }
    .empty-state h2 { font-size: 18px; color: #58a6ff; margin-bottom: 8px; }
    .empty-state p { font-size: 13px; line-height: 1.6; }
    code { background: #21262d; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 12px; }
  </style>
</head>
<body>
  <div id="cy"></div>

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

  <div class="legend" id="legend"></div>
  <div class="hint">Click a node for details<br>Scroll to zoom · Drag to pan</div>

  <script>
    const GRAPH_DATA = ${injected};

    const PALETTE = [
      '#4e9af1','#f15a4e','#56d364','#e3b341','#b94ef1',
      '#4ef1e6','#f18c4e','#f14e9a','#79c0ff','#d2a8ff',
      '#ffa657','#7ee787','#ff7b72','#58a6ff','#a5d6ff'
    ];

    const themeColorMap = {};
    GRAPH_DATA.themes.forEach((t, i) => { themeColorMap[t.id] = PALETTE[i % PALETTE.length]; });

    // Populate theme filter
    const filterEl = document.getElementById('theme-filter');
    GRAPH_DATA.themes.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      filterEl.appendChild(opt);
    });

    // Legend
    const legendEl = document.getElementById('legend');
    legendEl.innerHTML = '<div class="legend-title">Themes</div>' +
      GRAPH_DATA.themes.map(t =>
        '<div class="legend-item">' +
          '<div class="legend-dot" style="background:' + themeColorMap[t.id] + '"></div>' +
          t.name +
        '</div>'
      ).join('');

    // Stats
    const statsEl = document.getElementById('stats');
    if (GRAPH_DATA.nodes.length === 0) {
      statsEl.textContent = 'No ideas yet.';
      document.querySelector('.hint').style.display = 'none';
      legendEl.style.display = 'none';
      document.getElementById('cy').insertAdjacentHTML('afterend',
        '<div class="empty-state"><h2>Your idea map is empty</h2>' +
        '<p>Process a diary entry to get started:<br>' +
        '<code>npm run process -- --file entry.txt --title "My Entry"</code></p></div>'
      );
    } else {
      statsEl.textContent = GRAPH_DATA.nodes.length + ' ideas · ' + GRAPH_DATA.edges.length + ' connections';
    }

    // Build Cytoscape elements
    const elements = [
      ...GRAPH_DATA.nodes.map(n => ({
        group: 'nodes',
        data: {
          id: n.id,
          label: n.label,
          theme: n.theme,
          color: themeColorMap[n.theme] || '#6e7681',
          size: Math.max(28, 22 + n.connectionCount * 12),
          core_idea: n.core_idea,
          expanded_summary: n.expanded_summary,
          tags: n.tags,
          connectionCount: n.connectionCount,
        }
      })),
      ...GRAPH_DATA.edges.map(e => ({
        group: 'edges',
        data: {
          id: e.id,
          source: e.source,
          target: e.target,
          label: e.relationship,
          explanation: e.explanation,
          confidence: e.confidence,
        }
      }))
    ];

    if (GRAPH_DATA.nodes.length === 0) {
      // Skip Cytoscape init for empty graph
    } else {

    const cy = cytoscape({
      container: document.getElementById('cy'),
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            'label': 'data(label)',
            'width': 'data(size)',
            'height': 'data(size)',
            'color': '#c9d1d9',
            'text-valign': 'bottom',
            'text-halign': 'center',
            'font-size': '11px',
            'text-margin-y': '6px',
            'text-wrap': 'wrap',
            'text-max-width': '130px',
            'border-width': '2px',
            'border-color': 'data(color)',
            'border-opacity': '0.4',
            'text-background-color': '#0d1117',
            'text-background-opacity': '0.75',
            'text-background-padding': '2px',
            'text-background-shape': 'roundrectangle',
          }
        },
        {
          selector: 'node:selected',
          style: { 'border-width': '3px', 'border-color': '#ffffff', 'border-opacity': '1' }
        },
        {
          selector: 'node.dimmed',
          style: { 'opacity': '0.15' }
        },
        {
          selector: 'edge',
          style: {
            'width': 1.5,
            'line-color': '#30363d',
            'target-arrow-color': '#30363d',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'opacity': '0.55',
            'label': 'data(label)',
            'font-size': '9px',
            'color': '#8b949e',
            'text-rotation': 'autorotate',
            'text-background-color': '#0d1117',
            'text-background-opacity': '0.8',
            'text-background-padding': '2px',
          }
        },
        {
          selector: 'edge:selected',
          style: { 'line-color': '#58a6ff', 'target-arrow-color': '#58a6ff', 'opacity': '1', 'width': '2.5' }
        },
        {
          selector: 'edge.dimmed',
          style: { 'opacity': '0.04' }
        },
      ],
      layout: {
        name: 'cose',
        idealEdgeLength: 130,
        nodeOverlap: 20,
        refresh: 20,
        fit: true,
        padding: 60,
        randomize: false,
        componentSpacing: 120,
        nodeRepulsion: 500000,
        edgeElasticity: 100,
        nestingFactor: 5,
        gravity: 80,
        numIter: 1000,
        initialTemp: 200,
        coolingFactor: 0.95,
        minTemp: 1.0,
      },
      userZoomingEnabled: true,
      userPanningEnabled: true,
    });

    // Info panel
    const panel = document.getElementById('info-panel');
    const infoTitle = document.getElementById('info-title');
    const infoContent = document.getElementById('info-content');

    function openNode(node) {
      const d = node.data();
      const themeData = GRAPH_DATA.themes.find(t => t.id === d.theme);
      const color = themeColorMap[d.theme] || '#888';

      infoTitle.textContent = d.core_idea;
      infoContent.innerHTML =
        '<div class="info-section">' +
          '<div class="info-label">Theme</div>' +
          '<div class="info-value">' +
            '<span class="theme-dot" style="background:' + color + '"></span>' +
            (themeData ? themeData.name : d.theme) +
          '</div>' +
        '</div>' +
        '<div class="info-section">' +
          '<div class="info-label">Summary</div>' +
          '<div class="info-value">' + d.expanded_summary + '</div>' +
        '</div>' +
        (d.tags && d.tags.length > 0
          ? '<div class="info-section">' +
              '<div class="info-label">Tags</div>' +
              '<div class="tag-list">' + d.tags.map(t => '<span class="tag">' + t + '</span>').join('') + '</div>' +
            '</div>'
          : '') +
        '<div class="info-section">' +
          '<div class="info-label">Connections</div>' +
          '<div class="info-value">' + d.connectionCount + ' linked idea' + (d.connectionCount !== 1 ? 's' : '') + '</div>' +
        '</div>';

      panel.classList.add('open');
    }

    function openEdge(edge) {
      const d = edge.data();
      infoTitle.textContent = d.label.replace(/_/g, ' ');
      infoContent.innerHTML =
        '<div class="info-section">' +
          '<div class="info-label">Type</div>' +
          '<div class="info-value">' + d.label + '</div>' +
        '</div>' +
        '<div class="info-section">' +
          '<div class="info-label">Explanation</div>' +
          '<div class="info-value">' + d.explanation + '</div>' +
        '</div>' +
        '<div class="info-section">' +
          '<div class="info-label">Confidence</div>' +
          '<div class="info-value">' + Math.round(d.confidence * 100) + '%</div>' +
        '</div>';
      panel.classList.add('open');
    }

    document.getElementById('info-close').addEventListener('click', () => {
      panel.classList.remove('open');
      cy.elements().removeClass('dimmed');
    });

    cy.on('tap', 'node', evt => {
      const node = evt.target;
      openNode(node);
      const neighborhood = node.closedNeighborhood();
      cy.elements().addClass('dimmed');
      neighborhood.removeClass('dimmed');
    });

    cy.on('tap', 'edge', evt => { openEdge(evt.target); });

    cy.on('tap', evt => {
      if (evt.target === cy) {
        panel.classList.remove('open');
        cy.elements().removeClass('dimmed');
      }
    });

    // Theme filter
    filterEl.addEventListener('change', e => {
      const themeId = e.target.value;
      if (!themeId) {
        cy.elements().removeClass('dimmed');
        return;
      }
      cy.nodes().forEach(n => {
        n.data('theme') === themeId ? n.removeClass('dimmed') : n.addClass('dimmed');
      });
      cy.edges().forEach(edge => {
        (edge.source().hasClass('dimmed') || edge.target().hasClass('dimmed'))
          ? edge.addClass('dimmed') : edge.removeClass('dimmed');
      });
    });

    document.getElementById('reset-btn').addEventListener('click', () => {
      cy.elements().removeClass('dimmed');
      filterEl.value = '';
    });

    document.getElementById('fit-btn').addEventListener('click', () => { cy.fit(60); });

    } // end if nodes > 0
  </script>
</body>
</html>`;
}

export function generateGraph(themeFilter?: string): string {
  const data = getGraph(themeFilter);
  const html = buildHtml(data);

  const outDir = path.join(__dirname, '../../dist');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'graph.html');
  fs.writeFileSync(outPath, html, 'utf-8');
  return outPath;
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
