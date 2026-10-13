"use client";

import { useState, type ReactNode } from "react";

/**
 * Phones: the search box and a Filters button share one row; the filters open below it.
 * Closed filters stay in the form (just hidden), so a search keeps the filters already set.
 */
export function FilterToggle({ search, count, children }: { search: ReactNode; count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="flex gap-2">
        {search}
        <button
          type="button"
          aria-expanded={open}
          aria-controls="availability-filters"
          onClick={() => setOpen(!open)}
          className={`flex min-h-11 shrink-0 items-center gap-1.5 border px-3 text-sm ${open ? "border-foreground bg-accent text-accent-foreground" : "border-border bg-surface"}`}
        >
          Filters
          {count > 0 && <span className="rounded-full bg-brand px-1.5 text-xs font-semibold leading-5 text-brand-foreground">{count}</span>}
        </button>
      </div>
      <div id="availability-filters" hidden={!open} className="mt-2 grid gap-2 border border-border bg-surface p-3">
        {children}
      </div>
    </div>
  );
}
