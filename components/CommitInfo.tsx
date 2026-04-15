"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useLongPress } from '@/lib/useLongPress';
import { createPortal } from 'react-dom';

interface CommitData {
  sha: string;
  commit: {
    message: string;
    author: {
      name: string;
      date: string;
    };
  };
  html_url: string;
}

interface LogEntry {
  level: 'log' | 'warn' | 'error' | 'info';
  args: string;
  timestamp: number;
}

const REPO = "samcarey/whoeverwants";

// Global log buffer, persists across renders
const logBuffer: LogEntry[] = [];
const MAX_LOG_ENTRIES = 500;
let consoleIntercepted = false;

function interceptConsole() {
  if (consoleIntercepted || typeof window === 'undefined') return;
  consoleIntercepted = true;

  const levels = ['log', 'warn', 'error', 'info'] as const;
  for (const level of levels) {
    const original = console[level];
    console[level] = (...args: unknown[]) => {
      original.apply(console, args);
      const entry: LogEntry = {
        level,
        args: args.map(a => {
          if (typeof a === 'string') return a;
          try { return JSON.stringify(a); } catch { return String(a); }
        }).join(' '),
        timestamp: Date.now(),
      };
      logBuffer.push(entry);
      if (logBuffer.length > MAX_LOG_ENTRIES) logBuffer.shift();
      // Notify listeners
      window.dispatchEvent(new Event('__console_log'));
    };
  }
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffYears > 0) return `${diffYears}y ago`;
  if (diffMonths > 0) return `${diffMonths}mo ago`;
  if (diffWeeks > 0) return `${diffWeeks}w ago`;
  if (diffDays > 0) return `${diffDays}d ago`;
  if (diffHours > 0) return `${diffHours}h ago`;
  if (diffMinutes > 0) return `${diffMinutes}m ago`;
  if (diffSeconds > 0) return `${diffSeconds}s ago`;
  return 'now';
}

