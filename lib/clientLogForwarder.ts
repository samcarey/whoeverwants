/**
 * Client-side log forwarder — intercepts console.{log,warn,error,info,debug}
 * and sends them to the server for Claude to read when debugging issues.
 *
 * Active on every site we ship to (dev / canary / production). The server
 * stores logs in a 2000-entry ring buffer that auto-evicts; no persistence,
 * no PII surface beyond what the user's console already shows. The prod-site
 * activation exists primarily to capture WKWebView-specific JS errors from
 * the iOS TestFlight app, which loads whoeverwants.com directly and has no
 * other diagnostic channel (Safari Web Inspector requires a wired Mac).
 */

import { API_ORIGIN } from "./api/_internal";

const BATCH_INTERVAL_MS = 2000;
const MAX_QUEUE_SIZE = 500;
const MAX_MESSAGE_LENGTH = 4000;

interface LogEntry {
  level: string;
  message: string;
  timestamp: string;
  url: string;
  userAgent: string;
}

let queue: LogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let sessionId: string | null = null;
let installed = false;

function isLogForwardingEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.endsWith('.dev.whoeverwants.com') ||
    host === 'latest.whoeverwants.com' ||
    host === 'whoeverwants.com'
  );
}

// On canary + prod, only the warn/error stream + unhandled events get
// forwarded. Verbose log/info/debug from a busy session would churn the
// server's 10000-entry ring buffer fast and drown out the WKWebView errors
// this is here to capture. Dev hosts forward everything (low traffic +
// devs want full context).
function isHighVolumeHost(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host === 'latest.whoeverwants.com' || host === 'whoeverwants.com';
}

function getSessionId(): string {
  if (!sessionId) {
    sessionId = Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  return sessionId;
}

function serialize(...args: unknown[]): string {
  const parts = args.map(arg => {
    if (arg === undefined) return 'undefined';
    if (arg === null) return 'null';
    if (arg instanceof Error) return `${arg.name}: ${arg.message}\n${arg.stack || ''}`;
    if (typeof arg === 'object') {
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    }
    return String(arg);
  });
  const msg = parts.join(' ');
  return msg.length > MAX_MESSAGE_LENGTH ? msg.slice(0, MAX_MESSAGE_LENGTH) + '…[truncated]' : msg;
}

function enqueue(level: string, ...args: unknown[]) {
  if (queue.length >= MAX_QUEUE_SIZE) {
    queue.shift(); // drop oldest
  }
  queue.push({
    level,
    message: serialize(...args),
    timestamp: new Date().toISOString(),
    url: window.location.href,
    userAgent: navigator.userAgent,
  });
  scheduleFlush();
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, BATCH_INTERVAL_MS);
}

function flush() {
  flushTimer = null;
  if (queue.length === 0) return;

  const batch = queue.splice(0);
  const payload = JSON.stringify({ logs: batch, sessionId: getSessionId() });

  // iOS WKWebView (Capacitor + PWA + Safari) silently drops cross-origin
  // `sendBeacon` POSTs with `application/json` Blobs: the CORS preflight
  // succeeds, sendBeacon returns true (queued), but the actual POST never
  // fires and the server never sees the data. Observed empirically — the
  // log buffer was permanently empty on `latest.whoeverwants.com` despite
  // the forwarder being installed, with only OPTIONS preflights landing.
  //
  // `fetch keepalive` is the cross-platform reliable path. The trade-off
  // vs sendBeacon: fetch keepalive caps the body at 64 KB (per spec) and
  // doesn't survive a page-unload as aggressively. Both are fine for our
  // 2-second-batched, sub-KB-per-message workload.
  const url = `${API_ORIGIN}/api/client-logs`;
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
  }).catch(() => {
    // silently discard — we don't want log forwarding to cause errors
  });
}

/**
 * Install console interceptors. Safe to call multiple times — only installs once.
 * Call this from a useEffect in a client component (e.g., template.tsx).
 */
export function installClientLogForwarder() {
  if (installed || typeof window === 'undefined') return;
  if (!isLogForwardingEnabled()) return;

  installed = true;

  const levels = isHighVolumeHost()
    ? (['warn', 'error'] as const)
    : (['log', 'warn', 'error', 'info', 'debug'] as const);
  for (const level of levels) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      enqueue(level, ...args);
    };
  }

  // Capture unhandled errors
  window.addEventListener('error', (event) => {
    enqueue('error', `[Unhandled Error] ${event.message} at ${event.filename}:${event.lineno}:${event.colno}`);
  });

  // Capture unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason instanceof Error
      ? `${event.reason.name}: ${event.reason.message}\n${event.reason.stack || ''}`
      : String(event.reason);
    enqueue('error', `[Unhandled Rejection] ${reason}`);
  });

  // Flush on page unload
  window.addEventListener('beforeunload', flush);
  window.addEventListener('pagehide', flush);
}
