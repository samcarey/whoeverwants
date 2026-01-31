// Status Server + Reverse Proxy
//
// Single HTTP server that:
//   - Serves /status as an HTML diagnostic page
//   - Serves /status/json as raw JSON status
//   - Proxies /<branch>/* to the corresponding branch child process
//   - Shows a root page listing all active branches

const http = require('http');

class StatusServer {
  constructor({ port = 8080, webhookPort = 9000, getWorkerStatuses, getBuildHistory, processManager }) {
    this.port = port;
    this.webhookPort = webhookPort;
    this.getWorkerStatuses = getWorkerStatuses;
    this.getBuildHistory = getBuildHistory;
    this.processManager = processManager;
    this.server = null;
    this.status = 'stopped';
  }

  start() {
    this.server = http.createServer((req, res) => {
      this._handleRequest(req, res);
    });

    this.server.listen(this.port, () => {
      this.status = 'running';
      console.log(`[status-server] Listening on port ${this.port}`);
    });
  }

  _handleRequest(req, res) {
    const url = req.url;

    if (url === '/' || url === '') {
      this._serveIndex(req, res);
    } else if (url === '/status') {
      this._serveStatusPage(req, res);
    } else if (url === '/status/json') {
      this._serveStatusJson(req, res);
    } else {
      // Try to proxy to a branch
      this._proxyToBranch(req, res);
    }
  }

  _serveIndex(req, res) {
    const branches = this.processManager.getAllBranches();
    const branchList = Object.entries(branches)
      .map(([name, info]) => {
        const statusDot = info.running ? '🟢' : '🔴';
        return `<li>${statusDot} <a href="/${name}/">${name}</a> (port ${info.port}, pid ${info.pid || 'N/A'})</li>`;
      })
      .join('\n');

    const html = `<!DOCTYPE html>
<html><head><title>Multi-Branch Deploy</title>
<style>
  body { font-family: monospace; background: #1a1a2e; color: #e0e0e0; padding: 2rem; }
  a { color: #64b5f6; }
  h1 { color: #bb86fc; }
  li { margin: 0.5rem 0; }
</style></head>
<body>
  <h1>Multi-Branch Deploy System</h1>
  <p><a href="/status">Status Dashboard</a></p>
  <h2>Active Branches</h2>
  <ul>${branchList || '<li>No branches deployed yet</li>'}</ul>
  <p>Trigger a build: <code>curl -X POST http://localhost:${this.webhookPort}/trigger -H "Content-Type: application/json" -d '{"branch":"main"}'</code></p>
</body></html>`;

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }

  _serveStatusPage(req, res) {
    const workers = this.getWorkerStatuses();
    const builds = this.getBuildHistory();
    const branches = this.processManager.getAllBranches();

    // Build the worker status cards
    const workerCards = workers.map(w => `
      <div class="card">
        <h3>${w.name}</h3>
        <div class="status-badge ${w.status}">${w.status}</div>
        <pre>${JSON.stringify(w, null, 2)}</pre>
      </div>
    `).join('');

    // Build the builds table (paginated client-side)
    const buildRows = builds.map(b => `
      <tr class="${b.success ? 'success' : 'failure'}">
        <td>${b.branch}</td>
        <td>${b.commitSha ? b.commitSha.slice(0, 7) : 'N/A'}</td>
        <td>${b.success ? 'OK' : 'FAIL'}</td>
        <td>${b.startTime || ''}</td>
        <td>${b.endTime || ''}</td>
        <td>${b.error || ''}</td>
      </tr>
    `).join('');

    const html = `<!DOCTYPE html>
<html><head><title>Deploy Status</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: monospace; background: #1a1a2e; color: #e0e0e0; padding: 1.5rem; }
  h1 { color: #bb86fc; margin-bottom: 1rem; }
  h2 { color: #03dac6; margin: 1.5rem 0 0.75rem; }
  .workers { display: flex; gap: 1rem; flex-wrap: wrap; }
  .card { background: #16213e; border: 1px solid #333; border-radius: 8px; padding: 1rem; min-width: 300px; flex: 1; }
  .card h3 { color: #bb86fc; margin-bottom: 0.5rem; }
  .card pre { font-size: 0.75rem; overflow-x: auto; color: #aaa; }
  .status-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.8rem; font-weight: bold; margin-bottom: 0.5rem; }
  .status-badge.running, .status-badge.idle { background: #1b5e20; color: #a5d6a7; }
  .status-badge.building { background: #e65100; color: #ffcc80; }
  .status-badge.stopped { background: #b71c1c; color: #ef9a9a; }
  table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; }
  th { background: #0f3460; color: #e0e0e0; padding: 0.5rem; text-align: left; position: sticky; top: 0; }
  td { padding: 0.4rem 0.5rem; border-bottom: 1px solid #222; }
  tr.success td:nth-child(3) { color: #a5d6a7; }
  tr.failure td:nth-child(3) { color: #ef9a9a; }
  tr.failure td:nth-child(6) { color: #ef9a9a; font-size: 0.8rem; }
  .builds-container { max-height: calc(100vh - 400px); overflow-y: auto; border: 1px solid #333; border-radius: 4px; }
  a { color: #64b5f6; }
  .refresh { margin: 1rem 0; }
</style>
</head>
<body>
  <h1>Deploy System Status</h1>
  <p class="refresh"><a href="/status">Refresh</a> | <a href="/status/json">Raw JSON</a> | <a href="/">Home</a></p>

  <h2>Workers</h2>
  <div class="workers">${workerCards}</div>

  <h2>Build History (${builds.length} total)</h2>
  <div class="builds-container">
    <table>
      <thead><tr>
        <th>Branch</th><th>Commit</th><th>Status</th><th>Started</th><th>Finished</th><th>Error</th>
      </tr></thead>
      <tbody>${buildRows || '<tr><td colspan="6">No builds yet</td></tr>'}</tbody>
    </table>
  </div>

  <script>setTimeout(() => location.reload(), 5000);</script>
</body></html>`;

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }

  _serveStatusJson(req, res) {
    const data = {
      workers: this.getWorkerStatuses(),
      builds: this.getBuildHistory(),
      branches: this.processManager.getAllBranches()
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data, null, 2));
  }

  _proxyToBranch(req, res) {
    // URL: /<branch>/rest/of/path?query -> proxy to branch's port as /rest/of/path?query
    const url = require('url');
    const parsed = url.parse(req.url);
    const pathParts = (parsed.pathname || '/').split('/').filter(Boolean);

    if (pathParts.length === 0) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const branch = pathParts[0];
    const port = this.processManager.getPortForBranch(branch);

    if (!port) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `No deployment for branch: ${branch}` }));
      return;
    }

    // Rewrite URL: strip the branch prefix, preserve query string
    const remainingPath = '/' + pathParts.slice(1).join('/');
    const downstreamPath = remainingPath + (parsed.search || '');

    const proxyReq = http.request({
      hostname: '127.0.0.1',
      port,
      path: downstreamPath,
      method: req.method,
      headers: req.headers
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Branch "${branch}" process not responding`, detail: err.message }));
    });

    req.pipe(proxyReq);
  }

  getStatus() {
    return {
      name: 'status-server',
      status: this.status,
      port: this.port
    };
  }

  stop() {
    if (this.server) this.server.close();
    this.status = 'stopped';
  }
}

module.exports = StatusServer;
