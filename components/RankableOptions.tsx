"use client";

import { useState, useRef, useEffect, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { ClientOnlyDragDrop } from './ClientOnly';
import type { OptionsMetadata } from '@/lib/types';
import OptionLabel, { isLocationEntry } from './OptionLabel';

interface RankableOption {
  id: string;
  text: string;
  top: number;
}

interface RankableOptionsProps {
  options: string[];
  /**
   * Called when the user's ranking changes.
   * - rankedOptions: flat ordering (top-to-bottom) from the main list
   * - tiers: tiered ordering respecting equal-rank groupings
   *          (e.g. [["A"], ["B", "C"], ["D"]])
   */
  onRankingChange: (rankedOptions: string[], tiers: string[][]) => void;
  disabled?: boolean;
  storageKey?: string; // Optional key for localStorage persistence
  initialRanking?: string[]; // Optional initial ranking to override saved state
  initialTiers?: string[][]; // Optional initial tiers (for edit mode)
  optionsMetadata?: OptionsMetadata | null;
  renderOption?: (option: string) => React.ReactNode;
  preserveOrder?: boolean; // Skip initial shuffle (use for time slots, which have a natural order)
  /** Disable the equal-ranking link UI (e.g. for time slot polls) */
  disableGrouping?: boolean;
}

/**
 * Canonical key for a pair of item ids, order-independent. Used so that
 * linked-pair membership survives when a linked-group is reordered end-to-end.
 */
export const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Compute tier boundaries from a flat list + set of linked pairs.
 * Returns an array of tiers, where each tier is a list of indices into the
 * main list that belong to that tier.
 */
export function computeTierIndices(
  list: readonly { id: string }[],
  linkedPairs: ReadonlySet<string>,
): number[][] {
  if (list.length === 0) return [];
  const tiers: number[][] = [[0]];
  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1];
    const curr = list[i];
    if (linkedPairs.has(pairKey(prev.id, curr.id))) {
      tiers[tiers.length - 1].push(i);
    } else {
      tiers.push([i]);
    }
  }
  return tiers;
}

