// Webhook Worker - listens for GitHub push webhooks and enqueues build jobs.
// Also supports manual trigger via POST /trigger with { "branch": "branchname" }.

const http = require('http');
const crypto = require('crypto');
const { enqueue } = require('./queue');

class WebhookWorker {
  constructor({ port = 9000, secret = '', onStatus }) {
    this.port = port;
    this.secret = secret;
    this.onStatus = onStatus || (() => {});
    this.server = null;
    this.receivedCount = 0;
    this.lastEvent = null;
    this.status = 'stopped';
  }

  start() {
    this.server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/webhook') {
        this._handleWebhook(req, res);
      } else if (req.method === 'POST' && req.url === '/trigger') {
        this._handleManualTrigger(req, res);
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    this.server.listen(this.port, () => {
      this.status = 'running';
      this.onStatus(this.getStatus());
      console.log(`[webhook-worker] Listening on port ${this.port}`);
    });
  }

  _handleWebhook(req, res) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      // Verify signature if secret is configured
      if (this.secret) {
        const sig = req.headers['x-hub-signature-256'];
        const expected = 'sha256=' + crypto.createHmac('sha256', this.secret).update(body).digest('hex');
        if (sig !== expected) {
          res.writeHead(401);
          res.end('Invalid signature');
          return;
        }
      }

      try {
        const payload = JSON.parse(body);
        const event = req.headers['x-github-event'];

        if (event === 'push') {
          const ref = payload.ref || '';
          // refs/heads/branchname -> branchname
          const branch = ref.replace('refs/heads/', '');
          if (!branch) {
            res.writeHead(400);
            res.end('No branch in ref');
            return;
          }

          const repoUrl = payload.repository?.clone_url || payload.repository?.ssh_url || '';
          const commitSha = payload.after || '';
          const pusher = payload.pusher?.name || 'unknown';

          const job = {
            branch,
            repoUrl,
            commitSha,
            pusher,
            triggeredAt: new Date().toISOString(),
            source: 'webhook'
          };

          enqueue(job);
          this.receivedCount++;
          this.lastEvent = job;
          this.onStatus(this.getStatus());

          console.log(`[webhook-worker] Enqueued build for branch: ${branch} (commit: ${commitSha.slice(0, 7)})`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, branch }));
        } else {
          res.writeHead(200);
          res.end('Ignored event: ' + event);
        }
      } catch (err) {
        console.error('[webhook-worker] Parse error:', err.message);
        res.writeHead(400);
        res.end('Bad JSON');
      }
    });
  }

  _handleManualTrigger(req, res) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { branch, repoUrl } = JSON.parse(body);
        if (!branch) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'branch is required' }));
          return;
        }

        const job = {
          branch,
          repoUrl: repoUrl || '',
          commitSha: '',
          pusher: 'manual',
          triggeredAt: new Date().toISOString(),
          source: 'manual'
        };

        enqueue(job);
        this.receivedCount++;
        this.lastEvent = job;
        this.onStatus(this.getStatus());

        console.log(`[webhook-worker] Manual trigger enqueued for branch: ${branch}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, branch }));
      } catch (err) {
        res.writeHead(400);
        res.end('Bad JSON');
      }
    });
  }

  getStatus() {
    return {
      name: 'webhook-worker',
      status: this.status,
      port: this.port,
      receivedCount: this.receivedCount,
      lastEvent: this.lastEvent
    };
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.status = 'stopped';
    }
  }
}

module.exports = WebhookWorker;
