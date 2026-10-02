import { addMonthsISO, daysBetween } from "./format";

type Step = { startMonth: number; kind: "amount" | "percent"; value: number; note?: string | null };

export type RentPeriod = {
  fromMonth: number;
  toMonth: number;
  fromDate: string;
  toDate: string;
  monthly: number;
  note: string | null;
};

/** Number of contract months between start and end (a partial month counts as one). */
export function contractMonths(startDate: string, endDate: string): number {
  let months = 0;
  while (addMonthsISO(startDate, months) <= endDate) months++;
  return Math.max(months, 1);
}

/** Month number (1-based) that `date` falls in, or null if outside the contract. */
export function contractMonthOf(startDate: string, endDate: string, date: string): number | null {
  if (date < startDate || date > endDate) return null;
  let m = 0;
  while (addMonthsISO(startDate, m + 1) <= date) m++;
  return m + 1;
}

/**
 * Monthly rent for each contract month. Steps apply in order of startMonth:
 * an amount step sets the rent; a percent step raises the current rent
 * by value basis points (500 = 5%), compounding on earlier steps.
 */
export function rentForMonth(base: number, steps: Step[], month: number): number {
  let rent = base;
  for (const s of [...steps].sort((a, b) => a.startMonth - b.startMonth)) {
    if (s.startMonth > month) break;
    rent = s.kind === "amount" ? s.value : Math.round((rent * (10_000 + s.value)) / 10_000);
  }
  return rent;
}

/** Collapses the contract into periods where the monthly rent is the same. */
export function rentSchedule(
  base: number,
  steps: Step[],
  startDate: string,
  endDate: string,
): RentPeriod[] {
  const total = contractMonths(startDate, endDate);
  const periods: RentPeriod[] = [];
  const stepAt = new Map(steps.map((s) => [s.startMonth, s]));
  for (let m = 1; m <= total; m++) {
    const monthly = rentForMonth(base, steps, m);
    const last = periods.at(-1);
    if (last && last.monthly === monthly && !stepAt.has(m)) {
      last.toMonth = m;
      continue;
    }
    periods.push({
      fromMonth: m,
      toMonth: m,
      fromDate: addMonthsISO(startDate, m - 1),
      toDate: "",
      monthly,
      note: stepAt.get(m)?.note ?? null,
    });
  }
  for (const p of periods) {
    const periodEnd = dayBefore(addMonthsISO(startDate, p.toMonth));
    p.toDate = periodEnd > endDate ? endDate : periodEnd;
  }
  return periods;
}

function dayBefore(iso: string): string {
  const t = Date.parse(iso + "T00:00:00Z") - 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function contractTotal(periods: RentPeriod[]): number {
  return periods.reduce((sum, p) => sum + p.monthly * (p.toMonth - p.fromMonth + 1), 0);
}

export function daysLeft(today: string, endDate: string) {
  return daysBetween(today, endDate);
}
