"use client";

import { useState, useEffect } from "react";

interface FloatingCopyLinkButtonProps {
  url: string;
}

export default function FloatingCopyLinkButton({ url }: FloatingCopyLinkButtonProps) {
  const [copied, setCopied] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const [clientUrl, setClientUrl] = useState("");

  useEffect(() => {
    setIsClient(true);
    setClientUrl(url);
  }, [url]);

  const copyToClipboard = async () => {
    const urlToUse = clientUrl || url;
    if (!urlToUse) return;

    try {
      // Try modern clipboard API first (requires HTTPS and browser support)
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(urlToUse);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        return;
      }

      // Fallback for older browsers or non-secure contexts
      const textArea = document.createElement('textarea');
      textArea.value = urlToUse;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      
      if (successful) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } else {
        throw new Error('Copy command was unsuccessful');
      }
    } catch (error) {
      console.error("Failed to copy:", error);
      // Show a simple alert as final fallback
      alert(`Copy this link: ${urlToUse}`);
    }
  };

  // Only render after client hydration to avoid server-client mismatch
  if (!isClient || !clientUrl) {
    return (
      <div className="w-8 h-8 flex items-center justify-center">
        {/* Empty placeholder that matches the button dimensions */}
      </div>
    );
  }

  return (
    <button
        onClick={copyToClipboard}
        className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 active:bg-gray-200 dark:active:bg-gray-700 active:scale-95 rounded-full transition-all"
        title={copied ? "Copied!" : "Copy poll link"}
        aria-label={copied ? "Link copied to clipboard" : "Copy poll link to clipboard"}
      >
        {copied ? (
          <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
        )}
    </button>
  );
}