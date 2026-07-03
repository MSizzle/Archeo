/**
 * src/dashboard/page.ts
 *
 * Inline HTML/JS dashboard page v2 — returned as a template string.
 * D3-05 / D13: no bundler, no static dir, no external assets, no CDN.
 * Zero runtime deps — the page is served as a string from server.ts.
 *
 * DASH-04: <img id="screen"> fed by 'frame' SSE events (CDP screencast)
 * DASH-05: <svg id="map"> self-drawing coverage map (vanilla JS, createElementNS, ring layout)
 * DASH-06: <ul id="reasoning"> verbatim reasoning, li.textContent only (model output is untrusted)
 * DASH-07: #beat element pulses on 'held' SSE events; #heldCount counter
 *
 * GATE-03: this file imports nothing — pure string export.
 */

/**
 * Returns the complete inline HTML/JS dashboard document (v2).
 * The page opens an EventSource('/events') connection and renders:
 *   - Discovery counts grid (records, endpoints, dataModels, states, heldWrites)
 *   - Recent endpoints list
 *   - Live CDP screencast frame (<img id="screen">)
 *   - Self-drawing SVG coverage map (<svg id="map">, ring layout, no external JS)
 *   - Verbatim agent reasoning list (<ul id="reasoning">, textContent always)
 *   - Held-write beat (#beat pulses, #heldCount increments, DASH-07)
 */
