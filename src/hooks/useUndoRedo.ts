import { useState, useCallback, useRef } from 'react';

interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

export const useUndoRedo = <T>(initialState: T, maxHistory: number = 50) => {
  const [history, setHistory] = useState<HistoryState<T>>({
    past: [],
    present: initialState,
    future: [],
  });

  const skipHistoryRef = useRef(false);

  const setState = useCallback((newState: T | ((prev: T) => T), skipHistory = false) => {
    setHistory((prev) => {
      const nextState = typeof newState === 'function' 
        ? (newState as (prev: T) => T)(prev.present) 
        : newState;

      if (skipHistory || skipHistoryRef.current) {
        return { ...prev, present: nextState };
      }

      const newPast = [...prev.past, prev.present].slice(-maxHistory);
      return {
        past: newPast,
        present: nextState,
        future: [],
      };
    });
  }, [maxHistory]);

  const undo = useCallback(() => {
    setHistory((prev) => {
      if (prev.past.length === 0) return prev;

      const previous = prev.past[prev.past.length - 1];
      const newPast = prev.past.slice(0, -1);

      return {
        past: newPast,
        present: previous,
        future: [prev.present, ...prev.future],
      };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((prev) => {
      if (prev.future.length === 0) return prev;

      const next = prev.future[0];
      const newFuture = prev.future.slice(1);

      return {
        past: [...prev.past, prev.present],
        present: next,
        future: newFuture,
      };
    });
  }, []);

  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  const clearHistory = useCallback(() => {
    setHistory((prev) => ({
      past: [],
      present: prev.present,
      future: [],
    }));
  }, []);

  const setWithoutHistory = useCallback((newState: T | ((prev: T) => T)) => {
    setState(newState, true);
  }, [setState]);

  return {
    state: history.present,
    setState,
    setWithoutHistory,
    undo,
    redo,
    canUndo,
    canRedo,
    clearHistory,
    historyLength: history.past.length,
  };
};
