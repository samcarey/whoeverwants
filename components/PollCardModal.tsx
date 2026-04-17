"use client";

import React, { useEffect, useLayoutEffect, useRef, useState, Suspense } from "react";
import { createPortal } from "react-dom";
import { Poll } from "@/lib/types";
import { apiGetPollById, apiGetPollByShortId } from "@/lib/api";
import { getCachedPollById, getCachedPollByShortId } from "@/lib/pollCache";
import { isUuidLike } from "@/lib/pollId";
import { addAccessiblePollId } from "@/lib/browserPollAccess";
import PollPageClient from "@/app/p/[shortId]/PollPageClient";
import { POLL_MODAL_SUBMIT_PORTAL_ID } from "@/lib/pollModalContext";

// Modal shell z-index — matches create-poll modal (z-60)
const MODAL_Z = 60;

// Animation duration for expand/shrink FLIP
const FLIP_DURATION_MS = 320;

export interface PollCardModalProps {
  // The poll being shown (may be null while fetching — modal renders skeleton).
  poll: Poll | null;
  // DOMRect of the source card to expand from. null → fade-in (direct link).
  sourceRect: DOMRect | null;
  // Called when the X button is tapped or a vote submit triggers close.
  // Receives the current source rect (looked up from getCurrentRect at close time)
  // so the modal can shrink to the card's current location.
  onClose: () => void;
  // Lookup fn that returns the current on-screen rect of the source card, or null
  // if it's no longer visible. Used to pick the target rect for the shrink animation.
  getCurrentRect?: () => DOMRect | null;
  // createdDate string for PollPageClient — optional; falls back to computing from poll.
  createdDate?: string;
}

/** Expanding-card modal that wraps PollPageClient. Uses FLIP animation between
 *  a source card rect and the full modal rect. */