export function renderPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Archeo — Discovery Dashboard</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #0f0f10;
      color: #e5e7eb;
      padding: 24px;
      min-height: 100vh;
    }
    header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 28px;
    }
    h1 { font-size: 1.125rem; font-weight: 600; color: #f9fafb; letter-spacing: 0.01em; }
    .dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: #374151;
      flex-shrink: 0;
      transition: background 0.4s;
    }
    .dot.live { background: #10b981; box-shadow: 0 0 6px #10b981; }
    .subtitle { font-size: 0.75rem; color: #6b7280; margin-left: auto; }

    /* Discovery counters grid */
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 12px;
      margin-bottom: 32px;
    }
    .card {
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 10px;
      padding: 16px 18px;
    }
    .card .lbl {
      font-size: 0.6875rem;
      color: #71717a;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      margin-bottom: 10px;
    }
    .card .val {
      font-size: 2.25rem;
      font-weight: 700;
      color: #f4f4f5;
      line-height: 1;
      font-variant-numeric: tabular-nums;
    }
    .card .sub {
      font-size: 0.6875rem;
      color: #52525b;
      margin-top: 5px;
    }
    section h2 {
      font-size: 0.6875rem;
      color: #71717a;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      margin-bottom: 12px;
    }

    /* Recent endpoints list */
    .ep-list { list-style: none; }
    .ep-list li {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 9px 12px;
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 7px;
      margin-bottom: 6px;
      font-size: 0.8rem;
      font-family: 'Menlo', 'Consolas', monospace;
      transition: border-color 0.2s;
    }
    .ep-list li:first-child { border-color: #3f3f46; }
    .badge {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 0.65rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      min-width: 48px;
      text-align: center;
    }
    .GET    { background: #052e16; color: #4ade80; }
    .POST   { background: #172554; color: #93c5fd; }
    .PUT    { background: #431407; color: #fdba74; }
    .PATCH  { background: #431407; color: #fdba74; }
    .DELETE { background: #450a0a; color: #fca5a5; }
    .OTHER  { background: #27272a; color: #a1a1aa; }
    .held   { background: #431407; color: #fb923c; font-size: 0.6rem; padding: 2px 5px; }
    .path   { color: #c4b5fd; }
    .empty  { color: #3f3f46; font-size: 0.8125rem; font-style: italic; padding: 12px; }

    /* Two-column layout for v2 panels */
    .v2-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 24px;
    }
    @media (max-width: 800px) { .v2-row { grid-template-columns: 1fr; } }

    /* DASH-04: live browser screencast */
    .panel {
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 10px;
      padding: 14px;
    }
    .panel h2 { margin-bottom: 10px; }
    #screen {
      width: 100%;
      border-radius: 6px;
      background: #0f0f10;
      display: block;
      min-height: 100px;
    }

    /* DASH-05: coverage map SVG */
    #map {
      width: 100%;
      height: 300px;
      display: block;
      background: #0f0f10;
      border-radius: 6px;
    }

    /* DASH-06: reasoning list */
    #reasoning {
      list-style: none;
      max-height: 200px;
      overflow-y: auto;
      font-size: 0.78rem;
      color: #a1a1aa;
    }
    #reasoning li {
      padding: 5px 0;
      border-bottom: 1px solid #27272a;
      line-height: 1.4;
    }
    #reasoning li:last-child { border-bottom: none; }

    /* DASH-07: held-write beat */
    #beat {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-top: 10px;
      font-size: 0.75rem;
      color: #fb923c;
      opacity: 0;
      transition: opacity 0.3s;
    }
    #beat.pulse { opacity: 1; }
    @keyframes beatAnim {
      0%   { opacity: 1; }
      80%  { opacity: 1; }
      100% { opacity: 0; }
    }
    #beat.pulse { animation: beatAnim 2s forwards; }
    #heldCount {
      font-weight: 700;
      font-size: 0.85rem;
    }
  </style>
</head>
<body>
  <header>
    <span class="dot" id="dot"></span>
    <h1>Archeo — Live Discovery</h1>
    <span class="subtitle" id="status">Connecting…</span>
  </header>

  <!-- Discovery counters (DASH-01/02) -->
  <div class="grid">
    <div class="card">
      <div class="lbl">Records</div>
      <div class="val" id="records">0</div>
      <div class="sub">captured</div>
    </div>
    <div class="card">
      <div class="lbl">Endpoints</div>
      <div class="val" id="endpoints">0</div>
      <div class="sub">discovered</div>
    </div>
    <div class="card">
      <div class="lbl">Data Models</div>
      <div class="val" id="dataModels">0</div>
      <div class="sub">inferred</div>
    </div>
    <div class="card">
      <div class="lbl">UI States</div>
      <div class="val" id="states">0</div>
      <div class="sub">navigations</div>
    </div>
    <div class="card">
      <div class="lbl">Held Writes</div>
      <div class="val" id="heldWrites">0</div>
      <div class="sub">mutations</div>
    </div>
  </div>

  <!-- v2 panels row -->
  <div class="v2-row">
    <!-- DASH-04: live CDP screencast -->
    <div class="panel">
      <h2>Live Browser</h2>
      <img id="screen" alt="Browser screencast" />
    </div>

    <!-- DASH-05: self-drawing SVG coverage map -->
    <div class="panel">
      <h2>Coverage Map</h2>
      <svg id="map" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"></svg>
    </div>
  </div>

  <div class="v2-row">
    <!-- DASH-06: verbatim agent reasoning -->
    <div class="panel">
      <h2>Agent Reasoning</h2>
      <ul id="reasoning"></ul>
    </div>

    <!-- Recent endpoints + DASH-07 held-write beat -->
    <div class="panel">
      <h2>Recent Endpoints</h2>
      <ul class="ep-list" id="epList">
        <li class="empty">Waiting for requests…</li>
      </ul>
      <!-- DASH-07: held-write beat notification -->
      <span id="beat">
        &#9888; <span id="heldCount">0</span> write held — nothing reached the server
      </span>
    </div>
  </div>

  <script>
    // Discovery dashboard client — DASH-01/02/03/04/05/06/07.
    // One EventSource connection; snapshot on connect then typed events per action.
    var FIELDS = ['records', 'endpoints', 'dataModels', 'states', 'heldWrites'];
    var dot = document.getElementById('dot');
    var statusEl = document.getElementById('status');
    var epList = document.getElementById('epList');
    var screenImg = document.getElementById('screen');
    var map = document.getElementById('map');
    var reasoningList = document.getElementById('reasoning');
    var beatEl = document.getElementById('beat');
    var heldCountEl = document.getElementById('heldCount');

    // ---------------------------------------------------------------------------
    // DASH-02: discovery counters
    // ---------------------------------------------------------------------------
    function applySnapshot(s) {
      FIELDS.forEach(function(f) {
        var el = document.getElementById(f);
        if (el) el.textContent = s[f] != null ? s[f] : 0;
      });
      renderEndpoints(s.recentEndpoints || []);

      // DASH-04: apply last frame from snapshot (late-connect replay)
      if (s.lastFrame) {
        screenImg.src = 'data:image/jpeg;base64,' + s.lastFrame;
      }

      // DASH-05: reset and replay coverage map from snapshot
      resetMap();
      (s.coverageStates || []).forEach(function(node) { addMapNode(node); });
      (s.coverageTransitions || []).forEach(function(t) { addMapEdge(t); });
    }

    function methodClass(m) {
      return ['GET','POST','PUT','PATCH','DELETE'].indexOf(m) >= 0 ? m : 'OTHER';
    }

    function renderEndpoints(eps) {
      if (!eps.length) {
        epList.innerHTML = '<li class="empty">Waiting for requests…</li>';
        return;
      }
      epList.innerHTML = eps.map(function(ep) {
        return '<li>'
          + '<span class="badge ' + methodClass(ep.method) + '">' + ep.method + '</span>'
          + (ep.held ? '<span class="badge held">HELD</span>' : '')
          + '<span class="path">' + ep.pathTemplate + '</span>'
          + '</li>';
      }).join('');
    }

    // ---------------------------------------------------------------------------
    // DASH-05: self-drawing SVG coverage map (vanilla JS, ring layout)
    // ---------------------------------------------------------------------------
    var SVG_NS = 'http://www.w3.org/2000/svg';
    var mapNodes = {};   // signature → { x, y, el }
    var mapEdges = [];   // { from, to, action }
    var MAP_W = 400;
    var MAP_H = 300;
    var MAP_CX = MAP_W / 2;
    var MAP_CY = MAP_H / 2;
    var MAP_R = 110;     // ring radius

    function resetMap() {
      // Remove all child elements from the SVG
      while (map.firstChild) { map.removeChild(map.firstChild); }
      mapNodes = {};
      mapEdges = [];
    }

    function repositionNodes() {
      var sigs = Object.keys(mapNodes);
      var n = sigs.length;
      sigs.forEach(function(sig, i) {
        var angle = (2 * Math.PI * i / Math.max(n, 1)) - Math.PI / 2;
        var x = MAP_CX + MAP_R * Math.cos(angle);
        var y = MAP_CY + MAP_R * Math.sin(angle);
        var node = mapNodes[sig];
        node.x = x;
        node.y = y;
        // Move circle
        node.circle.setAttribute('cx', x);
        node.circle.setAttribute('cy', y);
        // Move label
        node.label.setAttribute('x', x);
        node.label.setAttribute('y', y + 16);
      });
      // Redraw all edges
      redrawEdges();
    }

    function redrawEdges() {
      // Remove existing line elements
      var lines = map.querySelectorAll('line.map-edge');
      lines.forEach(function(l) { l.parentNode.removeChild(l); });

      mapEdges.forEach(function(edge) {
        var fromNode = mapNodes[edge.from];
        var toNode = mapNodes[edge.to];
        if (!fromNode || !toNode) return;

        var line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('class', 'map-edge');
        line.setAttribute('x1', fromNode.x);
        line.setAttribute('y1', fromNode.y);
        line.setAttribute('x2', toNode.x);
        line.setAttribute('y2', toNode.y);
        line.setAttribute('stroke', '#4b5563');
        line.setAttribute('stroke-width', '1.5');
        line.setAttribute('marker-end', 'url(#arrow)');
        // Insert before first circle so edges are behind nodes
        var firstCircle = map.querySelector('circle');
        if (firstCircle) {
          map.insertBefore(line, firstCircle);
        } else {
          map.appendChild(line);
        }
      });
    }

    function ensureArrowMarker() {
      if (map.querySelector('#arrow')) return;
      var defs = document.createElementNS(SVG_NS, 'defs');
      var marker = document.createElementNS(SVG_NS, 'marker');
      marker.setAttribute('id', 'arrow');
      marker.setAttribute('markerWidth', '6');
      marker.setAttribute('markerHeight', '6');
      marker.setAttribute('refX', '5');
      marker.setAttribute('refY', '3');
      marker.setAttribute('orient', 'auto');
      var path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', 'M0,0 L0,6 L6,3 z');
      path.setAttribute('fill', '#4b5563');
      marker.appendChild(path);
      defs.appendChild(marker);
      map.insertBefore(defs, map.firstChild);
    }

    function addMapNode(node) {
      if (mapNodes[node.signature]) return; // already present
      ensureArrowMarker();

      var circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('r', '14');
      circle.setAttribute('fill', '#1e3a5f');
      circle.setAttribute('stroke', '#3b82f6');
      circle.setAttribute('stroke-width', '1.5');

      var label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('font-size', '9');
      label.setAttribute('fill', '#93c5fd');
      label.textContent = (node.title || node.url || node.signature).slice(0, 14);

      map.appendChild(circle);
      map.appendChild(label);

      mapNodes[node.signature] = { x: MAP_CX, y: MAP_CY, circle: circle, label: label };
      repositionNodes();
    }

    function addMapEdge(t) {
      mapEdges.push(t);
      redrawEdges();
    }

    // ---------------------------------------------------------------------------
    // DASH-07: held-write beat
    // ---------------------------------------------------------------------------
    var heldTotal = 0;
    var beatTimer = null;

    function pulseBeat() {
      heldTotal++;
      heldCountEl.textContent = heldTotal;
      beatEl.classList.remove('pulse');
      // Force reflow so animation restarts
      void beatEl.offsetWidth;
      beatEl.classList.add('pulse');
      if (beatTimer) clearTimeout(beatTimer);
      beatTimer = setTimeout(function() {
        beatEl.classList.remove('pulse');
      }, 2200);
    }

    // ---------------------------------------------------------------------------
    // EventSource connection
    // ---------------------------------------------------------------------------
    var es = new EventSource('/events');

    es.addEventListener('snapshot', function(e) {
      dot.className = 'dot live';
      statusEl.textContent = 'Live';
      applySnapshot(JSON.parse(e.data));
    });

    es.addEventListener('record', function(e) {
      applySnapshot(JSON.parse(e.data));
    });

    // DASH-04: live CDP screencast frame
    es.addEventListener('frame', function(e) {
      screenImg.src = 'data:image/jpeg;base64,' + JSON.parse(e.data);
    });

    // DASH-05: new coverage map node
    es.addEventListener('state', function(e) {
      addMapNode(JSON.parse(e.data));
    });

    // DASH-05: new coverage map edge
    es.addEventListener('transition', function(e) {
      addMapEdge(JSON.parse(e.data));
    });

    // DASH-06: verbatim agent reasoning — textContent ONLY, never innerHTML
    // model output is untrusted for DOM injection
    es.addEventListener('reasoning', function(e) {
      var parsed = JSON.parse(e.data);
      var li = document.createElement('li');
      li.textContent = parsed.reasoning;
      reasoningList.appendChild(li);
      // Auto-scroll to bottom
      reasoningList.scrollTop = reasoningList.scrollHeight;
    });

    // DASH-07: held-write beat
    es.addEventListener('held', function(e) {
      pulseBeat();
    });

    es.onerror = function() {
      dot.className = 'dot';
      statusEl.textContent = 'Disconnected';
    };
  </script>
</body>
</html>`;
}
