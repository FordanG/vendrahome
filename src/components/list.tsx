import Link from "next/link";
import type { ReactNode } from "react";
import type { RoomStatus } from "@/lib/room-status";

// Phone lists: one tappable row per item with a bold title and a line or two in words,
// instead of a table squeezed into a narrow screen. Pages show these below `sm` and
// keep their table from `sm` up.

/** How a room looks on the board; plates in lists use the same look so they read the same. */
export const SLOT: Record<RoomStatus, string> = {
  occupied: "bg-occupied text-occupied-foreground border-occupied",
  contracted_empty: "bg-surface text-accent border-accent/55 border-2",
  vacant: "bg-transparent text-muted border-dashed border-muted/50",
  needs_work: "bg-warn text-warn-foreground border-warn",
  not_available:
    "text-attention border-attention/60 bg-[repeating-linear-gradient(135deg,transparent_0_5px,color-mix(in_srgb,var(--attention)_14%,transparent)_5px_10px)]",
};

/** Small colour samples for the status filters and keys. */
export const SWATCH: Record<RoomStatus, string> = {
  occupied: "bg-occupied",
  contracted_empty: "border-2 border-accent/55",
  vacant: "border border-dashed border-muted/70",
  needs_work: "bg-warn",
  not_available: "border border-attention/60 bg-attention/15",
};

/** A room number like the plate on its door, coloured like its slot on the room board. */
export function RoomPlate({ number, status }: { number: string; status?: RoomStatus }) {
  return (
    <span
      className={`plate flex h-11 w-14 shrink-0 items-center justify-center rounded-md border text-xl font-bold ${
        status ? SLOT[status] : "border-border bg-background text-foreground"
      }`}
    >
      <span className="sr-only">Room </span>
      {number}
    </span>
  );
}

export function RowList({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <ul className={`divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface ${className}`}>
      {children}
    </ul>
  );
}

/**
 * One row: the whole row opens `href`. `action` sits outside the link (a second tap target),
 * so rows never nest links.
 */
export function Row({
  href,
  plate,
  title,
  badge,
  children,
  action,
}: {
  href: string;
  plate?: ReactNode;
  title: ReactNode;
  badge?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <li className="flex items-center">
      <Link
        href={href}
        className="flex min-h-16 min-w-0 flex-1 items-center gap-3 py-3 pl-4 pr-3 active:bg-background"
      >
        {plate}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-base font-semibold leading-snug">{title}</span>
            {badge}
          </span>
          {children && <span className="mt-0.5 block space-y-0.5 text-sm leading-snug text-muted">{children}</span>}
        </span>
        {!action && (
          <svg viewBox="0 0 24 24" className="size-5 shrink-0 text-muted/70" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </Link>
      {action && <div className="shrink-0 pr-3">{action}</div>}
    </li>
  );
}

/** A line inside a Row. */
export function RowLine({ children }: { children: ReactNode }) {
  return <span className="block">{children}</span>;
}

/**
 * Floor buttons that stay under the phone header, for jumping through long room lists.
 * Pair with sections that have id `floor-N` and the `floor-section` class.
 */
export function FloorJump({ floors }: { floors: number[] }) {
  if (floors.length < 2) return null;
  return (
    <nav
      aria-label="Go to floor"
      className="no-print sticky top-[calc(3rem+env(safe-area-inset-top))] z-20 -mx-4 mb-3 flex items-center gap-2 overflow-x-auto bg-background/95 px-4 py-2 backdrop-blur sm:hidden"
    >
      <span className="shrink-0 text-sm text-muted">Floor</span>
      {floors.map((f) => (
        <a
          key={f}
          href={`#floor-${f}`}
          className="plate flex size-10 shrink-0 items-center justify-center border border-border bg-surface text-base font-bold active:bg-background"
        >
          {f}
        </a>
      ))}
    </nav>
  );
}
