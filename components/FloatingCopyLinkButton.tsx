"use client";

import { useState } from "react";

interface FloatingCopyLinkButtonProps {
  url: string;
}

export default function FloatingCopyLinkButton({ url }: FloatingCopyLinkButtonProps) {
  const [copied, setCopied] = useState(false);
  
  // In development, move button more to the left to avoid dev tools
  const isDev = process.env.NODE_ENV === 'development';
  const rightPosition = isDev ? 'right-12' : 'right-4';

  const copyToClipboard = async () => {
    if (!url) return;

    try {
      // Try modern clipboard API first (requires HTTPS and browser support)
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        return;
      }

      // Fallback for older browsers or non-secure contexts
      const textArea = document.createElement('textarea');
      textArea.value = url;
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
      alert(`Copy this link: ${url}`);
    }
  };

  if (!url) return null;

  return (
    <div className={`fixed bottom-4 ${rightPosition} z-50`}>
      <button
        onClick={copyToClipboard}
        className="flex items-center justify-center w-12 h-12 bg-green-600 hover:bg-green-700 text-white rounded-full shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-105"
        title={copied ? "Copied!" : "Copy poll link"}
        aria-label={copied ? "Link copied to clipboard" : "Copy poll link to clipboard"}
      >
        {copied ? (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
        )}
      </button>
    </div>
  );
}