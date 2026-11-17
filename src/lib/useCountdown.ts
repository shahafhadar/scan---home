"use client";
import { useCallback, useEffect, useState } from "react";

/** Counts whole seconds down to zero. `start(n)` (re)starts it; `left` is what remains. */
export const useCountdown = () => {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => setLeft((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]);
  const start = useCallback((seconds: number) => setLeft(Math.max(0, Math.ceil(seconds))), []);
  return { left, start };
};