function formatDate(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const year = date.getFullYear().toString().slice(-2);
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

export default function CommitInfo({ showTimeBadge = false }: { showTimeBadge?: boolean }) {
  const [commitData, setCommitData] = useState<CommitData | null>(null);
  const [relativeTime, setRelativeTime] = useState<string>('');
  const [showModal, setShowModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'build' | 'logs' | 'experimental'>('build');
  const [error, setError] = useState<string | null>(null);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [copyLabel, setCopyLabel] = useState('Copy All Logs');
  const logsEndRef = useRef<HTMLDivElement>(null);

  const vercelHash = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || '';
  const branchName = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF || '';
  const [commitHash, setCommitHash] = useState(vercelHash);
  const [badgeTarget, setBadgeTarget] = useState<HTMLElement | null>(null);
  const { props: badgeLongPressProps } = useLongPress(() => setShowModal(true));

  // Find the portal target for the time badge (inside scroll container so it scrolls with content).
  // The portal div is rendered by template.tsx only after its isMounted state flips to true, which
  // can happen after this effect runs. Navigation can also cause React to replace the portal div,
  // leaving our stored reference pointing at a detached DOM node — so the observer stays
  // connected for the lifetime of the component and re-queries whenever the DOM changes. The
  // state setter only writes when the node identity actually changes, so this doesn't spam renders.
  useEffect(() => {
    if (!showTimeBadge) return;
    const check = () => {
      const el = document.getElementById('commit-badge-portal');
      setBadgeTarget(prev => (prev === el ? prev : el));
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [showTimeBadge]);

  // In dev mode, fetch the current git SHA from the server on mount and on visibility change
  useEffect(() => {
    if (vercelHash) return; // Vercel build — SHA is baked in
    const fetchGitSha = async () => {
      try {
        const res = await fetch('/api/git-info');
        if (!res.ok) return;
        const { sha } = await res.json();
        if (sha) setCommitHash(prev => prev === sha ? prev : sha);
      } catch { /* ignore */ }
    };
    fetchGitSha();
    const onVisibility = () => { if (document.visibilityState === 'visible') fetchGitSha(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [vercelHash]);

  const fetchCommitInfo = useCallback(async () => {
    if (!commitHash) {
      setError('dev');
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(
        `https://api.github.com/repos/${REPO}/commits/${commitHash}`,
        { signal: controller.signal }
      );
      clearTimeout(timeoutId);
      if (!response.ok) throw new Error('Failed to fetch');

      const data: CommitData = await response.json();
      setCommitData(data);
      setRelativeTime(formatRelativeTime(new Date(data.commit.author.date)));
    } catch {
      clearTimeout(timeoutId);
      setError(commitHash.substring(0, 7));
    }
  }, [commitHash]);

  useEffect(() => {
    fetchCommitInfo();
  }, [fetchCommitInfo]);

  // Update relative time every 30 seconds
  useEffect(() => {
    if (!commitData) return;
    const interval = setInterval(() => {
      setRelativeTime(formatRelativeTime(new Date(commitData.commit.author.date)));
    }, 30000);
    return () => clearInterval(interval);
  }, [commitData]);

  // Listen for custom event to open modal (triggered by header click)
  useEffect(() => {
    const handleOpen = () => setShowModal(true);
    window.addEventListener('openCommitInfo', handleOpen);
    return () => window.removeEventListener('openCommitInfo', handleOpen);
  }, []);

  // Intercept console on mount and listen for new entries
  useEffect(() => {
    interceptConsole();
    setLogEntries([...logBuffer]);
    const handleLog = () => setLogEntries([...logBuffer]);
    window.addEventListener('__console_log', handleLog);
    return () => window.removeEventListener('__console_log', handleLog);
  }, []);

  // Auto-scroll logs to bottom when new entries arrive
  useEffect(() => {
    if (activeTab === 'logs' && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logEntries, activeTab]);

  // Close modal on Escape
  useEffect(() => {
    if (!showModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowModal(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showModal]);

  const commitDate = commitData ? new Date(commitData.commit.author.date) : null;
  const shortHash = commitHash ? commitHash.substring(0, 7) : '';

  const handleCopyLogs = () => {
    const text = logBuffer.map(e => e.args).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopyLabel('Copied!');
      setTimeout(() => setCopyLabel('Copy All Logs'), 1500);
    });
  };

  return (
    <>
      {/* Time badge - only shown in dev mode, portaled into scroll container so it scrolls with content */}
      {showTimeBadge && badgeTarget && createPortal(
        <div
          className="flex justify-center select-none"
          {...badgeLongPressProps}
        >
          <span className="text-[10px] font-mono text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            {relativeTime || error || '...'}
          </span>
        </div>,
        badgeTarget
      )}

      {/* Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60"
          onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}
        >
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-5 max-w-lg w-[90%] max-h-[60vh] flex flex-col overflow-hidden shadow-xl">
            {/* Tab bar */}
            <div className="flex mb-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
              <button
                className={`flex-1 py-1.5 text-center text-xs cursor-pointer border-b-2 transition-colors select-none ${
                  activeTab === 'build'
                    ? 'text-blue-600 dark:text-blue-400 border-blue-600 dark:border-blue-400'
                    : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 border-transparent'
                }`}
                onClick={() => setActiveTab('build')}
              >
                Build Info
              </button>
              <button
                className={`flex-1 py-1.5 text-center text-xs cursor-pointer border-b-2 transition-colors select-none ${
                  activeTab === 'logs'
                    ? 'text-blue-600 dark:text-blue-400 border-blue-600 dark:border-blue-400'
                    : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 border-transparent'
                }`}
                onClick={() => setActiveTab('logs')}
              >
                Logs
              </button>
              <button
                className={`flex-1 py-1.5 text-center text-xs cursor-pointer border-b-2 transition-colors select-none ${
                  activeTab === 'experimental'
                    ? 'text-blue-600 dark:text-blue-400 border-blue-600 dark:border-blue-400'
                    : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 border-transparent'
                }`}
                onClick={() => setActiveTab('experimental')}
              >
                Experimental
              </button>
            </div>

            {/* Build Info tab */}
            {activeTab === 'build' && (
              <div className="space-y-3 overflow-y-auto">
                {commitData ? (
                  <>
                    {branchName && (
                      <div className="font-mono text-xs text-gray-500 dark:text-gray-400">
                        Branch: <span className="text-gray-700 dark:text-gray-300">{branchName}</span>
                      </div>
                    )}
                    {commitDate && (
                      <div className="font-mono text-xs text-gray-500 dark:text-gray-400">
                        {formatDate(commitDate)} ({relativeTime})
                      </div>
                    )}
                    <div className="font-mono text-xs">
                      <a
                        href={`https://github.com/${REPO}/commit/${commitHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {shortHash}
                      </a>
                    </div>
                    <div className="text-sm leading-relaxed whitespace-pre-wrap break-words text-gray-800 dark:text-gray-200 border-t border-gray-200 dark:border-gray-700 pt-3 mt-3">
                      {commitData.commit.message}
                    </div>
                  </>
                ) : error ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    {error === 'dev' ? 'Running in development mode — no commit info available.' : `Commit: ${error}`}
                  </div>
                ) : (
                  <div className="text-sm text-gray-500">Loading commit info...</div>
                )}
              </div>
            )}

            {/* Logs tab */}
            {activeTab === 'logs' && (
              <div className="flex flex-col flex-1 min-h-0">
                <div className="font-mono text-xs flex-1 min-h-[80px] overflow-y-auto mb-2">
                  {logEntries.length === 0 ? (
                    <div className="text-sm text-gray-500 dark:text-gray-400">No console output yet.</div>
                  ) : (
                    logEntries.map((entry, i) => (
                      <div
                        key={i}
                        className={`py-0.5 border-b border-gray-100 dark:border-gray-800 whitespace-pre-wrap break-words ${
                          entry.level === 'error' ? 'text-red-600 dark:text-red-400' :
                          entry.level === 'warn' ? 'text-yellow-600 dark:text-yellow-400' :
                          'text-gray-800 dark:text-gray-200'
                        }`}
                      >
                        {entry.args}
                      </div>
                    ))
                  )}
                  <div ref={logsEndRef} />
                </div>
                <button
                  className="shrink-0 px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded transition-colors"
                  onClick={handleCopyLogs}
                >
                  {copyLabel}
                </button>
              </div>
            )}

            {/* Experimental tab */}
            {activeTab === 'experimental' && (
              <div className="space-y-3 overflow-y-auto">
                <p className="text-xs text-gray-500 dark:text-gray-400">Hidden poll types and experimental features.</p>
                <a
                  href="/create-poll?mode=participation"
                  className="block w-full px-3 py-2 text-sm text-center bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-700 rounded-md hover:bg-purple-200 dark:hover:bg-purple-800/50 transition-colors"
                  onClick={() => setShowModal(false)}
                >
                  Create Participation Poll
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
