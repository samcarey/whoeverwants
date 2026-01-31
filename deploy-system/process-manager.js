// Process Manager - manages one child process per branch.
//
// On startup, scans builds/ for existing branch directories with metadata.json
// and starts a child process for each.
//
// Watches all metadata.json files via chokidar. When a metadata file changes
// (new build completed), it kills the old child process and starts a new one
// with the updated binary.
//
// Each child process runs: node server.js <branch-name> <port>
// Ports are dynamically assigned starting from a base port.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const chokidar = require('chokidar');

const BUILDS_DIR = path.join(__dirname, 'builds');

class ProcessManager {
  constructor({ basePort = 9100, onStatus }) {
    this.basePort = basePort;
    this.nextPort = basePort;
    this.onStatus = onStatus || (() => {});
    this.processes = new Map(); // branch -> { proc, port, metadata, startedAt }
    this.watcher = null;
    this.status = 'stopped';
  }

  start() {
    this.status = 'running';
    this._ensureDir();
    this._scanExisting();
    this._watchMetadata();
    this.onStatus(this.getStatus());
    console.log('[process-manager] Started, watching for metadata changes...');
  }

  _ensureDir() {
    if (!fs.existsSync(BUILDS_DIR)) fs.mkdirSync(BUILDS_DIR, { recursive: true });
  }

  _scanExisting() {
    if (!fs.existsSync(BUILDS_DIR)) return;
    const dirs = fs.readdirSync(BUILDS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory());

    for (const dir of dirs) {
      const metaPath = path.join(BUILDS_DIR, dir.name, 'metadata.json');
      if (fs.existsSync(metaPath)) {
        this._startOrRestart(dir.name, metaPath);
      }
    }
  }

  _watchMetadata() {
    this.watcher = chokidar.watch(path.join(BUILDS_DIR, '*/metadata.json'), {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }
    });

    this.watcher.on('add', (filepath) => {
      const branch = path.basename(path.dirname(filepath));
      console.log(`[process-manager] New metadata detected: ${branch}`);
      this._startOrRestart(branch, filepath);
    });

    this.watcher.on('change', (filepath) => {
      const branch = path.basename(path.dirname(filepath));
      console.log(`[process-manager] Metadata changed: ${branch}`);
      this._startOrRestart(branch, filepath);
    });
  }

  _startOrRestart(branch, metaPath) {
    // Read metadata
    let metadata;
    try {
      metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    } catch (err) {
      console.error(`[process-manager] Failed to read metadata for ${branch}:`, err.message);
      return;
    }

    // Kill existing process for this branch
    if (this.processes.has(branch)) {
      const existing = this.processes.get(branch);
      console.log(`[process-manager] Stopping old process for ${branch} (pid: ${existing.proc.pid})`);
      existing.proc.kill('SIGTERM');
      // Reuse the same port
      this._spawnProcess(branch, existing.port, metadata);
    } else {
      // Assign new port
      const port = this.nextPort++;
      this._spawnProcess(branch, port, metadata);
    }
  }

  _spawnProcess(branch, port, metadata) {
    const serverScript = path.join(BUILDS_DIR, branch, 'server.js');
    if (!fs.existsSync(serverScript)) {
      console.error(`[process-manager] No server.js found for ${branch}`);
      return;
    }

    const proc = spawn('node', [serverScript, branch, String(port)], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: path.join(BUILDS_DIR, branch)
    });

    proc.stdout.on('data', (data) => {
      console.log(`[${branch}] ${data.toString().trim()}`);
    });

    proc.stderr.on('data', (data) => {
      console.error(`[${branch}:err] ${data.toString().trim()}`);
    });

    proc.on('exit', (code) => {
      console.log(`[process-manager] Process for ${branch} exited with code ${code}`);
      // Don't remove from map - it will be restarted on next metadata change
      const entry = this.processes.get(branch);
      if (entry && entry.proc === proc) {
        entry.proc = null;
        entry.exitCode = code;
      }
      this.onStatus(this.getStatus());
    });

    this.processes.set(branch, {
      proc,
      port,
      metadata,
      startedAt: new Date().toISOString()
    });

    console.log(`[process-manager] Started ${branch} on port ${port} (pid: ${proc.pid})`);
    this.onStatus(this.getStatus());
  }

  getPortForBranch(branch) {
    const entry = this.processes.get(branch);
    return entry ? entry.port : null;
  }

  getAllBranches() {
    const result = {};
    for (const [branch, entry] of this.processes) {
      result[branch] = {
        port: entry.port,
        running: entry.proc !== null && entry.proc.exitCode === null,
        pid: entry.proc?.pid || null,
        startedAt: entry.startedAt,
        metadata: entry.metadata
      };
    }
    return result;
  }

  getStatus() {
    const branches = this.getAllBranches();
    const running = Object.values(branches).filter(b => b.running).length;
    return {
      name: 'process-manager',
      status: this.status,
      totalBranches: Object.keys(branches).length,
      runningProcesses: running,
      branches
    };
  }

  stop() {
    if (this.watcher) this.watcher.close();
    for (const [branch, entry] of this.processes) {
      if (entry.proc) {
        entry.proc.kill('SIGTERM');
      }
    }
    this.status = 'stopped';
  }
}

module.exports = ProcessManager;
