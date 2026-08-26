import { useEffect, useRef, useCallback } from 'react';

interface SwipeGestureOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  threshold?: number;
  edgeWidth?: number;
}

export const useSwipeGesture = ({
  onSwipeLeft,
  onSwipeRight,
  threshold = 50,
  edgeWidth = 30,
}: SwipeGestureOptions) => {
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const isEdgeSwipe = useRef(false);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const touch = e.touches[0];
    touchStartX.current = touch.clientX;
    touchStartY.current = touch.clientY;
    
    // Check if swipe started from left edge
    isEdgeSwipe.current = touch.clientX <= edgeWidth;
  }, [edgeWidth]);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;

    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - touchStartX.current;
    const deltaY = touch.clientY - touchStartY.current;

    // Only trigger if horizontal movement is greater than vertical (to not interfere with scrolling)
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > threshold) {
      if (deltaX > 0 && isEdgeSwipe.current && onSwipeRight) {
        // Swipe right from edge - open sidebar
        onSwipeRight();
      } else if (deltaX < 0 && onSwipeLeft) {
        // Swipe left - close sidebar
        onSwipeLeft();
      }
    }

    touchStartX.current = null;
    touchStartY.current = null;
    isEdgeSwipe.current = false;
  }, [threshold, onSwipeLeft, onSwipeRight]);

  useEffect(() => {
    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchEnd]);
};
