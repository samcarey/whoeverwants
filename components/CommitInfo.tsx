"use client";

import { useState, useEffect, useCallback } from 'react';

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

const REPO = "samcarey/whoeverwants";

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
  const [activeTab, setActiveTab] = useState<'commit' | 'env'>('commit');
  const [error, setError] = useState<string | null>(null);

  const commitHash = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || '';
  const branchName = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF || '';

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

  return (
    <>
      {/* Time badge - only shown in dev mode, positioned top center with no top margin */}
      {showTimeBadge && (
        <div
          className="fixed top-0 left-1/2 -translate-x-1/2 z-[9999] cursor-pointer select-none"
          onClick={() => setShowModal(true)}
        >
          <span className="text-[10px] font-mono text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            {relativeTime || error || '...'}
          </span>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60"
          onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}
        >
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-5 max-w-lg w-[90%] max-h-[70vh] overflow-y-auto shadow-xl">
            <h3 className="text-sm font-semibold text-blue-600 dark:text-blue-400 mb-3">Build Info</h3>

            {/* Tab bar */}
            <div className="flex gap-1 mb-4 border-b border-gray-200 dark:border-gray-700">
              <button
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  activeTab === 'commit'
                    ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                    : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
                onClick={() => setActiveTab('commit')}
              >
                Commit
              </button>
              <button
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  activeTab === 'env'
                    ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                    : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
                onClick={() => setActiveTab('env')}
              >
                Environment
              </button>
            </div>

            {/* Commit tab */}
            {activeTab === 'commit' && (
              <div className="space-y-3">
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

            {/* Environment tab */}
            {activeTab === 'env' && (
              <div className="space-y-2 font-mono text-xs">
                <div>
                  <span className="text-gray-400 dark:text-gray-500">NODE_ENV:</span>{' '}
                  <span className="text-gray-700 dark:text-gray-300">{process.env.NODE_ENV}</span>
                </div>
                <div>
                  <span className="text-gray-400 dark:text-gray-500">Commit:</span>{' '}
                  <span className="text-gray-700 dark:text-gray-300">{shortHash || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-gray-400 dark:text-gray-500">Branch:</span>{' '}
                  <span className="text-gray-700 dark:text-gray-300">{branchName || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-gray-400 dark:text-gray-500">Repo:</span>{' '}
                  <a
                    href={`https://github.com/${REPO}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {REPO}
                  </a>
                </div>
              </div>
            )}

            {/* Close button */}
            <button
              className="mt-4 px-4 py-2 text-sm bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded transition-colors"
              onClick={() => setShowModal(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
