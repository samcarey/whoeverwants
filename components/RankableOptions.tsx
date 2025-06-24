"use client";

import { useState, useRef, useEffect, useCallback } from 'react';

interface RankableOption {
  id: string;
  text: string;
  top: number;
}

interface RankableOptionsProps {
  options: string[];
  onRankingChange: (rankedOptions: string[]) => void;
  disabled?: boolean;
}

export default function RankableOptions({ options, onRankingChange, disabled = false }: RankableOptionsProps) {
  // Create ranked options from props
  const createRankedOptions = useCallback((optionTexts: string[]) => {
    return optionTexts.map((text, index) => ({
      id: `option-${index}`,
      text,
      top: 0 // Will be set by updateItemPositions
    }));
  }, []);

  // State management
  const [rankedOptions, setRankedOptions] = useState<RankableOption[]>(() => createRankedOptions(options));
  const [dragState, setDragState] = useState({
    isDragging: false,
    draggedId: null as string | null,
    dragStartIndex: null as number | null,
    targetIndex: null as number | null,
    mouseOffset: { x: 0, y: 0 },
    mousePosition: { x: 0, y: 0 }
  });

  // Configuration
  const itemHeight = 56;
  const gapSize = 8;
  const totalItemHeight = itemHeight + gapSize;

  // DOM Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const elementRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Update positions of all items based on current order
  const updateItemPositions = useCallback((itemList: RankableOption[]) => {
    return itemList.map((item, index) => ({
      ...item,
      top: index * totalItemHeight
    }));
  }, [totalItemHeight]);

  // Determine which index a specific Y coordinate falls into
  const getIndexFromY = useCallback((y: number) => {
    const index = Math.floor(y / totalItemHeight);
    return Math.max(0, Math.min(rankedOptions.length - 1, index));
  }, [totalItemHeight, rankedOptions.length]);

  // Get coordinates from either mouse or touch event
  const getEventCoords = useCallback((e: React.PointerEvent | PointerEvent) => {
    return { x: e.clientX, y: e.clientY };
  }, []);

  // Start dragging an item
  const startDrag = useCallback((e: React.PointerEvent, id: string) => {
    if (disabled || dragState.isDragging) return;

    // Find the item and its DOM element
    const itemIndex = rankedOptions.findIndex(item => item.id === id);
    if (itemIndex === -1) return;

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
      mouseOffset: {
        x: coords.x - rect.left,
        y: coords.y - rect.top
      },
      mousePosition: coords
    });
  }, [disabled, dragState.isDragging, rankedOptions, getEventCoords]);

  // Handle drag movement
  const handleDragMove = useCallback((e: PointerEvent) => {
    if (!dragState.isDragging) return;

    e.preventDefault();
    const coords = getEventCoords(e);

    if (containerRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const relativeY = coords.y - containerRect.top;

      // Get index at current position
      const newTargetIndex = getIndexFromY(relativeY);

      // Update both mouse position and target index together
      if (newTargetIndex !== dragState.targetIndex || coords.x !== dragState.mousePosition.x || coords.y !== dragState.mousePosition.y) {
        // Batch the state updates together to avoid multiple renders
        requestAnimationFrame(() => {
          setDragState(prev => ({
            ...prev,
            mousePosition: coords,
            targetIndex: newTargetIndex
          }));

          // Update item positions for visual feedback only if target index changed
          if (newTargetIndex !== dragState.targetIndex) {
            setRankedOptions(prev => {
              const updatedOptions = [...prev];
              const startIndex = dragState.dragStartIndex!;

              // Reset all items to their base positions
              updatedOptions.forEach((item, index) => {
                item.top = index * totalItemHeight;
              });

              // Adjust positions based on drag target
              if (startIndex !== newTargetIndex) {
                if (startIndex < newTargetIndex) {
                  // Moving down - shift items up
                  for (let i = startIndex + 1; i <= newTargetIndex; i++) {
                    updatedOptions[i].top = (i - 1) * totalItemHeight;
                  }
                } else {
                  // Moving up - shift items down
                  for (let i = newTargetIndex; i < startIndex; i++) {
                    updatedOptions[i].top = (i + 1) * totalItemHeight;
                  }
                }
              }

              return updatedOptions;
            });
          }
        });
      }
    }
  }, [dragState, getEventCoords, getIndexFromY, totalItemHeight]);

  // Complete the drag operation
  const finishDrag = useCallback(() => {
    if (!dragState.isDragging) return;

    const { dragStartIndex, targetIndex } = dragState;
    let shouldNotifyChange = false;
    let newRanking: string[] = [];

    // Reorder items if position changed
    if (dragStartIndex !== null && targetIndex !== null && dragStartIndex !== targetIndex) {
      setRankedOptions(prev => {
        const newOptions = [...prev];
        const [removed] = newOptions.splice(dragStartIndex, 1);
        newOptions.splice(targetIndex, 0, removed);
        const updatedOptions = updateItemPositions(newOptions);
        
        // Store the new ranking for later notification
        shouldNotifyChange = true;
        newRanking = updatedOptions.map(option => option.text);
        
        return updatedOptions;
      });
    } else {
      // Reset positions if no reorder
      setRankedOptions(prev => updateItemPositions(prev));
    }

    // Reset drag state
    setDragState({
      isDragging: false,
      draggedId: null,
      dragStartIndex: null,
      targetIndex: null,
      mouseOffset: { x: 0, y: 0 },
      mousePosition: { x: 0, y: 0 }
    });

    // Notify parent of ranking change after state updates are complete
    if (shouldNotifyChange) {
      // Use setTimeout to ensure this happens after the current render cycle
      setTimeout(() => {
        onRankingChange(newRanking);
      }, 0);
    }
  }, [dragState, updateItemPositions, onRankingChange]);

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

  // Initialize positions on mount and when options change
  useEffect(() => {
    const newRankedOptions = createRankedOptions(options);
    const positionedOptions = updateItemPositions(newRankedOptions);
    setRankedOptions(positionedOptions);
  }, [options, createRankedOptions, updateItemPositions]);

  // Get the dragged item
  const getDraggedOption = () => {
    if (!dragState.draggedId) return null;
    return rankedOptions.find(option => option.id === dragState.draggedId) || null;
  };

  // Get style for the dragged item
  const getDraggedItemStyle = () => {
    const { mousePosition, mouseOffset } = dragState;

    const x = mousePosition.x - mouseOffset.x;
    const y = mousePosition.y - mouseOffset.y;
    const width = containerRef.current ? containerRef.current.offsetWidth : 300;

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

    return (
      <div
        className="bg-blue-100 dark:bg-blue-900 border border-blue-300 dark:border-blue-600 rounded-md p-3 select-none"
        style={getDraggedItemStyle()}
      >
        <div className="flex items-center justify-between h-full">
          <div className="flex items-center">
            <div className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-medium mr-3">
              {rankedOptions.findIndex(opt => opt.id === draggedOption.id) + 1}
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

  const handlePointerStart = useCallback((e: React.PointerEvent, id: string) => {
    if (disabled) return;
    
    e.preventDefault();
    e.stopPropagation();
    startDrag(e, id);
  }, [disabled, startDrag]);

  return (
    <div>
      <div className="mb-3">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Rank your choices by dragging (1st choice at top)
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Drag the options to reorder them according to your preference
        </p>
      </div>
      
      <div
        ref={containerRef}
        className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 relative"
        style={{
          height: `${rankedOptions.length * totalItemHeight - gapSize}px`,
          touchAction: 'none'
        }}
      >
        {/* Render all options */}
        {rankedOptions.map((option, index) => {
          // Skip rendering the item in its original position if it's being dragged
          if (dragState.isDragging && option.id === dragState.draggedId) {
            return null;
          }

          return (
            <div
              key={option.id}
              ref={el => {
                elementRefs.current[option.id] = el;
              }}
              className={`
                absolute left-0 right-0 rounded-md shadow-sm
                ${disabled ? 'cursor-not-allowed bg-gray-100 dark:bg-gray-700' : 'cursor-grab active:cursor-grabbing bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600'}
                border border-gray-200 dark:border-gray-600 p-3 select-none
                transition-colors duration-150
              `}
              style={{
                top: `${option.top}px`,
                height: `${itemHeight}px`,
                transition: dragState.isDragging ? 'top 0.2s ease' : 'top 0.3s ease',
                zIndex: 1,
                touchAction: 'none',
                userSelect: 'none',
                WebkitUserSelect: 'none',
                WebkitTouchCallout: 'none'
              }}
              onPointerDown={!disabled ? (e) => handlePointerStart(e, option.id) : undefined}
              onContextMenu={(e) => e.preventDefault()}
            >
              <div className="flex items-center justify-between h-full">
                <div className="flex items-center">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-sm font-medium mr-3 ${
                    disabled 
                      ? 'bg-gray-300 text-gray-500 dark:bg-gray-600 dark:text-gray-400' 
                      : 'bg-blue-600 text-white'
                  }`}>
                    {index + 1}
                  </div>
                  <span className={`font-medium ${
                    disabled 
                      ? 'text-gray-500 dark:text-gray-400' 
                      : 'text-gray-900 dark:text-white'
                  }`}>
                    {option.text}
                  </span>
                </div>
                {!disabled && (
                  <div className="w-6 h-6 flex flex-col items-center justify-center ml-2">
                    <div className="w-4 h-0.5 bg-gray-400 mb-1"></div>
                    <div className="w-4 h-0.5 bg-gray-400 mb-1"></div>
                    <div className="w-4 h-0.5 bg-gray-400"></div>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Render dragged item if dragging */}
        {dragState.isDragging && renderDraggedItem()}
      </div>
    </div>
  );
}