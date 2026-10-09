// Shared formatting and parsing. Safe on server and client.

const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });

export const formatPeso = (centavos: number) => peso.format(centavos / 100);

/** "12,500.50" -> 1250050. Returns null for blank or invalid input. */
export function parsePeso(input: FormDataEntryValue | null): number | null {
  if (typeof input !== "string") return null;
  const cleaned = input.replace(/[₱,\s]/g, "");
  if (cleaned === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  const amount = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(amount) ? amount : null;
}

export const centavosToInput = (centavos: number | null | undefined) =>
  centavos == null ? "" : (centavos / 100).toFixed(2);

/** Today's date in Manila as YYYY-MM-DD. */
export function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "Not set";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.parse(fromISO + "T00:00:00Z");
  const b = Date.parse(toISO + "T00:00:00Z");
  return Math.round((b - a) / 86_400_000);
}

export function addMonthsISO(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Blank strings become null so optional columns stay empty. */
export function str(input: FormDataEntryValue | null): string | null {
  if (typeof input !== "string") return null;
  const v = input.trim();
  return v === "" ? null : v;
}

export function isISODate(v: string | null): v is string {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v) || v < "1900-01-01" || v > "2199-12-31") return false;
  const date = new Date(v + "T00:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === v;
}

export function addDaysISO(iso: string, days: number): string {
  return new Date(Date.parse(iso + "T00:00:00Z") + days * 86_400_000).toISOString().slice(0, 10);
}

/** "14:30" -> "2:30 PM". Returns the input unchanged if it isn't HH:MM. */
export function formatTime(hhmm: string | null | undefined): string {
  if (!hhmm) return "";
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

const manilaClock = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" });
const manilaDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" });

/** A moment as Manila time: "10:42 AM" today, "Oct 8, 2026, 10:42 AM" on another day. */
export function formatMoment(at: Date): string {
  const day = manilaDay.format(at);
  const time = manilaClock.format(at);
  return day === todayISO() ? time : `${formatDate(day)}, ${time}`;
}

export function formatTimeRange(from: string | null | undefined, to: string | null | undefined): string {
  if (from && to) return `${formatTime(from)} – ${formatTime(to)}`;
  if (from) return `from ${formatTime(from)}`;
  if (to) return `until ${formatTime(to)}`;
  return "";
}

export const isHHMM = (v: string | null): v is string => !!v && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

/** "2 of 3 beds taken", "1 bed free". */
export const bedsTaken = (taken: number, capacity: number) => `${taken} of ${capacity} ${capacity === 1 ? "bed" : "beds"} taken`;
export const bedsFree = (free: number) => (free <= 0 ? "Full" : `${free} ${free === 1 ? "bed" : "beds"} free`);

/** A stay as one phrase: "Since Aug 1, 2026" or "Aug 1 – Sep 30, 2026". */
export function stayRange(checkIn: string, checkOut: string | null | undefined): string {
  return checkOut ? `${formatDate(checkIn)} – ${formatDate(checkOut)}` : `Since ${formatDate(checkIn)}`;
}
