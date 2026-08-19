"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { initDuckDB } from "./duckdb";

interface DuckDBContextValue {
  conn: AsyncDuckDBConnection | null;
  isLoading: boolean;
  error: string | null;
}

const DuckDBContext = createContext<DuckDBContextValue>({
  conn: null,
  isLoading: true,
  error: null,
});

export function DuckDBProvider({ children }: { children: ReactNode }) {
  const [conn, setConn] = useState<AsyncDuckDBConnection | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initDuckDB()
      .then(({ conn }) => {
        setConn(conn);
        setIsLoading(false);
      })
      .catch((err) => {
        console.error("DuckDB init failed:", err);
        setError(
          err instanceof Error ? err.message : "Failed to initialize database"
        );
        setIsLoading(false);
      });
  }, []);

  return (
    <DuckDBContext.Provider value={{ conn, isLoading, error }}>
      {children}
    </DuckDBContext.Provider>
  );
}

export function useDuckDB() {
  return useContext(DuckDBContext);
}
