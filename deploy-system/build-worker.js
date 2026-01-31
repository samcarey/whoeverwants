// Build Worker - polls the queue, checks out branches, builds, and writes metadata.
//
// For each queued job:
//   1. Ensure a bare clone of the repo exists in repos/
//   2. Fetch the branch
//   3. Check out branch files to a working tree
//   4. "Build" the echo-server (just copy it + inject branch name)
//   5. Copy artifacts to builds/<branch>/
//   6. Write builds/<branch>/metadata.json (triggers process manager)

const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');
const { dequeue, peek } = require('./queue');

const BUILDS_DIR = path.join(__dirname, 'builds');
const REPOS_DIR = path.join(__dirname, 'repos');
const ECHO_SERVER_SRC = path.join(__dirname, 'echo-server.js');

class BuildWorker {
  constructor({ repoUrl, pollInterval = 2000, onStatus, onBuildComplete }) {
    this.repoUrl = repoUrl;
    this.pollInterval = pollInterval;
    this.onStatus = onStatus || (() => {});
    this.onBuildComplete = onBuildComplete || (() => {});
    this.status = 'stopped';
    this.currentBuild = null;
    this.buildHistory = []; // { branch, commitSha, startTime, endTime, success, error }
    this.timer = null;
  }

  start() {
    this.status = 'idle';
    this.onStatus(this.getStatus());
    this._ensureDirs();
    this._poll();
    console.log('[build-worker] Started, polling queue...');
  }

  _ensureDirs() {
    if (!fs.existsSync(BUILDS_DIR)) fs.mkdirSync(BUILDS_DIR, { recursive: true });
    if (!fs.existsSync(REPOS_DIR)) fs.mkdirSync(REPOS_DIR, { recursive: true });
  }

  _poll() {
    this.timer = setTimeout(async () => {
      try {
        const job = dequeue();
        if (job) {
          await this._processJob(job);
        }
      } catch (err) {
        console.error('[build-worker] Poll error:', err.message);
      }
      this._poll(); // schedule next poll
    }, this.pollInterval);
  }

  async _processJob(job) {
    const { branch, repoUrl, commitSha } = job;
    const buildRecord = {
      branch,
      commitSha,
      startTime: new Date().toISOString(),
      endTime: null,
      success: false,
      error: null
    };

    this.currentBuild = { branch, startedAt: buildRecord.startTime };
    this.status = 'building';
    this.onStatus(this.getStatus());
    console.log(`[build-worker] Building branch: ${branch}`);

    try {
      const effectiveRepoUrl = repoUrl || this.repoUrl;
      const repoDir = path.join(REPOS_DIR, 'source');

      // Clone or fetch
      if (!fs.existsSync(path.join(repoDir, '.git'))) {
        if (effectiveRepoUrl) {
          console.log(`[build-worker] Cloning ${effectiveRepoUrl}`);
          execFileSync('git', ['clone', effectiveRepoUrl, repoDir], { stdio: 'pipe' });
        } else {
          // No repo URL - initialize empty repo (for local testing)
          fs.mkdirSync(repoDir, { recursive: true });
          execFileSync('git', ['init'], { cwd: repoDir, stdio: 'pipe' });
        }
      }

      if (effectiveRepoUrl) {
        // Fetch the specific branch
        try {
          execFileSync('git', ['fetch', 'origin', branch], { cwd: repoDir, stdio: 'pipe' });
        } catch {
          execFileSync('git', ['fetch', '--all'], { cwd: repoDir, stdio: 'pipe' });
        }

        // Checkout the branch
        try {
          execFileSync('git', ['checkout', branch], { cwd: repoDir, stdio: 'pipe' });
        } catch {
          execFileSync('git', ['checkout', '-b', branch, `origin/${branch}`], { cwd: repoDir, stdio: 'pipe' });
        }

        // Pull latest
        try {
          execFileSync('git', ['pull', 'origin', branch], { cwd: repoDir, stdio: 'pipe' });
        } catch {
          // May fail if no tracking, that's ok after fetch+checkout
        }
      }

      // Get the actual HEAD commit
      let actualCommit = commitSha;
      try {
        actualCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf-8' }).trim();
      } catch {
        // ignore
      }

      // "Build" step: copy echo-server.js to builds/<branch>/
      const branchDir = path.join(BUILDS_DIR, sanitizeBranch(branch));
      if (!fs.existsSync(branchDir)) fs.mkdirSync(branchDir, { recursive: true });

      // Copy the echo server as the built artifact
      fs.copyFileSync(ECHO_SERVER_SRC, path.join(branchDir, 'server.js'));

      buildRecord.commitSha = actualCommit;
      buildRecord.endTime = new Date().toISOString();
      buildRecord.success = true;

      // Write metadata.json - this triggers the process manager
      const metadata = {
        branch,
        commitSha: actualCommit,
        buildTime: buildRecord.endTime,
        startTime: buildRecord.startTime,
        pusher: job.pusher || 'unknown',
        source: job.source || 'unknown'
      };
      fs.writeFileSync(
        path.join(branchDir, 'metadata.json'),
        JSON.stringify(metadata, null, 2)
      );

      console.log(`[build-worker] Build complete for ${branch} -> ${branchDir}`);
      this.onBuildComplete(buildRecord);

    } catch (err) {
      buildRecord.endTime = new Date().toISOString();
      buildRecord.error = err.message;
      console.error(`[build-worker] Build failed for ${branch}:`, err.message);
    }

    this.buildHistory.unshift(buildRecord);
    // Keep last 100 builds
    if (this.buildHistory.length > 100) this.buildHistory.pop();

    this.currentBuild = null;
    this.status = 'idle';
    this.onStatus(this.getStatus());
  }

  getStatus() {
    return {
      name: 'build-worker',
      status: this.status,
      currentBuild: this.currentBuild,
      queueDepth: peek(),
      totalBuilds: this.buildHistory.length,
      recentBuilds: this.buildHistory.slice(0, 5)
    };
  }

  getBuildHistory() {
    return this.buildHistory;
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.status = 'stopped';
  }
}

function sanitizeBranch(branch) {
  // Convert branch name to safe directory name
  return branch.replace(/[^a-zA-Z0-9_-]/g, '_');
}

module.exports = BuildWorker;
module.exports.sanitizeBranch = sanitizeBranch;
