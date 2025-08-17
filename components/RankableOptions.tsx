"use client";

import { useState, useRef, useEffect, useCallback } from 'react';
import { ClientOnlyDragDrop } from './ClientOnly';

interface RankableOption {
  id: string;
  text: string;
  top: number;
}

interface RankableOptionsProps {
  options: string[];
  onRankingChange: (rankedOptions: string[]) => void;
  disabled?: boolean;
  storageKey?: string; // Optional key for localStorage persistence
  initialRanking?: string[]; // Optional initial ranking to override saved state
}

export default function RankableOptions({ options, onRankingChange, disabled = false, storageKey, initialRanking }: RankableOptionsProps) {

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
  const saveState = useCallback((mainList: RankableOption[], noPreferenceList: RankableOption[]) => {
    if (!storageKey || typeof window === 'undefined') return;
    
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        mainList,
        noPreferenceList,
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
  const [dragState, setDragState] = useState({
    isDragging: false,
    draggedId: null as string | null,
    dragStartIndex: null as number | null,
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

  // Configuration
  const itemHeight = 56;
  const gapSize = 8;
  const totalItemHeight = itemHeight + gapSize;

  // DOM Refs
  const mainContainerRef = useRef<HTMLDivElement>(null);
  const noPreferenceContainerRef = useRef<HTMLDivElement>(null);
  const elementRefs = useRef<Record<string, HTMLDivElement | null>>({});

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

  // Get coordinates from either mouse or touch event
  const getEventCoords = useCallback((e: React.PointerEvent | PointerEvent) => {
    return { x: e.clientX, y: e.clientY };
  }, []);

  // Start dragging an item
  const startDrag = useCallback((e: React.PointerEvent, id: string) => {
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
    const coords = getEventCoords(e);

    // Store drag state
    setDragState({
      isDragging: true,
      draggedId: id,
      dragStartIndex: itemIndex,
      targetIndex: itemIndex,
      sourceList,
      targetList: sourceList,
      mouseOffset: {
        x: coords.x - rect.left,
        y: coords.y - rect.top
      },
      mousePosition: coords
    });
  }, [disabled, dragState.isDragging, mainList, noPreferenceList, getEventCoords]);

  // Handle drag movement
  const handleDragMove = useCallback((e: PointerEvent) => {
    if (!dragState.isDragging) return;

    e.preventDefault();
    const coords = getEventCoords(e);
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

          // Update main list positions
          setMainList(prev => {
            const updatedList = [...prev];
            updatedList.forEach((item, index) => {
              item.top = index * totalItemHeight;
            });

            // If dragging from main list and targeting main list
            if (sourceList === 'main' && newTargetList === 'main' && startIndex !== newTargetIndex && newTargetIndex !== null) {
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
            // If dragging from main to no preference, shift items up to fill gap
            else if (sourceList === 'main' && newTargetList === 'noPreference') {
              for (let i = startIndex + 1; i < updatedList.length; i++) {
                updatedList[i].top = (i - 1) * totalItemHeight;
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

            // If dragging within no preference list
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
            // If dragging from main to no preference, shift items down to make space
            else if (sourceList === 'main' && newTargetList === 'noPreference' && newTargetIndex !== null) {
              for (let i = newTargetIndex; i < updatedList.length; i++) {
                updatedList[i].top = (i + 1) * totalItemHeight;
              }
            }

            return updatedList;
          });
        }
      });
    }
  }, [dragState, getEventCoords, getDropTarget, totalItemHeight]);

  // Complete the drag operation
  const finishDrag = useCallback(() => {
    if (!dragState.isDragging) return;

    const { draggedId, dragStartIndex, targetIndex, sourceList, targetList } = dragState;

    if (draggedId && dragStartIndex !== null && targetIndex !== null && sourceList && targetList) {
      // Find the dragged item
      const sourceListRef = sourceList === 'main' ? mainList : noPreferenceList;
      const draggedItem = sourceListRef.find(item => item.id === draggedId);
      
      if (draggedItem) {
        // Handle cross-list movement or reordering within the same list
        if (sourceList !== targetList || dragStartIndex !== targetIndex) {
          // Handle cross-list movement with atomic state updates
          if (sourceList !== targetList) {
            // Moving between lists - update both lists atomically
            if (sourceList === 'main' && targetList === 'noPreference') {
              // Remove from main list
              setMainList(prev => {
                const newList = [...prev];
                newList.splice(dragStartIndex, 1);
                return updateItemPositions(newList);
              });
              // Add to no preference list
              setNoPreferenceList(prev => {
                const newList = [...prev];
                newList.splice(targetIndex, 0, draggedItem);
                return updateItemPositions(newList);
              });
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
              setMainList(prev => {
                const newList = [...prev];
                const [movedItem] = newList.splice(dragStartIndex, 1);
                newList.splice(targetIndex, 0, movedItem);
                return updateItemPositions(newList);
              });
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
      targetIndex: null,
      sourceList: null,
      targetList: null,
      mouseOffset: { x: 0, y: 0 },
      mousePosition: { x: 0, y: 0 }
    });
  }, [dragState, mainList, noPreferenceList, updateItemPositions]);

  // Set up event listeners
  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      if (dragState.isDragging) {
        handleDragMove(e);
      }
    };

    const handleEnd = () => {
      if (dragState.isDragging) {
        finishDrag();
      }
    };

    // Add event listeners to document for better capture
    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleEnd);
    document.addEventListener('pointercancel', handleEnd);

    return () => {
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleEnd);
      document.removeEventListener('pointercancel', handleEnd);
    };
  }, [dragState.isDragging, handleDragMove, finishDrag]);

  // Track if component has mounted
  const hasMountedRef = useRef(false);
  const previousOptionsRef = useRef<string[]>([]);
  
  // Notify parent component when main list changes (only main list matters for voting)
  useEffect(() => {
    // Skip the first render to avoid triggering on initialization
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      // Still notify parent with initial ranking
      const initialRanking = mainList.map(option => option.text);
      onRankingChange(initialRanking);
      return;
    }
    
    const newRanking = mainList.map(option => option.text);
    onRankingChange(newRanking);
  }, [mainList, onRankingChange]);

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
          id: `option-${initialRanking.indexOf(text)}`, // Use consistent ID based on original option order
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
        } else {
          // Initialize with randomized order to prevent position bias
          const shuffledOptions = shuffleArray(options);
          const newRankedOptions = shuffledOptions.map((text, index) => ({
            id: `option-${index}`,
            text: text,
            top: index * totalItemHeight
          }));
          setMainList(newRankedOptions);
          setNoPreferenceList([]);
        }
      }
      
      previousOptionsRef.current = options;
      previousInitialRankingRef.current = initialRanking;
    }
  }, [options, initialRanking, totalItemHeight, loadSavedState, shuffleArray]);

  // Save state whenever lists change
  useEffect(() => {
    if (hasMountedRef.current && storageKey) {
      saveState(mainList, noPreferenceList);
    }
  }, [mainList, noPreferenceList, saveState, storageKey]);

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

  // Get style for the dragged item
  const getDraggedItemStyle = () => {
    const { mousePosition, mouseOffset } = dragState;

    const x = mousePosition.x - mouseOffset.x;
    const y = mousePosition.y - mouseOffset.y;
    const width = mainContainerRef.current ? mainContainerRef.current.offsetWidth : 300;

    return {
      position: 'fixed' as const,
      left: `${x}px`,
      top: `${y}px`,
      width: `${width}px`,
      height: `${itemHeight}px`,
      zIndex: 1000,
      pointerEvents: 'none' as const,
      transform: 'scale(1.02)',
      boxShadow: '0 8px 25px rgba(0,0,0,0.3)'
    };
  };

  // Render dragged item
  const renderDraggedItem = () => {
    const draggedOption = getDraggedOption();
    if (!draggedOption) return null;

    // Find the current ranking number based on which list it's in
    let rankNumber = '';
    const mainIndex = mainList.findIndex(opt => opt.id === draggedOption.id);
    if (mainIndex !== -1) {
      rankNumber = (mainIndex + 1).toString();
    } else {
      rankNumber = '—'; // No ranking for no preference items
    }

    return (
      <div
        className="bg-blue-100 dark:bg-blue-900 border border-blue-300 dark:border-blue-600 rounded-md p-3 select-none"
        style={getDraggedItemStyle()}
      >
        <div className="flex items-center justify-between h-full">
          <div className="flex items-center">
            <div className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-medium mr-3">
              {rankNumber}
            </div>
            <span className="font-medium text-gray-900 dark:text-white">{draggedOption.text}</span>
          </div>
          <div className="w-6 h-6 flex flex-col items-center justify-center ml-2">
            <div className="w-4 h-0.5 bg-gray-600 mb-1"></div>
            <div className="w-4 h-0.5 bg-gray-600 mb-1"></div>
            <div className="w-4 h-0.5 bg-gray-600"></div>
          </div>
        </div>
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

    // Only apply height changes when dragging between different lists
    if (dragState.targetList && dragState.sourceList !== dragState.targetList) {
      // Cross-list drag: asymmetric behavior for better UX
      let newMainHeight = baseMainHeight;
      let newNoPreferenceHeight = baseNoPreferenceHeight;

      if (dragState.sourceList === 'main' && dragState.targetList === 'noPreference') {
        // Dragging from main to no preference - DON'T shrink main (keep stable), but grow no preference
        newMainHeight = baseMainHeight; // Keep main list at original size during preview
        newNoPreferenceHeight = Math.max((noPreferenceList.length + 1) * totalItemHeight - gapSize, totalItemHeight);
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
    startDrag(e, id);
  }, [disabled, startDrag]);

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

  // Helper function to move items within the same list
  const moveItemInList = useCallback((listType: 'main' | 'noPreference', fromIndex: number, toIndex: number) => {
    if (listType === 'main') {
      setMainList(prev => {
        const newList = [...prev];
        const [item] = newList.splice(fromIndex, 1);
        newList.splice(toIndex, 0, item);
        const updatedList = updateItemPositions(newList);
        
        // Parent notification will be handled by useEffect
        
        return updatedList;
      });
    } else {
      setNoPreferenceList(prev => {
        const newList = [...prev];
        const [item] = newList.splice(fromIndex, 1);
        newList.splice(toIndex, 0, item);
        return updateItemPositions(newList);
      });
    }
  }, [updateItemPositions]);

  // Helper function to move items between lists
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

    // Remove from source list
    if (sourceList === 'main') {
      setMainList(prev => {
        const newList = [...prev];
        newList.splice(sourceIndex, 1);
        return updateItemPositions(newList);
      });
    } else {
      setNoPreferenceList(prev => {
        const newList = [...prev];
        newList.splice(sourceIndex, 1);
        return updateItemPositions(newList);
      });
    }

    // Add to target list
    if (targetList === 'main') {
      setMainList(prev => {
        const newList = [...prev];
        newList.splice(targetIndex, 0, item);
        const updatedList = updateItemPositions(newList);
        
        // Parent notification will be handled by useEffect
        
        return updatedList;
      });
    } else {
      setNoPreferenceList(prev => {
        const newList = [...prev];
        newList.splice(targetIndex, 0, item);
        return updateItemPositions(newList);
      });
    }
  }, [mainList, noPreferenceList, updateItemPositions, onRankingChange]);

  // Render a single list container (main or no preference)
  const renderListContainer = (
    listItems: RankableOption[],
    containerRef: React.RefObject<HTMLDivElement>,
    listType: 'main' | 'noPreference',
    title?: string,
    description?: string
  ) => {
    // Use dynamic height from state with smooth transitions
    const dynamicHeight = containerHeights[listType];
    
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
        
        <div
          ref={containerRef}
          className="p-3 relative transition-all duration-200 ease-out"
          style={{
            height: `${dynamicHeight}px`,
            minHeight: `${totalItemHeight}px`
          }}
          role="listbox"
          aria-label={listType === 'main' ? 'Ranked choice options' : 'No preference options'}
          aria-describedby={`${listType}-description`}
        >
          {/* Show empty state message if list is empty */}
          {listItems.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-sm text-gray-400 dark:text-gray-500">
                {listType === 'main' ? 'Drag items here to rank them' : 'Drag items here to exclude from ranking'}
              </p>
            </div>
          )}
          
          {/* Render all items in this list */}
          {listItems.map((option, index) => {
            // Skip rendering the item in its original position if it's being dragged
            if (dragState.isDragging && option.id === dragState.draggedId) {
              return null;
            }

            // Determine rank number display
            const rankNumber = listType === 'main' ? (index + 1).toString() : '—';

            return (
              <div
                key={option.id}
                ref={el => {
                  elementRefs.current[option.id] = el;
                }}
                className={`
                  absolute left-0 right-0 rounded-md shadow-sm
                  ${disabled ? 'cursor-not-allowed bg-gray-100 dark:bg-gray-700' : 'cursor-grab active:cursor-grabbing bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600'}
                  ${keyboardMode && focusedItemId === option.id ? 'ring-2 ring-blue-500 ring-offset-2' : ''}
                  border border-gray-200 dark:border-gray-600 p-3 select-none
                  transition-colors duration-150
                `}
                style={{
                  top: `${option.top}px`,
                  height: `${itemHeight}px`,
                  transition: dragState.isDragging ? 'top 0.2s ease' : 'top 0.3s ease',
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
                  {/* Left drag handle with 30% grabbable region */}
                  <div 
                    className="absolute left-0 top-0 bottom-0 cursor-grab active:cursor-grabbing"
                    style={{
                      width: '30%',
                      touchAction: 'none',
                      zIndex: 2
                    }}
                    onPointerDown={!disabled ? (e) => handlePointerStart(e, option.id) : undefined}
                    title="Drag to reorder"
                  >
                    {/* Visual number circle - positioned within the grabbable area */}
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 flex items-center">
                      <div 
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-sm font-medium ${
                          disabled 
                            ? 'bg-gray-300 text-gray-500 dark:bg-gray-600 dark:text-gray-400' 
                            : listType === 'main'
                              ? 'bg-blue-600 text-white'
                              : 'bg-orange-500 text-white'
                        }`}
                      >
                        {rankNumber}
                      </div>
                    </div>
                  </div>
                  
                  {/* Center content - not grabbable */}
                  <div className="flex-1 flex items-center px-12">
                    <span className={`font-medium ${
                      disabled 
                        ? 'text-gray-500 dark:text-gray-400' 
                        : 'text-gray-900 dark:text-white'
                    }`}>
                      {option.text}
                    </span>
                  </div>
                  
                  {/* Right drag handle with 30% grabbable region */}
                  {!disabled && (
                    <div 
                      className="absolute right-0 top-0 bottom-0 cursor-grab active:cursor-grabbing"
                      style={{
                        width: '30%',
                        touchAction: 'none',
                        zIndex: 2
                      }}
                      onPointerDown={(e) => handlePointerStart(e, option.id)}
                      title="Drag to reorder"
                    >
                      {/* Visual hamburger menu - positioned within the grabbable area */}
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex flex-col items-center justify-center">
                        <div className="w-4 h-0.5 bg-gray-400 mb-1"></div>
                        <div className="w-4 h-0.5 bg-gray-400 mb-1"></div>
                        <div className="w-4 h-0.5 bg-gray-400"></div>
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
    );
  };

  const renderRankableInterface = () => (
    <div>
      {/* Main ranking list */}
      {renderListContainer(
        mainList,
        mainContainerRef,
        'main',
        'Drag to reorder from most to least preferred',
        ''
      )}
      
      {/* Divider with "No Preference" text */}
      <div className="my-4">
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