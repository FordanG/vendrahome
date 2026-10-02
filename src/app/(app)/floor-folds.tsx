"use client";

import { useSyncExternalStore, type ReactNode } from "react";

export type FloorFold = { id: string; summary: ReactNode; rooms: ReactNode };

// Which floors are open is remembered on this device, so the board comes back the way it was left.
const KEY = "board-open-floors";
const CHANGED = "board-open-floors-changed";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

function read() {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

function write(ids: string[]) {
  try {
    localStorage.setItem(KEY, ids.join(","));
  } catch {
    // Private windows may refuse storage; the floors still open and close, just not remembered.
  }
  window.dispatchEvent(new Event(CHANGED));
}

/**
 * The room board, one fold per floor. A folded floor shows its summary line only;
 * opening it shows the room slots. Every floor starts folded.
 */
export function FloorFolds({ floors }: { floors: FloorFold[] }) {
  const stored = useSyncExternalStore(subscribe, read, () => "");
  const open = new Set(stored ? stored.split(",") : []);
  const allOpen = floors.every((f) => open.has(f.id));

  const setOpen = (id: string, isOpen: boolean) => {
    if (open.has(id) === isOpen) return;
    const next = new Set(open);
    if (isOpen) next.add(id);
    else next.delete(id);
    write([...next]);
  };

  return (
    <div>
      <div className="no-print mb-2 flex justify-end">
        <button
          type="button"
          onClick={() => write(allOpen ? [] : floors.map((f) => f.id))}
          className="min-h-10 px-1 text-sm text-muted underline underline-offset-2 hover:text-foreground sm:min-h-0"
        >
          {allOpen ? "Fold all floors" : "Open all floors"}
        </button>
      </div>
      <div className="divide-y divide-border border border-border bg-surface">
        {floors.map((f) => (
          <details key={f.id} open={open.has(f.id)} onToggle={(e) => setOpen(f.id, e.currentTarget.open)} className="group">
            <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-3 hover:bg-background/60 sm:px-5 [&::-webkit-details-marker]:hidden">
              <svg
                viewBox="0 0 24 24"
                className="size-5 shrink-0 text-muted transition-transform group-open:rotate-90"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden
              >
                <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1.5">{f.summary}</span>
            </summary>
            <div className="px-3 pb-4 pt-1 sm:px-5 sm:pb-5">{f.rooms}</div>
          </details>
        ))}
      </div>
    </div>
  );
}
