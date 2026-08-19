"use client";

import { Activity } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeToggle } from "./theme-toggle";

/**
 * Identity and utilities only.
 *
 * The section links that used to live here (PFM, Compare, About) were a third
 * navigation surface competing with the map bar — and "PFM & Health" in
 * particular read as a peer of "About" when it is a lens. PFM now sits in the
 * lens lane; Compare and About stay here because they genuinely are utilities
 * rather than places in the hierarchy.
 */
export function AppHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-50 flex h-14 items-center gap-4 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <Link href="/" className="flex items-center gap-2 font-semibold">
        <Activity className="h-5 w-5 text-govt" />
        <span className="hidden sm:inline">Health Financing Dashboard</span>
      </Link>
      <div className="ml-auto flex items-center gap-2">
        {children}
        <Link
          href="/compare"
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Compare
        </Link>
        <Link
          href="/about"
          className="hidden text-xs font-medium text-muted-foreground hover:text-foreground sm:inline"
        >
          About
        </Link>
        <ThemeToggle />
      </div>
    </header>
  );
}
