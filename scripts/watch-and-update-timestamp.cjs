#!/usr/bin/env node

/**
 * File Watcher for Build Timestamp Updates
 * 
 * Watches TypeScript/JavaScript files and updates the compilation timestamp
 * whenever any file changes. This provides accurate build age tracking
 * regardless of Next.js compilation mode (webpack vs turbopack).
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..');
const TIMESTAMP_FILE = path.join(PROJECT_ROOT, 'lib', 'last-compile-time.ts');

// Patterns to watch for changes
const WATCH_PATTERNS = [
  'app/**/*.{ts,tsx,js,jsx}',
  'components/**/*.{ts,tsx,js,jsx}', 
  'lib/**/*.{ts,tsx,js,jsx}',
  '*.{ts,tsx,js,jsx,json}',
];

// Debounce file updates to avoid rapid-fire writes
let updateTimer = null;
const DEBOUNCE_MS = 500;

function updateTimestamp() {
  const timestamp = Date.now();
  const content = `// Auto-generated on every compilation
export const lastCompileTime = ${timestamp};
export const lastCompileISO = "${new Date(timestamp).toISOString()}";
`;
  
  try {
    fs.writeFileSync(TIMESTAMP_FILE, content);
    console.log(`✓ Build timestamp updated: ${new Date(timestamp).toISOString()}`);
  } catch (e) {
    console.error(`Failed to write timestamp file: ${e.message}`);
  }
}

function debouncedUpdate() {
  if (updateTimer) {
    clearTimeout(updateTimer);
  }
  updateTimer = setTimeout(updateTimestamp, DEBOUNCE_MS);
}

function startFileWatcher() {
  console.log('🔍 Starting file watcher for build timestamp tracking...');
  console.log('📁 Watching patterns:', WATCH_PATTERNS);
  
  // Use chokidar if available, otherwise fall back to simple fs.watch
  try {
    const chokidar = require('chokidar');
    
    const watcher = chokidar.watch(WATCH_PATTERNS, {
      cwd: PROJECT_ROOT,
      ignored: [
        '**/node_modules/**',
        '**/.next/**',
        '**/out/**',
        '**/dist/**',
        '**/.git/**',
        TIMESTAMP_FILE, // Don't watch our own timestamp file
      ],
      ignoreInitial: true,
    });
    
    watcher.on('change', (filePath) => {
      console.log(`📝 File changed: ${filePath}`);
      debouncedUpdate();
    });
    
    watcher.on('add', (filePath) => {
      console.log(`➕ File added: ${filePath}`);
      debouncedUpdate();
    });
    
    console.log('✅ File watcher started with chokidar');
    
  } catch (e) {
    console.log('⚠️ chokidar not available, using basic file watching');
    
    // Fallback to basic fs.watch (less reliable but works without dependencies)
    const dirsToWatch = ['app', 'components', 'lib'];
    
    dirsToWatch.forEach(dir => {
      const watchPath = path.join(PROJECT_ROOT, dir);
      if (fs.existsSync(watchPath)) {
        fs.watch(watchPath, { recursive: true }, (eventType, filename) => {
          if (filename && /\\.(ts|tsx|js|jsx)$/.test(filename)) {
            console.log(`📝 File ${eventType}: ${dir}/${filename}`);
            debouncedUpdate();
          }
        });
      }
    });
    
    console.log('✅ Basic file watcher started');
  }
  
  // Write initial timestamp
  updateTimestamp();
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\\n🛑 File watcher stopping...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\\n🛑 File watcher stopping...');
  process.exit(0);
});

// Start watching
startFileWatcher();