export default function PollCardModal({
  poll,
  sourceRect,
  onClose,
  getCurrentRect,
  createdDate,
}: PollCardModalProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isClosing, setIsClosing] = useState(false);
  // Avoid SSR mismatch: document.body is only available client-side.
  const canPortal = typeof window !== 'undefined';

  // Lock body scroll while open — matches create-poll modal behavior.
  useEffect(() => {
    const scrollY = window.scrollY;
    const html = document.documentElement;
    html.style.overscrollBehavior = 'none';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.overflow = 'hidden';
    return () => {
      html.style.overscrollBehavior = '';
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.left = '';
      document.body.style.right = '';
      document.body.style.overflow = '';
      window.scrollTo(0, scrollY);
    };
  }, []);

  // Expand animation: before paint, position the sheet at the source rect (with
  // transform scale + origin) and matching border-radius, then on the next frame
  // animate to the natural rect (transform: none, final border-radius).
  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    const backdrop = backdropRef.current;
    const content = contentRef.current;
    if (!sheet || !backdrop) return;

    if (sourceRect) {
      // Measure natural rect of the sheet after its initial render.
      const targetRect = sheet.getBoundingClientRect();
      const sx = sourceRect.width / targetRect.width;
      const sy = sourceRect.height / targetRect.height;
      const tx = sourceRect.left - targetRect.left;
      const ty = sourceRect.top - targetRect.top;
      // eslint-disable-next-line no-console
      console.log('[PollCardModal] expand setup: sourceRect=', sourceRect, 'targetRect=', targetRect, 'sx=', sx, 'sy=', sy, 'tx=', tx, 'ty=', ty);
      // Position the sheet visually at the source card with transition:none.
      sheet.style.transformOrigin = 'top left';
      sheet.style.transition = 'none';
      sheet.style.transform = `translate(${tx}px, ${ty}px) scale(${sx}, ${sy})`;
      sheet.style.borderRadius = '1rem'; // match card's rounded-2xl
      // eslint-disable-next-line no-console
      console.log('[PollCardModal] post-set inline transform:', sheet.style.transform);
      // Hide content until expand completes so it doesn't visually squash.
      if (content) {
        content.style.transition = 'none';
        content.style.opacity = '0';
      }
      backdrop.style.transition = 'none';
      backdrop.style.opacity = '0';

      // Double rAF: the first rAF runs before paint, the browser paints the
      // shrunken state, then the second rAF fires on the following frame and
      // applies the target state. This guarantees the transition engine sees
      // a real style change between two paints and starts the transition.
      requestAnimationFrame(() => {
        // eslint-disable-next-line no-console
        console.log('[PollCardModal] rAF1 fires. inline transform=', sheet.style.transform, 'computed transform=', window.getComputedStyle(sheet).transform);
        requestAnimationFrame(() => {
          // eslint-disable-next-line no-console
          console.log('[PollCardModal] rAF2 fires. inline transform=', sheet.style.transform, 'computed transform=', window.getComputedStyle(sheet).transform);
          if (!sheetRef.current) return;
          sheet.style.transition = `transform ${FLIP_DURATION_MS}ms cubic-bezier(0.32, 0.72, 0, 1), border-radius ${FLIP_DURATION_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`;
          sheet.style.transform = '';
          sheet.style.borderRadius = '';
          backdrop.style.transition = `opacity ${FLIP_DURATION_MS}ms ease-out`;
          backdrop.style.opacity = '';
          if (content) {
            content.style.transition = `opacity 200ms ease-out ${FLIP_DURATION_MS - 150}ms`;
            content.style.opacity = '1';
          }
        });
      });
    } else {
      // No source rect (direct link): simple fade-in.
      sheet.style.transition = 'none';
      sheet.style.opacity = '0';
      backdrop.style.transition = 'none';
      backdrop.style.opacity = '0';
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!sheetRef.current) return;
          sheet.style.transition = `opacity ${FLIP_DURATION_MS}ms ease-out`;
          sheet.style.opacity = '';
          backdrop.style.transition = `opacity ${FLIP_DURATION_MS}ms ease-out`;
          backdrop.style.opacity = '';
        });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClose = () => {
    if (isClosing) return;
    setIsClosing(true);
    const sheet = sheetRef.current;
    const backdrop = backdropRef.current;
    const content = contentRef.current;
    if (!sheet || !backdrop) return onClose();

    const currentRect = getCurrentRect ? getCurrentRect() : sourceRect;
    const targetRect = sheet.getBoundingClientRect();

    if (currentRect) {
      const sx = currentRect.width / targetRect.width;
      const sy = currentRect.height / targetRect.height;
      const tx = currentRect.left - targetRect.left;
      const ty = currentRect.top - targetRect.top;
      // Fade content out first, then shrink sheet. Force a reflow so the
      // content fade-out transition actually runs (otherwise setting
      // transform + border-radius below could cause the browser to batch
      // all style changes and skip the content fade).
      if (content) {
        content.style.transition = `opacity 120ms ease-in`;
        void content.offsetHeight;
        content.style.opacity = '0';
      }
      sheet.style.transformOrigin = 'top left';
      sheet.style.transition = `transform ${FLIP_DURATION_MS}ms cubic-bezier(0.32, 0.72, 0, 1), border-radius ${FLIP_DURATION_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`;
      void sheet.offsetHeight;
      sheet.style.transform = `translate(${tx}px, ${ty}px) scale(${sx}, ${sy})`;
      sheet.style.borderRadius = '1rem';
      backdrop.style.transition = `opacity ${FLIP_DURATION_MS}ms ease-in`;
      backdrop.style.opacity = '0';
    } else {
      // No target rect: fade out.
      sheet.style.transition = `opacity ${FLIP_DURATION_MS}ms ease-in`;
      void sheet.offsetHeight;
      sheet.style.opacity = '0';
      backdrop.style.transition = `opacity ${FLIP_DURATION_MS}ms ease-in`;
      backdrop.style.opacity = '0';
    }
    setTimeout(onClose, FLIP_DURATION_MS);
  };

  // Compute createdDate if not supplied
  const effectiveCreatedDate = (() => {
    if (createdDate) return createdDate;
    if (!poll) return '';
    const d = new Date(poll.created_at);
    const t = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
    return `@ ${t} ${d.toLocaleDateString("en-US", { year: "2-digit", month: "numeric", day: "numeric" })}`;
  })();

  if (!canPortal) return null;

  return createPortal(
    <div
      className="fixed inset-0"
      style={{ zIndex: MODAL_Z }}
      data-modal="poll-card"
    >
      {/* Backdrop */}
      <div
        ref={backdropRef}
        className="absolute inset-0 bg-black/40"
        onClick={handleClose}
      />
      {/* Modal sheet — same rounded-t corners, bg, and top-inset as create-poll modal.
           The sheet's shape + background animates via FLIP. Inner `contentRef`
           wraps header + content and fades in after expand completes, so the
           scaled sheet doesn't show a distorted X button during the animation. */}
      <div
        ref={sheetRef}
        className="absolute bottom-0 left-0 right-0 rounded-t-[32px] bg-white dark:bg-gray-900 shadow-2xl overflow-hidden"
        style={{
          top: 'calc(env(safe-area-inset-top, 0px) + 15px)',
          overscrollBehavior: 'none',
        }}
        onClick={e => e.stopPropagation()}
        data-poll-modal-mode="true"
      >
        <div ref={contentRef} className="absolute inset-0 flex flex-col">
          {/* Header — same layout as create-poll modal: close left, title center, submit portal right */}
          <div className="flex-shrink-0 relative flex items-center justify-between px-4 pt-3 pb-2">
            <button
              onClick={handleClose}
              className="w-[43px] h-[43px] flex items-center justify-center rounded-full bg-gray-200/80 dark:bg-gray-700/80 cursor-pointer z-10"
              aria-label="Close"
            >
              <svg className="w-[34px] h-[34px] text-black dark:text-white" fill="none" viewBox="0 0 24 24">
                <path stroke="currentColor" strokeLinecap="round" strokeWidth={0.75} d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
            <h2 className="absolute inset-0 flex items-center justify-center text-[17px] font-semibold pointer-events-none px-16 truncate">
              {poll?.title ?? ''}
            </h2>
            <div id={POLL_MODAL_SUBMIT_PORTAL_ID} className="flex-shrink-0 z-10" />
          </div>

          {/* Scrollable poll content */}
          <div ref={scrollRef} className="flex-1 overflow-auto overscroll-contain">
            <div className="max-w-4xl mx-auto px-4 pb-8">
              {poll ? (
                <PollPageClient
                  poll={poll}
                  createdDate={effectiveCreatedDate}
                  pollId={poll.id}
                  modalMode
                  onRequestClose={handleClose}
                />
              ) : (
                <div className="flex justify-center items-center py-20">
                  <svg className="animate-spin h-8 w-8 text-gray-400" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Async loader used by direct-link entry points (/p/[shortId]). Fetches the
 *  poll (prefers cache) and calls onPoll when ready so the modal content can
 *  render. */
export async function loadPollForModal(
  idOrShortId: string
): Promise<Poll | null> {
  if (typeof window === 'undefined') return null;
  try {
    const cached = isUuidLike(idOrShortId)
      ? getCachedPollById(idOrShortId)
      : getCachedPollByShortId(idOrShortId);
    if (cached) {
      addAccessiblePollId(cached.id);
      return cached;
    }
    const poll = isUuidLike(idOrShortId)
      ? await apiGetPollById(idOrShortId)
      : await apiGetPollByShortId(idOrShortId);
    if (poll) addAccessiblePollId(poll.id);
    return poll;
  } catch {
    return null;
  }
}
