/**
 * src/dashboard/page.ts
 *
 * Inline HTML/JS dashboard page — returned as a template string.
 * D3-05 / D13: no bundler, no static dir, no external assets, no CDN.
 * Zero runtime deps — the page is served as a string from server.ts.
 *
 * GATE-03: this file imports nothing — pure string export.
 */

/**
 * Returns the complete inline HTML/JS dashboard document.
 * The page opens an EventSource('/events') connection and renders discovery
 * counts and a recent-endpoints list framed as DISCOVERY (not a completion bar,
 * per DASH-02). The server pushes a full snapshot on connect and one event per
 * appended record thereafter (DASH-03).
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
  </style>
</head>
<body>
  <header>
    <span class="dot" id="dot"></span>
    <h1>Archeo — Live Discovery</h1>
    <span class="subtitle" id="status">Connecting…</span>
  </header>

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

  <section>
    <h2>Recent Endpoints</h2>
    <ul class="ep-list" id="epList">
      <li class="empty">Waiting for requests…</li>
    </ul>
  </section>

  <script>
    // Discovery dashboard client — DASH-01/02/03.
    // One EventSource connection; snapshot on connect then one event per record.
    const FIELDS = ['records', 'endpoints', 'dataModels', 'states', 'heldWrites'];
    const dot = document.getElementById('dot');
    const statusEl = document.getElementById('status');
    const epList = document.getElementById('epList');

    function applySnapshot(s) {
      FIELDS.forEach(function(f) {
        var el = document.getElementById(f);
        if (el) el.textContent = s[f] != null ? s[f] : 0;
      });
      renderEndpoints(s.recentEndpoints || []);
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

    var es = new EventSource('/events');

    es.addEventListener('snapshot', function(e) {
      dot.className = 'dot live';
      statusEl.textContent = 'Live';
      applySnapshot(JSON.parse(e.data));
    });

    es.addEventListener('record', function(e) {
      applySnapshot(JSON.parse(e.data));
    });

    es.onerror = function() {
      dot.className = 'dot';
      statusEl.textContent = 'Disconnected';
    };
  </script>
</body>
</html>`;
}
