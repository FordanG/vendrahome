import { formatDate, stayRange, todayISO } from "@/lib/format";
import { Badge } from "./ui";

/**
 * One stay in plain words, used wherever stays are listed:
 * "Since Aug 1, 2026 · Living here now", "Aug 1 – Sep 30, 2026", "Moves in Oct 2, 2026".
 */
export function StayCell({
  checkIn,
  actualCheckOut,
  expectedCheckOut,
}: {
  checkIn: string;
  actualCheckOut: string | null;
  expectedCheckOut: string | null;
}) {
  const today = todayISO();
  if (!actualCheckOut && checkIn > today) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span>Moves in {formatDate(checkIn)}</span>
        <Badge tone="blue">Coming soon</Badge>
      </div>
    );
  }
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span>{stayRange(checkIn, actualCheckOut)}</span>
        {!actualCheckOut && <Badge tone="green">Living here now</Badge>}
      </div>
      {!actualCheckOut && expectedCheckOut && (
        <p className="mt-0.5 text-xs text-muted">Expected to move out {formatDate(expectedCheckOut)}</p>
      )}
    </div>
  );
}
