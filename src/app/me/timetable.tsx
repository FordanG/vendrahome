import { formatTimeRange } from "@/lib/format";
import { daysLabel, groupByDays } from "@/lib/portal";
import type { ScheduleEntry } from "@/db/schema";

/** A week of time slots, with slots that repeat across days shown once. */
export function Timetable({ entries, today }: { entries: ScheduleEntry[]; today: number }) {
  if (entries.length === 0) return <p className="text-sm text-muted">No times set yet.</p>;
  const groups = groupByDays(entries);
  return (
    <ul className="divide-y divide-border text-sm">
      {groups.map((g) => (
        <li key={g.first.id} className="flex items-start justify-between gap-4 py-2.5">
          <div className="min-w-0">
            <p className="font-medium">
              {daysLabel(g.days)}
              {g.days.includes(today) && g.days.length < 7 && <span className="ml-2 text-xs font-normal text-brand-ink">Today</span>}
            </p>
            {g.first.note && <p className="text-muted">{g.first.note}</p>}
          </div>
          <span className="plate shrink-0 text-base font-bold">{formatTimeRange(g.first.startTime, g.first.endTime)}</span>
        </li>
      ))}
    </ul>
  );
}

/** ISO weekday (1 = Monday) for a YYYY-MM-DD date. */
export function isoWeekday(iso: string): number {
  return new Date(iso + "T00:00:00Z").getUTCDay() || 7;
}