/** Convert tier index ranges into the `[["A"], ["B","C"], ...]` shape. */
export function tiersFromList(
  list: readonly { id: string; text: string }[],
  linkedPairs: ReadonlySet<string>,
): string[][] {
  return computeTierIndices(list, linkedPairs).map(tier =>
    tier.map(i => list[i].text),
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
const LINK_CIRCLE_SIZE = 24; // diameter in px (15% smaller than previous 28)
const LINK_ICON_SIZE = 15;   // chain glyph in px (15% smaller than previous 18)
// Horizontal offset of the circle's left edge from the cards container's
// left edge. A small positive offset keeps the circle fully inside the
// cards, just to the right of their left edge.
const LINK_CIRCLE_LEFT_OFFSET = 1;

function LinkCircle({
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
      className={`absolute rounded-full flex items-center justify-center border bg-white dark:bg-gray-900 shadow-sm transition-colors ${
        disabled
          ? 'cursor-not-allowed border-gray-200 text-gray-400 dark:border-gray-700 dark:text-gray-600'
          : linked
            ? 'cursor-pointer border-gray-300 text-blue-600 hover:border-blue-400 dark:border-gray-600 dark:text-blue-400 dark:hover:border-blue-500'
            : 'cursor-pointer border-gray-300 text-gray-400 hover:border-blue-400 hover:text-blue-500 dark:border-gray-600 dark:text-gray-500 dark:hover:border-blue-500 dark:hover:text-blue-400'
      }`}
      style={{
        left: `${LINK_CIRCLE_LEFT_OFFSET}px`,
        top: `${topCenter - LINK_CIRCLE_SIZE / 2}px`,
        width: `${LINK_CIRCLE_SIZE}px`,
        height: `${LINK_CIRCLE_SIZE}px`,
        zIndex: 3,
        transform: translateY ? `translateY(${translateY}px)` : undefined,
      }}
      aria-label={linked ? 'Break tied ranking' : 'Tie these rankings together'}
      title={linked ? 'Break tied ranking' : 'Tie these rankings together'}
    >
      <svg
        width={LINK_ICON_SIZE}
        height={LINK_ICON_SIZE}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    </button>
  );
}

/**
 * Return `[tierStart, tierSize]` for the tier containing `index` in the
 * given list + links. A tier is a maximal run of consecutive items connected
 * by linked pairs. An untied item returns `[index, 1]`.
 */
export function getTierRange(
  list: readonly { id: string }[],
  linkedPairs: ReadonlySet<string>,
  index: number,
): [number, number] {
  if (index < 0 || index >= list.length) return [index, 1];
  // Walk backward while the previous pair is linked
  let start = index;
  while (start > 0 && linkedPairs.has(pairKey(list[start - 1].id, list[start].id))) {
    start--;
  }
  // Walk forward while the next pair is linked
  let end = index;
  while (end < list.length - 1 && linkedPairs.has(pairKey(list[end].id, list[end + 1].id))) {
    end++;
  }
  return [start, end - start + 1];
}

/**
 * Compute standard-competition ranks for a tiered ballot (1, 2, 2, 4).
 * Returns one integer per tier: the display rank for that tier.
 */
export function tierRanks(tiers: readonly (readonly unknown[])[]): number[] {
  const ranks: number[] = [];
  let pos = 0;
  for (const tier of tiers) {
    ranks.push(pos + 1);
    pos += tier.length;
  }
  return ranks;
}

export default function RankableOptions({ options, onRankingChange, disabled = false, storageKey, initialRanking, initialTiers, optionsMetadata, renderOption, preserveOrder = false, disableGrouping = false }: RankableOptionsProps) {

  // Load saved state from localStorage
  const loadSavedState = useCallback(() => {
    if (!storageKey || typeof window === 'undefined') return null;

    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Validate that saved options match current options
        const allSavedTexts = [...parsed.mainList, ...parsed.noPreferenceList].map((opt: RankableOption) => opt.text).sort();
        const currentTexts = [...options].sort();

        if (allSavedTexts.length === currentTexts.length &&
            allSavedTexts.every((text: string, index: number) => text === currentTexts[index])) {
          return parsed;
        }
      }
    } catch (e) {
      console.error('Failed to load saved ranking state:', e);
    }
    return null;
  }, [storageKey, options]);

  // Save state to localStorage
  const saveState = useCallback((mainList: RankableOption[], noPreferenceList: RankableOption[], linkedPairs: Set<string>) => {
    if (!storageKey || typeof window === 'undefined') return;

    try {
      localStorage.setItem(storageKey, JSON.stringify({
        mainList,
        noPreferenceList,
        linkedPairs: Array.from(linkedPairs),
        timestamp: Date.now()
      }));
    } catch (e) {
      console.error('Failed to save ranking state:', e);
    }
  }, [storageKey]);

  // Shuffle array using Fisher-Yates algorithm for fair randomization
  const shuffleArray = useCallback(<T,>(array: T[]): T[] => {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }, []);

  // Create ranked options from props
  const createRankedOptions = useCallback((optionTexts: string[]) => {
    return optionTexts.map((text, index) => ({
      id: `option-${index}`,
      text,
      top: 0 // Will be set by updateItemPositions
    }));
  }, []);

  // State management - separate lists for main ranking and no preference
  const [mainList, setMainList] = useState<RankableOption[]>([]);
  const [noPreferenceList, setNoPreferenceList] = useState<RankableOption[]>([]);
  // Linked pairs for equal/tied ranking. Keys are canonical pairKey(id1, id2)
  // strings. Two main-list items at adjacent visual positions are considered
  // grouped (tied) if their pair is in this set.
  const [linkedPairs, setLinkedPairs] = useState<Set<string>>(() => new Set());
  const [dragState, setDragState] = useState({
    isDragging: false,
    draggedId: null as string | null,
    dragStartIndex: null as number | null,
    // For main-list drags, the tier (group of tied items) the dragged item
    // belongs to. A singleton tier is just the item itself. Tied items move
    // together during the drag.
    tierStart: null as number | null,   // Index of the first item in the tier
    tierSize: 1,                          // Number of items in the tier (1 = untied)
    targetIndex: null as number | null,
    sourceList: null as 'main' | 'noPreference' | null,
    targetList: null as 'main' | 'noPreference' | null,
    mouseOffset: { x: 0, y: 0 },
    mousePosition: { x: 0, y: 0 }
  });

  // Dynamic container heights for drag preview
  const [containerHeights, setContainerHeights] = useState({
    main: 0,
    noPreference: 0
  });

  // Configuration — taller items for location entries (two-line layout)
  const hasLocationOptions = optionsMetadata && Object.values(optionsMetadata).some(m => isLocationEntry(m));
  const itemHeight = hasLocationOptions ? 72 : 56;
  const gapSize = 8;
  const totalItemHeight = itemHeight + gapSize;

  // DOM Refs
  const mainContainerRef = useRef<HTMLDivElement>(null);
  const noPreferenceContainerRef = useRef<HTMLDivElement>(null);
  const elementRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Pending drag ref: tracks pointer-down state before drag actually starts.
  // Drag only starts after the pointer moves >8px — taps never enter drag state.
  const pendingDragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    started: boolean; // true once movement threshold exceeded and startDrag called
  } | null>(null);

  // Update positions of all items based on current order
  const updateItemPositions = useCallback((itemList: RankableOption[]) => {
    return itemList.map((item, index) => ({
      ...item,
      top: index * totalItemHeight
    }));
  }, [totalItemHeight]);

  // Determine which index a specific Y coordinate falls into for a given list
  const getIndexFromY = useCallback((y: number, listLength: number, allowAppend: boolean = false) => {
    const index = Math.floor(y / totalItemHeight);
    // For empty lists, allow insertion at index 0
    if (listLength === 0) return 0;
    
    // If allowAppend is true, allow insertion at the end (listLength position)
    const maxIndex = allowAppend ? listLength : listLength - 1;
    return Math.max(0, Math.min(maxIndex, index));
  }, [totalItemHeight]);

  // Determine which list and index a screen coordinate falls into
  const getDropTarget = useCallback((screenX: number, screenY: number) => {
    const mainContainer = mainContainerRef.current;
    const noPreferenceContainer = noPreferenceContainerRef.current;
    
    // Buffer zone to make drop areas more responsive near the divider
    const dropZoneBuffer = 30; // pixels to extend drop zones toward divider
    
    if (mainContainer) {
      const mainRect = mainContainer.getBoundingClientRect();
      // Extend main list drop zone downward (toward divider) when dragging from no preference
      const extendedBottom = dragState.sourceList === 'noPreference' ? mainRect.bottom + dropZoneBuffer : mainRect.bottom;
      
      if (screenX >= mainRect.left && screenX <= mainRect.right && 
          screenY >= mainRect.top && screenY <= extendedBottom) {
        const relativeY = screenY - mainRect.top;
        // Allow appending to main list when dragging from noPreference list
        const allowAppend = dragState.sourceList === 'noPreference';
        const index = getIndexFromY(relativeY, mainList.length, allowAppend);
        return { list: 'main' as const, index };
      }
    }
    
    if (noPreferenceContainer) {
      const noPreferenceRect = noPreferenceContainer.getBoundingClientRect();
      // Extend no preference list drop zone upward (toward divider) when dragging from main
      const extendedTop = dragState.sourceList === 'main' ? noPreferenceRect.top - dropZoneBuffer : noPreferenceRect.top;
      
      if (screenX >= noPreferenceRect.left && screenX <= noPreferenceRect.right && 
          screenY >= extendedTop && screenY <= noPreferenceRect.bottom) {
        const relativeY = screenY - noPreferenceRect.top;
        // Allow appending to noPreference list when dragging from main list
        const allowAppend = dragState.sourceList === 'main';
        const index = getIndexFromY(relativeY, noPreferenceList.length, allowAppend);
        return { list: 'noPreference' as const, index };
      }
    }
    
    return null;
  }, [getIndexFromY, mainList.length, noPreferenceList.length, dragState.sourceList]);

  /**
   * Toggle the "linked" (equal-rank) state between two adjacent main-list items.
   * This is the click handler for the chain/broken-chain icons rendered in
   * the rank-number column between items.
   */
  const toggleLinkBetween = useCallback((id1: string, id2: string) => {
    if (disabled || disableGrouping) return;
    setLinkedPairs(prev => {
      const key = pairKey(id1, id2);
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, [disabled, disableGrouping]);

  /**
   * When a main-list item is moved out of the main list (to noPreference),
   * its grouping no longer makes sense — remove any linkedPairs entries that
   * reference it. Leaves other groupings intact.
   */
  const dropLinkedPairsFor = useCallback((itemId: string) => {
    setLinkedPairs(prev => {
      const next = new Set<string>();
      let changed = false;
      for (const key of prev) {
        const [a, b] = key.split('|');
        if (a === itemId || b === itemId) {
          changed = true;
          continue;
        }
        next.add(key);
      }
      return changed ? next : prev;
    });
  }, []);

  /**
   * When an item is reordered within the main list (drag or tap-to-move), its
   * previous adjacencies no longer make sense. Drop any link entries that
   * involved this item so the user's new ordering starts ungrouped with
   * respect to its neighbors. Other groupings are preserved.
   */
  const clearLinksTouchingItem = useCallback((itemId: string) => {
    dropLinkedPairsFor(itemId);
  }, [dropLinkedPairsFor]);

  // Start dragging an item (called after pointer has moved beyond threshold)
  const startDrag = useCallback((clientX: number, clientY: number, id: string) => {
    if (disabled || dragState.isDragging) return;

    // Find the item in either list
    let itemIndex = mainList.findIndex(item => item.id === id);
    let sourceList: 'main' | 'noPreference' = 'main';

    if (itemIndex === -1) {
      itemIndex = noPreferenceList.findIndex(item => item.id === id);
      sourceList = 'noPreference';
      if (itemIndex === -1) return;
    }

    const element = elementRefs.current[id];
    if (!element) return;

    const rect = element.getBoundingClientRect();

    // For main-list drags, compute the tier (group of tied items) so they
    // can move together as one unit. No-preference items never have tiers.
    const [tierStart, tierSize] = sourceList === 'main'
      ? getTierRange(mainList, linkedPairs, itemIndex)
      : [itemIndex, 1];

    // Store drag state
    setDragState({
      isDragging: true,
      draggedId: id,
      dragStartIndex: itemIndex,
      tierStart,
      tierSize,
      targetIndex: itemIndex,
      sourceList,
      targetList: sourceList,
      mouseOffset: {
        x: clientX - rect.left,
        y: clientY - rect.top
      },
      mousePosition: { x: clientX, y: clientY }
    });
  }, [disabled, dragState.isDragging, mainList, noPreferenceList, linkedPairs]);

  // Handle drag movement
  const handleDragMove = useCallback((e: PointerEvent) => {
    if (!dragState.isDragging) return;

    e.preventDefault();
    const coords = { x: e.clientX, y: e.clientY };
    const dropTarget = getDropTarget(coords.x, coords.y);

    let newTargetList = dragState.targetList;
    let newTargetIndex = dragState.targetIndex;

    if (dropTarget) {
      newTargetList = dropTarget.list;
      newTargetIndex = dropTarget.index;
    }

    // Update drag state if anything changed
    if (newTargetList !== dragState.targetList || newTargetIndex !== dragState.targetIndex || 
        coords.x !== dragState.mousePosition.x || coords.y !== dragState.mousePosition.y) {
      
      requestAnimationFrame(() => {
        setDragState(prev => ({
          ...prev,
          mousePosition: coords,
          targetList: newTargetList,
          targetIndex: newTargetIndex
        }));

        // Update visual feedback for both lists
        if (newTargetList !== dragState.targetList || newTargetIndex !== dragState.targetIndex) {
          const sourceList = dragState.sourceList!;
          const startIndex = dragState.dragStartIndex!;
          // Main-list drags carry the whole tier (group of tied items) with
          // them. No-preference items never have tiers so tierSize is 1.
          const tierStart = dragState.tierStart ?? startIndex;
          const tierSize = dragState.tierSize;
          const tierEnd = tierStart + tierSize - 1;

          // Update main list positions
          setMainList(prev => {
            const updatedList = [...prev];
            updatedList.forEach((item, index) => {
              item.top = index * totalItemHeight;
            });

            // If dragging from main list and targeting main list.
            // The entire tier moves as one unit — shift intervening items
            // by tierSize positions so the tier can slot in.
            if (sourceList === 'main' && newTargetList === 'main' && newTargetIndex !== null) {
              // Clamp target to exclude slots inside the tier's current range
              // (those are no-ops) — anything in [tierStart+1..tierEnd] is
              // effectively a no-move.
              if (newTargetIndex > tierEnd) {
                // Tier moves DOWN. Items between tierEnd+1 and newTargetIndex
                // shift UP by tierSize.
                for (let i = tierEnd + 1; i <= newTargetIndex; i++) {
                  if (i < updatedList.length) {
                    updatedList[i].top = (i - tierSize) * totalItemHeight;
                  }
                }
              } else if (newTargetIndex < tierStart) {
                // Tier moves UP. Items in [newTargetIndex..tierStart-1]
                // shift DOWN by tierSize.
                for (let i = newTargetIndex; i < tierStart; i++) {
                  updatedList[i].top = (i + tierSize) * totalItemHeight;
                }
              }
            }
            // If dragging from main to no preference, the whole tier leaves
            // the main list — shift items after the tier up by tierSize.
            else if (sourceList === 'main' && newTargetList === 'noPreference') {
              for (let i = tierEnd + 1; i < updatedList.length; i++) {
                updatedList[i].top = (i - tierSize) * totalItemHeight;
              }
            }
            // If dragging from no preference to main, shift items down to make space
            else if (sourceList === 'noPreference' && newTargetList === 'main' && newTargetIndex !== null) {
              for (let i = newTargetIndex; i < updatedList.length; i++) {
                updatedList[i].top = (i + 1) * totalItemHeight;
              }
            }

            return updatedList;
          });

          // Update no preference list positions
          setNoPreferenceList(prev => {
            const updatedList = [...prev];
            updatedList.forEach((item, index) => {
              item.top = index * totalItemHeight;
            });

            // If dragging within no preference list (never tiered, so tierSize=1)
            if (sourceList === 'noPreference' && newTargetList === 'noPreference' && startIndex !== newTargetIndex && newTargetIndex !== null) {
              if (startIndex < newTargetIndex) {
                for (let i = startIndex + 1; i <= newTargetIndex; i++) {
                  updatedList[i].top = (i - 1) * totalItemHeight;
                }
              } else {
                for (let i = newTargetIndex; i < startIndex; i++) {
                  updatedList[i].top = (i + 1) * totalItemHeight;
                }
              }
            }
            // If dragging from no preference to main, shift items up to fill gap
            else if (sourceList === 'noPreference' && newTargetList === 'main') {
              for (let i = startIndex + 1; i < updatedList.length; i++) {
                updatedList[i].top = (i - 1) * totalItemHeight;
              }
            }
            // If dragging from main to no preference, shift items down to
            // make space for the full tier (all tied items move together).
            else if (sourceList === 'main' && newTargetList === 'noPreference' && newTargetIndex !== null) {
              for (let i = newTargetIndex; i < updatedList.length; i++) {
                updatedList[i].top = (i + tierSize) * totalItemHeight;
              }
            }

            return updatedList;
          });
        }
      });
    }
  }, [dragState, getDropTarget, totalItemHeight]);

  // Complete the drag operation
  const finishDrag = useCallback(() => {
    if (!dragState.isDragging) return;

    const { draggedId, dragStartIndex, tierStart, tierSize, targetIndex, sourceList, targetList } = dragState;

    if (draggedId && dragStartIndex !== null && targetIndex !== null && sourceList && targetList) {
      // Find the dragged item
      const sourceListRef = sourceList === 'main' ? mainList : noPreferenceList;
      const draggedItem = sourceListRef.find(item => item.id === draggedId);

      if (draggedItem) {
        // Tier range (for main-list drags). For noPreference, always single.
        const effectiveTierStart = sourceList === 'main' && tierStart !== null ? tierStart : dragStartIndex;
        const effectiveTierSize = sourceList === 'main' ? tierSize : 1;
        const tierEnd = effectiveTierStart + effectiveTierSize - 1;

        // For intra-main drags, a target within (or just after) the tier
        // is a no-op (the tier stays put).
        const isNoOp =
          sourceList === targetList &&
          sourceList === 'main' &&
          targetIndex >= effectiveTierStart &&
          targetIndex <= tierEnd + 1;

        // Handle cross-list movement or reordering within the same list
        if (!isNoOp && (sourceList !== targetList || dragStartIndex !== targetIndex)) {
          // Handle cross-list movement with atomic state updates
          if (sourceList !== targetList) {
            // Moving between lists - update both lists atomically
            if (sourceList === 'main' && targetList === 'noPreference') {
              // Move the whole tier out of main into noPreference. The
              // tier's internal linked pairs are dropped since noPreference
              // items don't have tiers.
              const tierItems = mainList.slice(effectiveTierStart, effectiveTierStart + effectiveTierSize);
              setMainList(prev => {
                const newList = [...prev];
                newList.splice(effectiveTierStart, effectiveTierSize);
                return updateItemPositions(newList);
              });
              setNoPreferenceList(prev => {
                const newList = [...prev];
                newList.splice(targetIndex, 0, ...tierItems);
                return updateItemPositions(newList);
              });
              // Drop linked-pair entries for every tier member
              tierItems.forEach(it => dropLinkedPairsFor(it.id));
            } else if (sourceList === 'noPreference' && targetList === 'main') {
              // Remove from no preference list
              setNoPreferenceList(prev => {
                const newList = [...prev];
                newList.splice(dragStartIndex, 1);
                return updateItemPositions(newList);
              });
              // Add to main list
              setMainList(prev => {
                const newList = [...prev];
                newList.splice(targetIndex, 0, draggedItem);
                return updateItemPositions(newList);
              });
            }
          } else {
            // Reordering within the same list
            if (sourceList === 'main') {
              // Move the whole tier as one unit. Adjust target index to
              // account for the items being spliced out.
              const adjustedTarget =
                targetIndex <= effectiveTierStart
                  ? targetIndex
                  : targetIndex - effectiveTierSize;
              setMainList(prev => {
                const newList = [...prev];
                const tierItems = newList.splice(effectiveTierStart, effectiveTierSize);
                newList.splice(adjustedTarget, 0, ...tierItems);
                return updateItemPositions(newList);
              });
              // The tier's internal links are preserved (the items remain
              // adjacent after the splice). Links touching the tier from
              // *outside* (there should be none by definition of a tier,
              // but belt-and-suspenders) are not affected.
            } else {
              setNoPreferenceList(prev => {
                const newList = [...prev];
                const [movedItem] = newList.splice(dragStartIndex, 1);
                newList.splice(targetIndex, 0, movedItem);
                return updateItemPositions(newList);
              });
            }
          }

          // Parent notification will be handled by useEffect
        } else {
          // Reset positions if no actual move
          setMainList(prev => updateItemPositions(prev));
          setNoPreferenceList(prev => updateItemPositions(prev));
        }
      }
    }

    // Reset drag state
    setDragState({
      isDragging: false,
      draggedId: null,
      dragStartIndex: null,
      tierStart: null,
      tierSize: 1,
      targetIndex: null,
      sourceList: null,
      targetList: null,
      mouseOffset: { x: 0, y: 0 },
      mousePosition: { x: 0, y: 0 }
    });
  }, [dragState, mainList, noPreferenceList, updateItemPositions, dropLinkedPairsFor]);

  // Set up event listeners
  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      // Check for pending drag that hasn't started yet
      const pending = pendingDragRef.current;
      if (pending && !pending.started) {
        const dx = Math.abs(e.clientX - pending.startX);
        const dy = Math.abs(e.clientY - pending.startY);
        if (dx > 8 || dy > 8) {
          // Movement exceeded threshold — start the actual drag
          pending.started = true;
          startDrag(pending.startX, pending.startY, pending.id);
        }
        return; // Don't process as drag move until next event after startDrag re-renders
      }

      if (dragState.isDragging) {
        handleDragMove(e);
      }
    };

    const handleEnd = () => {
      if (dragState.isDragging) {
        finishDrag();
      }
      pendingDragRef.current = null;
    };

    // During active drag, completely freeze the page to prevent
    // SFSafariViewController's sheet dismiss gesture from firing.
    // The sheet's dismiss is triggered by overscroll at the top of the page,
    // so we lock the body in place and block all scroll/overscroll propagation.
    const handleTouchMove = (e: TouchEvent) => {
      if (dragState.isDragging) {
        e.preventDefault();
      }
    };

    let savedScrollY = 0;
    if (dragState.isDragging) {
      savedScrollY = window.scrollY;
      document.body.style.touchAction = 'none';
      document.body.style.position = 'fixed';
      document.body.style.top = `-${savedScrollY}px`;
      document.body.style.left = '0';
      document.body.style.right = '0';
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overscrollBehavior = 'none';
      document.addEventListener('touchmove', handleTouchMove, { passive: false });
    }

    // Add event listeners to document for better capture
    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleEnd);
    document.addEventListener('pointercancel', handleEnd);

    return () => {
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleEnd);
      document.removeEventListener('pointercancel', handleEnd);
      document.removeEventListener('touchmove', handleTouchMove);
      if (dragState.isDragging) {
        document.body.style.touchAction = '';
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.left = '';
        document.body.style.right = '';
        document.body.style.overflow = '';
        document.documentElement.style.overscrollBehavior = '';
        window.scrollTo(0, savedScrollY);
      }
    };
  }, [dragState.isDragging, handleDragMove, finishDrag, startDrag]);

  // Track if component has mounted
  const hasMountedRef = useRef(false);
  const previousOptionsRef = useRef<string[]>([]);
  
  // Notify parent component when the main list OR tier structure changes.
  // We send both the flat order AND the tiered structure; the backend IRV
  // algorithm prefers the tiered form when present.
  useEffect(() => {
    const flat = mainList.map(option => option.text);
    const tiers = tiersFromList(mainList, linkedPairs);
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
    }
    onRankingChange(flat, tiers);
  }, [mainList, linkedPairs, onRankingChange]);

  // Track previous initialRanking to detect changes
  const previousInitialRankingRef = useRef<string[] | undefined>(undefined);

  // Initialize positions on mount and when options or initialRanking change
  useEffect(() => {
    // Check if options have actually changed
    const optionsChanged =
      previousOptionsRef.current.length !== options.length ||
      !previousOptionsRef.current.every((opt, index) => opt === options[index]);

    // Check if initialRanking has changed
    const initialRankingChanged =
      previousInitialRankingRef.current !== initialRanking &&
      JSON.stringify(previousInitialRankingRef.current) !== JSON.stringify(initialRanking);

    if (optionsChanged || initialRankingChanged) {
      // Check if we have an initial ranking provided (e.g., for edit mode)
      if (initialRanking && initialRanking.length > 0) {
        // Use the provided initial ranking
        const rankedOptions = initialRanking.map((text, index) => ({
          id: `option-${options.indexOf(text)}`, // Use consistent ID based on original option order
          text: text,
          top: index * totalItemHeight
        }));

        // Put any remaining options (not in initialRanking) into no preference
        const remainingOptions = options.filter(opt => !initialRanking.includes(opt));
        const noPreferenceOptions = remainingOptions.map((text, index) => ({
          id: `option-${options.indexOf(text)}`, // Use consistent ID based on original option order
          text: text,
          top: index * totalItemHeight
        }));

        setMainList(rankedOptions);
        setNoPreferenceList(noPreferenceOptions);

        // If tiers were passed in (edit mode with existing tied rankings),
        // convert them to linkedPairs state. Tiers reference option texts,
        // so we map to the newly-created item IDs.
        if (initialTiers && initialTiers.length > 0) {
          const textToId = new Map<string, string>();
          rankedOptions.forEach(opt => textToId.set(opt.text, opt.id));
          const newLinked = new Set<string>();
          for (const tier of initialTiers) {
            if (tier.length < 2) continue;
            for (let i = 0; i < tier.length - 1; i++) {
              const id1 = textToId.get(tier[i]);
              const id2 = textToId.get(tier[i + 1]);
              if (id1 && id2) newLinked.add(pairKey(id1, id2));
            }
          }
          setLinkedPairs(newLinked);
        } else {
          setLinkedPairs(new Set());
        }
      } else {
        // Try to load saved state first
        const savedState = loadSavedState();

        if (savedState) {
          // Apply positions to saved state
          const positionedMainList = savedState.mainList.map((item: RankableOption, index: number) => ({
            ...item,
            top: index * totalItemHeight
          }));
          const positionedNoPreferenceList = savedState.noPreferenceList.map((item: RankableOption, index: number) => ({
            ...item,
            top: index * totalItemHeight
          }));

          setMainList(positionedMainList);
          setNoPreferenceList(positionedNoPreferenceList);
          // Restore linked pairs if the saved state has them (older saved
          // states just don't have the field — default to empty).
          setLinkedPairs(
            new Set(Array.isArray(savedState.linkedPairs) ? savedState.linkedPairs : []),
          );
        } else {
          // Initialize with randomized order to prevent position bias,
          // unless preserveOrder is set (e.g. time slots have a natural chronological order).
          const orderedOptions = preserveOrder ? options : shuffleArray(options);
          const newRankedOptions = orderedOptions.map((text, index) => ({
            id: `option-${index}`,
            text: text,
            top: index * totalItemHeight
          }));
          setMainList(newRankedOptions);
          setNoPreferenceList([]);
          setLinkedPairs(new Set());
        }
      }

      previousOptionsRef.current = options;
      previousInitialRankingRef.current = initialRanking;
    }
  }, [options, initialRanking, initialTiers, totalItemHeight, loadSavedState, shuffleArray, preserveOrder]);

  // Save state whenever lists or linked pairs change
  useEffect(() => {
    if (hasMountedRef.current && storageKey) {
      saveState(mainList, noPreferenceList, linkedPairs);
    }
  }, [mainList, noPreferenceList, linkedPairs, saveState, storageKey]);

  // Reset to random order (for testing/debugging)
  const resetToRandomOrder = useCallback(() => {
    if (storageKey) {
      localStorage.removeItem(storageKey);
    }
    const shuffledOptions = shuffleArray(options);
    const newRankedOptions = shuffledOptions.map((text, index) => ({
      id: `option-${index}`,
      text: text,
      top: index * totalItemHeight
    }));
    setMainList(newRankedOptions);
    setNoPreferenceList([]);
  }, [storageKey, options, shuffleArray, totalItemHeight]);

  // Expose reset function to window for testing
  useEffect(() => {
    if (typeof window !== 'undefined' && storageKey) {
      (window as any).resetPollRanking = resetToRandomOrder;
    }
    return () => {
      if (typeof window !== 'undefined') {
        delete (window as any).resetPollRanking;
      }
    };
  }, [resetToRandomOrder, storageKey]);

  // Get the dragged item
  const getDraggedOption = () => {
    if (!dragState.draggedId) return null;
    const mainItem = mainList.find(option => option.id === dragState.draggedId);
    if (mainItem) return mainItem;
    return noPreferenceList.find(option => option.id === dragState.draggedId) || null;
  };

  // Get the list of items currently being dragged. Includes all tier members
  // (for main-list drags of tied items) so they visually move together.
  const getDraggedItems = (): RankableOption[] => {
    if (!dragState.draggedId) return [];
    if (dragState.sourceList === 'main' && dragState.tierStart !== null && dragState.tierSize > 1) {
      return mainList.slice(dragState.tierStart, dragState.tierStart + dragState.tierSize);
    }
    const single = getDraggedOption();
    return single ? [single] : [];
  };

  // Render dragged item(s) — for tied tiers, stack all members together so
  // the whole group drags as a unit under the cursor. Internal tier links
  // render between stacked items so they visibly drag with the group.
  const renderDraggedItem = () => {
    const items = getDraggedItems();
    if (items.length === 0) return null;

    const { mousePosition, mouseOffset } = dragState;
    const x = mousePosition.x - mouseOffset.x;
    // Offset the stack so the grabbed item sits where the cursor is. The
    // grabbed item may not be the first tier member, so shift the stack up
    // by grabbedOffset rows.
    const grabbedIndex = items.findIndex(it => it.id === dragState.draggedId);
    const y = mousePosition.y - mouseOffset.y - Math.max(0, grabbedIndex) * totalItemHeight;
    const width = mainContainerRef.current ? mainContainerRef.current.offsetWidth : 300;
    const showInternalLinks = items.length > 1 && dragState.sourceList === 'main';

    return (
      <div
        style={{
          position: 'fixed',
          left: `${x}px`,
          top: `${y}px`,
          width: `${width}px`,
          zIndex: 1000,
          pointerEvents: 'none',
          transform: 'scale(1.02)',
          filter: 'drop-shadow(0 8px 25px rgba(0,0,0,0.3))',
          overflow: 'visible',
        }}
      >
        {items.map((item, i) => (
          <div
            key={item.id}
            className="bg-blue-100 dark:bg-blue-900 border border-blue-300 dark:border-blue-600 rounded-md p-3 select-none relative"
            style={{
              height: `${itemHeight}px`,
              marginTop: i === 0 ? 0 : `${gapSize}px`,
            }}
          >
            <div className="flex items-center justify-between h-full">
              <div className="flex items-center min-w-0 flex-1 text-gray-900 dark:text-white">
                {renderOption ? renderOption(item.text) : <OptionLabel text={item.text} metadata={optionsMetadata?.[item.text]} className="min-w-0 overflow-hidden" />}
              </div>
              <div className="flex flex-col items-center justify-center ml-2 text-gray-500">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="18 15 12 9 6 15" />
                </svg>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>
            </div>
          </div>
        ))}
        {/* Internal tier links between the stacked items — same styling as
            the stationary link circles, positioned at the gap midpoints. */}
        {showInternalLinks && items.slice(0, -1).map((item, i) => {
          const topCenter = (i + 1) * totalItemHeight - gapSize / 2;
          return (
            <div
              key={`preview-link-${item.id}`}
              className="absolute flex items-center justify-center rounded-full border border-gray-300 bg-white text-blue-600 shadow-sm dark:border-gray-600 dark:bg-gray-900 dark:text-blue-400"
              style={{
                left: `${LINK_CIRCLE_LEFT_OFFSET}px`,
                top: `${topCenter - LINK_CIRCLE_SIZE / 2}px`,
                width: `${LINK_CIRCLE_SIZE}px`,
                height: `${LINK_CIRCLE_SIZE}px`,
              }}
            >
              <svg
                width={LINK_ICON_SIZE}
                height={LINK_ICON_SIZE}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.25"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </div>
          );
        })}
      </div>
    );
  };

  // Keyboard navigation state
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
  const [keyboardMode, setKeyboardMode] = useState(false);

  // Calculate dynamic container heights based on drag state
  const calculateContainerHeights = useCallback(() => {
    const baseMainHeight = Math.max(mainList.length * totalItemHeight - gapSize, totalItemHeight);
    const baseNoPreferenceHeight = Math.max(noPreferenceList.length * totalItemHeight - gapSize, totalItemHeight);

    // If not dragging, return normal heights
    if (!dragState.isDragging || !dragState.sourceList) {
      return {
        main: baseMainHeight,
        noPreference: baseNoPreferenceHeight
      };
    }

    // Only apply height changes when dragging between different lists.
    // For main→noPreference drags of a tied tier, `dragState.tierSize`
    // tells us how many items are moving together.
    if (dragState.targetList && dragState.sourceList !== dragState.targetList) {
      const tierSize = dragState.sourceList === 'main' ? dragState.tierSize : 1;
      let newMainHeight = baseMainHeight;
      let newNoPreferenceHeight = baseNoPreferenceHeight;

      if (dragState.sourceList === 'main' && dragState.targetList === 'noPreference') {
        // Dragging from main to no preference - DON'T shrink main (keep stable), but grow no preference
        newMainHeight = baseMainHeight; // Keep main list at original size during preview
        newNoPreferenceHeight = Math.max((noPreferenceList.length + tierSize) * totalItemHeight - gapSize, totalItemHeight);
      } else if (dragState.sourceList === 'noPreference' && dragState.targetList === 'main') {
        // Dragging from no preference to main - grow main, shrink no preference (real-time feedback)
        newMainHeight = Math.max((mainList.length + 1) * totalItemHeight - gapSize, totalItemHeight);
        newNoPreferenceHeight = Math.max((noPreferenceList.length - 1) * totalItemHeight - gapSize, totalItemHeight);
      }

      return {
        main: newMainHeight,
        noPreference: newNoPreferenceHeight
      };
    }

    // Same-list drag or no target yet: heights don't change
    return {
      main: baseMainHeight,
      noPreference: baseNoPreferenceHeight
    };
  }, [mainList.length, noPreferenceList.length, dragState, totalItemHeight, gapSize]);

  // Update container heights when drag state or lists change
  useEffect(() => {
    const newHeights = calculateContainerHeights();
    setContainerHeights(newHeights);
  }, [calculateContainerHeights]);

  // Initialize container heights when component mounts or lists are first populated
  useEffect(() => {
    if ((mainList.length > 0 || noPreferenceList.length >= 0) && 
        (containerHeights.main === 0 || containerHeights.noPreference === 0)) {
      const initialHeights = calculateContainerHeights();
      setContainerHeights(initialHeights);
    }
  }, [mainList.length, noPreferenceList.length, containerHeights, calculateContainerHeights]);

  const handlePointerStart = useCallback((e: React.PointerEvent, id: string) => {
    if (disabled) return;

    e.preventDefault();
    e.stopPropagation();
    // Capture the pointer to this element — routes all subsequent pointer events
    // here and prevents the hosting view (e.g. SFSafariViewController sheet)
    // from intercepting the touch as a dismiss gesture.
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    // Only record intent — actual drag starts after pointer moves >8px
    pendingDragRef.current = {
      id,
      startX: e.clientX,
      startY: e.clientY,
      started: false
    };
  }, [disabled]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent, id: string) => {
    if (disabled) return;

    const allItems = [...mainList, ...noPreferenceList];
    const currentIndex = allItems.findIndex(item => item.id === id);
    
    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault();
        setKeyboardMode(true);
        setFocusedItemId(id);
        break;
        
      case 'Escape':
        e.preventDefault();
        setKeyboardMode(false);
        setFocusedItemId(null);
        break;
        
      case 'ArrowUp':
        e.preventDefault();
        if (keyboardMode && focusedItemId === id) {
          // Move item up in its current list
          const sourceList = mainList.find(item => item.id === id) ? 'main' : 'noPreference';
          if (sourceList === 'main') {
            const mainIndex = mainList.findIndex(item => item.id === id);
            if (mainIndex > 0) {
              moveItemInList('main', mainIndex, mainIndex - 1);
            }
          } else {
            const noPreferenceIndex = noPreferenceList.findIndex(item => item.id === id);
            if (noPreferenceIndex > 0) {
              moveItemInList('noPreference', noPreferenceIndex, noPreferenceIndex - 1);
            }
          }
        } else {
          // Navigate between items
          if (currentIndex > 0) {
            const nextItem = allItems[currentIndex - 1];
            const element = elementRefs.current[nextItem.id];
            element?.focus();
          }
        }
        break;
        
      case 'ArrowDown':
        e.preventDefault();
        if (keyboardMode && focusedItemId === id) {
          // Move item down in its current list
          const sourceList = mainList.find(item => item.id === id) ? 'main' : 'noPreference';
          if (sourceList === 'main') {
            const mainIndex = mainList.findIndex(item => item.id === id);
            if (mainIndex < mainList.length - 1) {
              moveItemInList('main', mainIndex, mainIndex + 1);
            }
          } else {
            const noPreferenceIndex = noPreferenceList.findIndex(item => item.id === id);
            if (noPreferenceIndex < noPreferenceList.length - 1) {
              moveItemInList('noPreference', noPreferenceIndex, noPreferenceIndex + 1);
            }
          }
        } else {
          // Navigate between items
          if (currentIndex < allItems.length - 1) {
            const nextItem = allItems[currentIndex + 1];
            const element = elementRefs.current[nextItem.id];
            element?.focus();
          }
        }
        break;
        
      case 'ArrowLeft':
        e.preventDefault();
        if (keyboardMode && focusedItemId === id) {
          // Move from no preference to main
          const noPreferenceIndex = noPreferenceList.findIndex(item => item.id === id);
          if (noPreferenceIndex !== -1) {
            moveItemBetweenLists(id, 'noPreference', noPreferenceIndex, 'main', mainList.length);
          }
        }
        break;
        
      case 'ArrowRight':
        e.preventDefault();
        if (keyboardMode && focusedItemId === id) {
          // Move from main to no preference
          const mainIndex = mainList.findIndex(item => item.id === id);
          if (mainIndex !== -1) {
            moveItemBetweenLists(id, 'main', mainIndex, 'noPreference', noPreferenceList.length);
          }
        }
        break;
    }
  }, [disabled, mainList, noPreferenceList, keyboardMode, focusedItemId]); // eslint-disable-line react-hooks/exhaustive-deps

  // FLIP animation helper: records positions, applies state change, then animates
  const animateWithFLIP = useCallback((callback: () => void) => {
    // FIRST: Record current DOM positions of all items
    const oldPositions: Record<string, number> = {};
    for (const [id, el] of Object.entries(elementRefs.current)) {
      if (el) {
        oldPositions[id] = el.getBoundingClientRect().top;
      }
    }

    // LAST: Apply the state change synchronously
    flushSync(callback);

    // INVERT + PLAY: Calculate deltas and animate
    for (const [id, el] of Object.entries(elementRefs.current)) {
      if (el && oldPositions[id] !== undefined) {
        const newPos = el.getBoundingClientRect().top;
        const delta = oldPositions[id] - newPos;
        if (Math.abs(delta) > 1) {
          // INVERT: Snap to old position via transform
          el.style.transition = 'none';
          el.style.transform = `translateY(${delta}px)`;

          // Force reflow so the browser registers the old position
          el.offsetHeight; // eslint-disable-line @typescript-eslint/no-unused-expressions

          // PLAY: Animate to new position
          el.style.transition = 'transform 0.3s ease';
          el.style.transform = '';
        }
      }
    }
  }, []);

  // Helper function to move items within the same list (with FLIP animation)
  const moveItemInList = useCallback((listType: 'main' | 'noPreference', fromIndex: number, toIndex: number) => {
    const setter = listType === 'main' ? setMainList : setNoPreferenceList;
    // Capture the moved item id BEFORE we run state updates so we can drop
    // any stale linked pairs that referenced it at its old position.
    const currentList = listType === 'main' ? mainList : noPreferenceList;
    const movedId = currentList[fromIndex]?.id;

    animateWithFLIP(() => {
      setter(prev => {
        const newList = [...prev];
        const [item] = newList.splice(fromIndex, 1);
        newList.splice(toIndex, 0, item);
        return updateItemPositions(newList);
      });
    });
    if (listType === 'main' && movedId) {
      clearLinksTouchingItem(movedId);
    }
  }, [updateItemPositions, animateWithFLIP, mainList, noPreferenceList, clearLinksTouchingItem]);

  // Helper function to move items between lists (with FLIP animation)
  const moveItemBetweenLists = useCallback((
    itemId: string,
    sourceList: 'main' | 'noPreference',
    sourceIndex: number,
    targetList: 'main' | 'noPreference',
    targetIndex: number
  ) => {
    const sourceListRef = sourceList === 'main' ? mainList : noPreferenceList;
    const item = sourceListRef[sourceIndex];

    if (!item) return;

    const sourceSetter = sourceList === 'main' ? setMainList : setNoPreferenceList;
    const targetSetter = targetList === 'main' ? setMainList : setNoPreferenceList;

    animateWithFLIP(() => {
      sourceSetter(prev => {
        const newList = [...prev];
        newList.splice(sourceIndex, 1);
        return updateItemPositions(newList);
      });
      targetSetter(prev => {
        const newList = [...prev];
        newList.splice(targetIndex, 0, item);
        return updateItemPositions(newList);
      });
    });
    // If the item left the main list entirely, drop any tied-rank entries
    // that involved it. If it's being moved INTO main from noPreference,
    // there are no pre-existing links to worry about.
    if (sourceList === 'main' && targetList !== 'main') {
      dropLinkedPairsFor(item.id);
    }
  }, [mainList, noPreferenceList, updateItemPositions, animateWithFLIP, dropLinkedPairsFor]);

  // Render a single list container (main or no preference)
  const renderListContainer = (
    listItems: RankableOption[],
    containerRef: React.RefObject<HTMLDivElement | null>,
    listType: 'main' | 'noPreference',
    title?: string,
    description?: string
  ) => {
    // Use dynamic height from state with smooth transitions
    const dynamicHeight = containerHeights[listType];
    
    // Calculate how many number slots to show (account for items being dragged in from other list)
    const numberSlotCount = listType === 'main'
      ? (dragState.isDragging && dragState.sourceList === 'noPreference' && dragState.targetList === 'main'
          ? listItems.length + 1
          : listItems.length)
      : 0;

    return (
      <div className={listType === 'main' ? 'mb-4' : ''}>
        {title && (
          <div className="mb-2">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {title}
            </h3>
            {description && (
              <p className="text-xs text-gray-500 dark:text-gray-400" id={`${listType}-description`}>
                {description}
              </p>
            )}
          </div>
        )}

        <div className="flex">
          {/* Rank number column — only for main list.
              Renders one rank number per tier, vertically centered on the
              tier's items, using standard competition ranking (1, 2, 2, 4).
              Link circles live in the cards container below, so they can
              overlap the left edge of the cards. */}
          {listType === 'main' && numberSlotCount > 0 && (() => {
            const effectiveMainList = mainList;
            const tiers = computeTierIndices(effectiveMainList, linkedPairs);
            // Add the extra slot as its own singleton tier if needed
            if (numberSlotCount > effectiveMainList.length) {
              tiers.push([effectiveMainList.length]);
            }
            // Build rank number entries with standard competition ranking
            const rankEntries: { rank: number; top: number; height: number; key: string }[] = [];
            let positionsSoFar = 0;
            tiers.forEach((tier, tierIdx) => {
              const startIdx = tier[0];
              const size = tier.length;
              const rank = positionsSoFar + 1;
              const top = startIdx * totalItemHeight;
              const height = size * itemHeight + (size - 1) * gapSize;
              rankEntries.push({
                rank,
                top,
                height,
                key: `rank-${tierIdx}-${startIdx}`,
              });
              positionsSoFar += size;
            });
            return (
              <div
                className="flex-shrink-0 relative"
                style={{ width: '32px', height: `${dynamicHeight}px`, minHeight: `${totalItemHeight}px` }}
              >
                {rankEntries.map(entry => (
                  <div
                    key={entry.key}
                    className="absolute left-0 right-0 flex items-center justify-center pointer-events-none"
                    style={{ top: `${entry.top}px`, height: `${entry.height}px` }}
                  >
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-sm font-medium ${
                      disabled
                        ? 'bg-gray-300 text-gray-500 dark:bg-gray-600 dark:text-gray-400'
                        : 'bg-blue-600 text-white'
                    }`}>
                      {entry.rank}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}

          <div
            ref={containerRef}
            className={`flex-1 p-3 relative transition-all duration-200 ease-out ${
              listItems.length === 0
                ? 'border-2 border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 rounded-lg'
                : ''
            }`}
            style={{
              height: `${dynamicHeight}px`,
              minHeight: `${totalItemHeight}px`,
              // Link circles overflow the container's left edge so they
              // can overlap the corners of the option cards.
              overflow: 'visible',
            }}
            role="listbox"
            aria-label={listType === 'main' ? 'Ranked choice options' : 'No preference options'}
            aria-describedby={`${listType}-description`}
          >
            {/* Link circles — for main list only. Rendered inside the cards
                container (with overflow: visible) so they can overlap the
                left edge of the cards. Each circle is centered on the gap
                between two adjacent items. During a drag, links INTERNAL to
                the dragged tier render inside the floating drag preview
                instead; links OUTSIDE the tier stay stationary here. */}
            {listType === 'main' && !disableGrouping && mainList.length > 1 && (() => {
              const entries: {
                topCenter: number;
                linked: boolean;
                idA: string;
                idB: string;
                key: string;
                inDraggedTier: boolean;
              }[] = [];
              const tierStart = dragState.tierStart;
              const tierEnd = tierStart !== null ? tierStart + dragState.tierSize - 1 : -1;
              for (let i = 0; i < mainList.length - 1; i++) {
                const a = mainList[i];
                const b = mainList[i + 1];
                const inDraggedTier =
                  dragState.isDragging &&
                  dragState.sourceList === 'main' &&
                  tierStart !== null &&
                  i >= tierStart &&
                  i < tierEnd;
                entries.push({
                  topCenter: (i + 1) * totalItemHeight - gapSize / 2,
                  linked: linkedPairs.has(pairKey(a.id, b.id)),
                  idA: a.id,
                  idB: b.id,
                  key: `link-${a.id}-${b.id}`,
                  inDraggedTier,
                });
              }
              return entries
                .filter(e => !e.inDraggedTier)
                .map(entry => (
                  <LinkCircle
                    key={entry.key}
                    entry={entry}
                    disabled={disabled}
                    onToggle={toggleLinkBetween}
                  />
                ));
            })()}

            {/* Show empty state message if list is empty */}
            {listItems.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <p className={`text-sm ${
                    listType === 'noPreference'
                      ? 'text-gray-500 dark:text-gray-400 font-medium'
                      : 'text-gray-400 dark:text-gray-500'
                  }`}>
                    {listType === 'main' ? 'Drag items here to rank them' : 'Drag items here to exclude from ranking'}
                  </p>
                </div>
              </div>
            )}

            {/* Render all items in this list */}
            {listItems.map((option, index) => {
              // Skip rendering items that are currently being dragged. For
              // main-list drags, this includes *every* tier member so the
              // whole tied group visually moves together.
              if (dragState.isDragging && listType === dragState.sourceList) {
                if (listType === 'main' && dragState.tierStart !== null) {
                  const inTier =
                    index >= dragState.tierStart &&
                    index < dragState.tierStart + dragState.tierSize;
                  if (inTier) return null;
                } else if (option.id === dragState.draggedId) {
                  return null;
                }
              }

              return (
                <div
                  key={option.id}
                  ref={el => {
                    elementRefs.current[option.id] = el;
                  }}
                  className={`
                    absolute left-0 right-0 rounded-md shadow-sm
                    ${disabled ? 'cursor-not-allowed bg-gray-200 dark:bg-gray-600' : 'cursor-grab active:cursor-grabbing bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800'}
                    ${keyboardMode && focusedItemId === option.id ? 'ring-2 ring-blue-500 ring-offset-2' : ''}
                    border border-gray-300 dark:border-gray-500 p-3 select-none
                  `}
                  style={{
                    top: `${option.top}px`,
                    height: `${itemHeight}px`,
                    transition: dragState.isDragging
                      ? 'top 0.2s ease, background-color 0.15s, color 0.15s'
                      : 'top 0.3s ease, background-color 0.15s, color 0.15s',
                    zIndex: 1
                  }}
                  onKeyDown={!disabled ? (e) => handleKeyDown(e, option.id) : undefined}
                  onContextMenu={(e) => e.preventDefault()}
                  tabIndex={disabled ? -1 : 0}
                  role="option"
                  aria-selected={keyboardMode && focusedItemId === option.id}
                  aria-label={`${option.text}, ${listType === 'main' ? `ranked ${index + 1}` : 'no preference'}`}
                  aria-describedby={`${option.id}-instructions`}
                >
                  <div className="flex items-center justify-between h-full relative">
                    {/* Content area - not draggable, allows normal scrolling */}
                    <div className={`flex-1 flex items-center pr-12 min-w-0 ${
                      disabled
                        ? 'text-gray-500 dark:text-gray-400'
                        : 'text-gray-900 dark:text-white'
                    }`}>
                      {renderOption ? renderOption(option.text) : <OptionLabel text={option.text} metadata={optionsMetadata?.[option.text]} className="min-w-0 overflow-hidden" />}
                    </div>

                    {/* Right side: combined drag handle with tap zones for reordering
                         Drag starts on pointerdown; if released without moving, treated as tap */}
                    {!disabled && (
                      <div
                        className="absolute -right-3 cursor-grab active:cursor-grabbing"
                        style={{
                          width: 'calc(14% + 0.525rem)',
                          top: `-${12 + gapSize / 2}px`,
                          bottom: `-${12 + gapSize / 2}px`,
                          touchAction: 'none',
                          zIndex: 2,
                        }}
                        onPointerDown={!disabled ? (e) => {
                          // Always start drag — tap detection happens on pointerup
                          handlePointerStart(e, option.id);
                        } : undefined}
                        onPointerUp={!disabled ? (e) => {
                          // If drag never started (pointer moved <8px), it's a tap
                          const pending = pendingDragRef.current;
                          if (pending && !pending.started && pending.id === option.id) {
                            pendingDragRef.current = null; // Clear before document handler runs

                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            const relativeY = e.clientY - rect.top;
                            const half = rect.height / 2;

                            if (listType === 'noPreference') {
                              moveItemBetweenLists(option.id, 'noPreference', index, 'main', mainList.length);
                            } else if (relativeY < half) {
                              if (index > 0) {
                                moveItemInList(listType, index, index - 1);
                              }
                            } else {
                              if (index < listItems.length - 1) {
                                moveItemInList(listType, index, index + 1);
                              } else {
                                moveItemBetweenLists(option.id, 'main', index, 'noPreference', noPreferenceList.length);
                              }
                            }
                          }
                        } : undefined}
                        title=""
                      >
                        {/* Visual: arrows + drag handle */}
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 flex flex-col items-center justify-center gap-0">
                          {listType === 'main' ? (
                            <>
                              {/* Up arrow */}
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                                className={index === 0 ? 'text-gray-300 dark:text-gray-600' : 'text-gray-400 dark:text-gray-500'}
                              >
                                <polyline points="18 15 12 9 6 15" />
                              </svg>
                              {/* Drag handle lines */}
                              <div className="flex flex-col items-center justify-center my-0.5">
                                <div className="w-3.5 h-0.5 bg-gray-300 dark:bg-gray-600 mb-0.5"></div>
                                <div className="w-3.5 h-0.5 bg-gray-300 dark:bg-gray-600 mb-0.5"></div>
                                <div className="w-3.5 h-0.5 bg-gray-300 dark:bg-gray-600"></div>
                              </div>
                              {/* Down arrow */}
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                                className="text-gray-400 dark:text-gray-500"
                              >
                                <polyline points="6 9 12 15 18 9" />
                              </svg>
                            </>
                          ) : (
                            <>
                              {/* Plus symbol above */}
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                                className="text-green-500 dark:text-green-400"
                              >
                                <line x1="12" y1="5" x2="12" y2="19" />
                                <line x1="5" y1="12" x2="19" y2="12" />
                              </svg>
                              {/* Drag handle lines */}
                              <div className="flex flex-col items-center justify-center my-0.5">
                                <div className="w-3.5 h-0.5 bg-gray-300 dark:bg-gray-600 mb-0.5"></div>
                                <div className="w-3.5 h-0.5 bg-gray-300 dark:bg-gray-600 mb-0.5"></div>
                                <div className="w-3.5 h-0.5 bg-gray-300 dark:bg-gray-600"></div>
                              </div>
                              {/* Plus symbol below */}
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                                className="text-green-500 dark:text-green-400"
                              >
                                <line x1="12" y1="5" x2="12" y2="19" />
                                <line x1="5" y1="12" x2="19" y2="12" />
                              </svg>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <div id={`${option.id}-instructions`} className="absolute -left-[10000px] w-1 h-1 overflow-hidden">
                    {keyboardMode && focusedItemId === option.id
                      ? `Selected for moving. Use arrow keys to move within list, left arrow to move to main list, right arrow to move to no preference, escape to cancel.`
                      : `Press Enter or Space to select for moving. Use arrow keys to navigate between options.`
                    }
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderRankableInterface = () => (
    <div>
      {/* Main ranking list */}
      {renderListContainer(
        mainList,
        mainContainerRef,
        'main',
        '',
        ''
      )}
      
      {/* Divider with "No Preference" text */}
      <div className="my-4 select-none">
        <div className="w-full border-t border-gray-300 dark:border-gray-600"></div>
        <div className="flex justify-center mt-2">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            No Preference
          </span>
        </div>
      </div>
      
      {/* No preference list */}
      {renderListContainer(
        noPreferenceList,
        noPreferenceContainerRef,
        'noPreference'
      )}
      

      {/* Render dragged item if dragging */}
      {dragState.isDragging && renderDraggedItem()}
    </div>
  );

  return (
    <ClientOnlyDragDrop
      fallback={
        <div>
          <div className="mb-4">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Rank your choices by dragging (1st choice at top)
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Drag the options to reorder them according to your preference
            </p>
            <div className="rounded-lg p-3 bg-gray-50 dark:bg-gray-800 border-2 border-dashed border-gray-300 dark:border-gray-600 min-h-[64px] flex items-center justify-center">
              <p className="text-sm text-gray-400 dark:text-gray-500">Loading interactive ranking interface...</p>
            </div>
          </div>
        </div>
      }
    >
      {renderRankableInterface()}
    </ClientOnlyDragDrop>
  );
}