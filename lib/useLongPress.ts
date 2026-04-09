import { useRef, useState } from 'react';

interface LongPressOptions {
  /** Duration in ms before the long-press fires. Default: 500. */
  delay?: number;
}

interface LongPressResult {
  /** Spread these props onto the target element. */
  props: {
    onPointerDown: () => void;
    onPointerUp: () => void;
    onPointerLeave: () => void;
    onPointerCancel: () => void;
    onContextMenu: (e: React.MouseEvent) => void;
  };
  /** True while the pointer is held down (before the timer fires). */
  isPressed: boolean;
}

/**
 * Detects a long-press gesture on any element.
 *
 * Usage:
 *   const { props, isPressed } = useLongPress(() => doSomething());
 *   return <div {...props} />;
 *
 * The callback is only called if the pointer is held for `delay` ms without
 * moving off the element. Context-menu (right-click / long-tap on iOS) is
 * suppressed to prevent the browser menu from competing with the gesture.
 */
export function useLongPress(
  callback: (() => void) | null | undefined,
  { delay = 500 }: LongPressOptions = {}
): LongPressResult {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isPressed, setIsPressed] = useState(false);

  const cancel = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setIsPressed(false);
  };

  const props = {
    onPointerDown: () => {
      if (!callback) return;
      setIsPressed(true);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setIsPressed(false);
        callback();
      }, delay);
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };

  return { props, isPressed };
}
