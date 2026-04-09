/**
 * Client-side log forwarder — intercepts console.{log,warn,error,info,debug}
 * and sends them to the server for Claude to read when debugging issues.
 *
 * Only active on dev/debug sites (*.dev.whoeverwants.com, localhost).
 * Does NOT activate on production (whoeverwants.com).
 */

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

function isDevSite(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.endsWith('.dev.whoeverwants.com')
  );
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
        return JSON.stringify(arg, null, 2);
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

  // Use sendBeacon for reliability (survives page unload), fall back to fetch
  const url = '/api/client-logs';
  const sent = navigator.sendBeacon?.(url, new Blob([payload], { type: 'application/json' }));
  if (!sent) {
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {
      // silently discard — we don't want log forwarding to cause errors
    });
  }
}

/**
 * Install console interceptors. Safe to call multiple times — only installs once.
 * Call this from a useEffect in a client component (e.g., template.tsx).
 */
export function installClientLogForwarder() {
  if (installed || typeof window === 'undefined') return;
  if (!isDevSite()) return;

  installed = true;

  const levels = ['log', 'warn', 'error', 'info', 'debug'] as const;
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
