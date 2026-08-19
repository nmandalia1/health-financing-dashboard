"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";

const DEFAULT_START = 2000;
const DEFAULT_END = 2024;

interface YearRangeContextValue {
  startYear: number;
  endYear: number;
  setStartYear: (y: number) => void;
  setEndYear: (y: number) => void;
  setRange: (start: number, end: number) => void;
}

const YearRangeContext = createContext<YearRangeContextValue>({
  startYear: DEFAULT_START,
  endYear: DEFAULT_END,
  setStartYear: () => {},
  setEndYear: () => {},
  setRange: () => {},
});

export function YearRangeProvider({ children }: { children: ReactNode }) {
  const [startYear, setStartYearState] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_START;
    const stored = localStorage.getItem("dashboard-year-start");
    return stored ? Number(stored) : DEFAULT_START;
  });
  const [endYear, setEndYearState] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_END;
    const stored = localStorage.getItem("dashboard-year-end");
    return stored ? Number(stored) : DEFAULT_END;
  });

  const setStartYear = useCallback((y: number) => {
    setStartYearState(y);
    localStorage.setItem("dashboard-year-start", String(y));
  }, []);

  const setEndYear = useCallback((y: number) => {
    setEndYearState(y);
    localStorage.setItem("dashboard-year-end", String(y));
  }, []);

  const setRange = useCallback((start: number, end: number) => {
    setStartYearState(start);
    setEndYearState(end);
    localStorage.setItem("dashboard-year-start", String(start));
    localStorage.setItem("dashboard-year-end", String(end));
  }, []);

  return (
    <YearRangeContext.Provider
      value={{ startYear, endYear, setStartYear, setEndYear, setRange }}
    >
      {children}
    </YearRangeContext.Provider>
  );
}

export function useYearRange() {
  return useContext(YearRangeContext);
}
