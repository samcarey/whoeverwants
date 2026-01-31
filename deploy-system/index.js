#!/usr/bin/env node

// Multi-Branch Deploy System - Main Entry Point
//
// Starts all three workers in a single process:
//   1. Webhook Worker - listens for GitHub push webhooks on WEBHOOK_PORT
//   2. Build Worker   - polls the queue, builds branches, writes metadata
//   3. Process Manager - manages child processes per branch, watches metadata
//   + Status Server   - serves /status dashboard and proxies /<branch>/* requests
//
// Configuration via environment variables:
//   REPO_URL         - Git clone URL (default: none, uses manual triggers)
//   WEBHOOK_PORT     - Port for webhook listener (default: 9000)
//   STATUS_PORT      - Port for status page + reverse proxy (default: 8080)
//   WEBHOOK_SECRET   - GitHub webhook secret (default: none)
//   BASE_PROCESS_PORT - Starting port for branch child processes (default: 9100)
//   BUILD_POLL_MS    - How often to poll the build queue in ms (default: 2000)

const WebhookWorker = require('./webhook-worker');
const BuildWorker = require('./build-worker');
const ProcessManager = require('./process-manager');
const StatusServer = require('./status-server');

// Configuration
const config = {
  repoUrl: process.env.REPO_URL || '',
  webhookPort: parseInt(process.env.WEBHOOK_PORT, 10) || 9000,
  statusPort: parseInt(process.env.STATUS_PORT, 10) || 8080,
  webhookSecret: process.env.WEBHOOK_SECRET || '',
  baseProcessPort: parseInt(process.env.BASE_PROCESS_PORT, 10) || 9100,
  buildPollMs: parseInt(process.env.BUILD_POLL_MS, 10) || 2000
};

console.log('=== Multi-Branch Deploy System ===');
console.log(`Webhook port:  ${config.webhookPort}`);
console.log(`Status port:   ${config.statusPort}`);
console.log(`Process ports: ${config.baseProcessPort}+`);
console.log(`Repo URL:      ${config.repoUrl || '(manual triggers only)'}`);
console.log('==================================\n');

// Worker status tracking
const workerStatuses = {};

function onWorkerStatus(status) {
  workerStatuses[status.name] = status;
}

// Initialize workers
const webhookWorker = new WebhookWorker({
  port: config.webhookPort,
  secret: config.webhookSecret,
  onStatus: onWorkerStatus
});

const processManager = new ProcessManager({
  basePort: config.baseProcessPort,
  onStatus: onWorkerStatus
});

const buildWorker = new BuildWorker({
  repoUrl: config.repoUrl,
  pollInterval: config.buildPollMs,
  onStatus: onWorkerStatus,
  onBuildComplete: (record) => {
    console.log(`[orchestrator] Build complete: ${record.branch} (${record.success ? 'OK' : 'FAIL'})`);
  }
});

const statusServer = new StatusServer({
  port: config.statusPort,
  webhookPort: config.webhookPort,
  processManager,
  getWorkerStatuses: () => [
    webhookWorker.getStatus(),
    buildWorker.getStatus(),
    processManager.getStatus(),
    statusServer.getStatus()
  ],
  getBuildHistory: () => buildWorker.getBuildHistory()
});

// Start everything
webhookWorker.start();
buildWorker.start();
processManager.start();
statusServer.start();

// Graceful shutdown
function shutdown(signal) {
  console.log(`\n[orchestrator] Received ${signal}, shutting down...`);
  webhookWorker.stop();
  buildWorker.stop();
  processManager.stop();
  statusServer.stop();
  // Give child processes time to exit
  setTimeout(() => process.exit(0), 1000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
