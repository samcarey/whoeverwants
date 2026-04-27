"use client";

import React from 'react';

/**
 * Shared visual primitives used by RankableOptions for both the live ballot
 * and the floating drag preview, plus the link circles that toggle tied
 * rankings between adjacent items.
 */

export const LINK_CIRCLE_SIZE = 24;
export const LINK_ICON_SIZE = 15;
export const LINK_CONTOUR_FILTER = 'drop-shadow(0 0 3px var(--background)) drop-shadow(0 0 3px var(--background)) drop-shadow(0 0 3px var(--background)) drop-shadow(0 0 3px var(--background)) drop-shadow(0 0 3px var(--background)) drop-shadow(0 0 3px var(--background))';

/** The chain-link SVG glyph reused in link circles and drag preview links. */
export function LinkIcon({ size = LINK_ICON_SIZE }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

export function GripLines() {
  return (
    <div className="flex flex-col items-center justify-center my-0.5">
      <div className="w-3.5 h-0.5 bg-gray-300 dark:bg-gray-600 mb-0.5" />
      <div className="w-3.5 h-0.5 bg-gray-300 dark:bg-gray-600 mb-0.5" />
      <div className="w-3.5 h-0.5 bg-gray-300 dark:bg-gray-600" />
    </div>
  );
}

/** The up/down arrows + grip lines used in both live and preview drag handles. */
export function DragHandleVisual({ dimUp = false, variant = 'main' }: { dimUp?: boolean; variant?: 'main' | 'noPreference' }) {
  if (variant === 'noPreference') {
    return (
      <div className="flex flex-col items-center justify-center gap-0">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-green-500 dark:text-green-400">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        <GripLines />
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-green-500 dark:text-green-400">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center gap-0">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={dimUp ? 'text-gray-300 dark:text-gray-600' : 'text-gray-400 dark:text-gray-500'}>
        <polyline points="18 15 12 9 6 15" />
      </svg>
      <GripLines />
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 dark:text-gray-500">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </div>
  );
}

/**
 * Renders the interior of a tier card: rows of option content with divider
 * lines between them. Used by both the live ballot and the floating drag
 * preview so the visual structure stays in sync.
 */
export function TierCardRows({
  items,
  stepSize,
  gapSize: innerGap,
  itemHeight: rowHeight,
  dividerClassName,
  dividerInset = { left: '12px', right: '12px' },
  renderContent,
  rowProps,
}: {
  items: { id: string; text: string }[];
  stepSize: number;
  gapSize: number;
  itemHeight: number;
  dividerClassName: string;
  dividerInset?: { left: string; right: string };
  renderContent: (item: { id: string; text: string }, index: number) => React.ReactNode;
  rowProps?: (item: { id: string; text: string }, rowIdx: number) => Record<string, unknown>;
}) {
  return (
    <>
      {items.map((item, rowIdx) => {
        const rowTop = rowIdx * stepSize;
        const extra = rowProps?.(item, rowIdx) ?? {};
        return (
          <React.Fragment key={item.id}>
            <div
              className="absolute left-0 right-0 p-3"
              style={{ top: `${rowTop}px`, height: `${rowHeight}px` }}
              {...extra}
            >
              <div className="flex items-center justify-between h-full">
                {renderContent(item, rowIdx)}
              </div>
            </div>
            {rowIdx < items.length - 1 && (
              <div
                className={`absolute pointer-events-none border-t ${dividerClassName}`}
                style={{
                  top: `${rowTop + rowHeight + innerGap / 2}px`,
                  left: dividerInset.left,
                  right: dividerInset.right,
                  transform: 'translateY(-0.5px)',
                }}
              />
            )}
          </React.Fragment>
        );
      })}
    </>
  );
}

/**
 * Small round button that toggles whether two adjacent items are tied.
 * Uses the same chain-link glyph in both states — just blue when active
 * (linked) and muted gray when inactive (unlinked).
 *
 * Centered on the left edge of the cards column so the circle overlaps the
 * corners of the two items it sits between.
 */
export function LinkCircle({
  entry,
  disabled,
  onToggle,
  translateY,
}: {
  entry: { topCenter: number; linked: boolean; idA: string; idB: string };
  disabled: boolean;
  onToggle: (idA: string, idB: string) => void;
  translateY?: number;
}) {
  const { topCenter, linked, idA, idB } = entry;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle(idA, idB);
      }}
      className={`absolute flex items-center justify-center transition-colors ${
        disabled
          ? 'cursor-not-allowed text-gray-400 dark:text-gray-600'
          : linked
            ? 'cursor-pointer text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300'
            : 'cursor-pointer text-gray-400 hover:text-blue-500 dark:text-gray-500 dark:hover:text-blue-400'
      }`}
      style={{
        left: '50%',
        top: `${topCenter - LINK_CIRCLE_SIZE / 2}px`,
        width: `${LINK_CIRCLE_SIZE}px`,
        height: `${LINK_CIRCLE_SIZE}px`,
        zIndex: 3,
        transform: `translateX(-50%)${translateY ? ` translateY(${translateY}px)` : ''}`,
        // Background-colored contour around the icon for contrast against
        // the card surface it overlaps. Stacked drop-shadows thicken the
        // halo because a single pass is too faint.
        filter: LINK_CONTOUR_FILTER,
      }}
      aria-label={linked ? 'Break tied ranking' : 'Tie these rankings together'}
      title={linked ? 'Break tied ranking' : 'Tie these rankings together'}
    >
      <LinkIcon />
    </button>
  );
}
