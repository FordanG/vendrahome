import type { Tone } from "@/components/ui";

export type RoomStatus = "occupied" | "contracted_empty" | "vacant" | "needs_work" | "not_available";

// Plain words staff and owners understand at a glance.
export const STATUS_LABELS: Record<RoomStatus, string> = {
  occupied: "Occupied",
  contracted_empty: "Leased, no one in",
  vacant: "Available",
  needs_work: "Needs attention",
  not_available: "Out of service",
};

/** One-line explanation of each status, for legends and hints. */
export const STATUS_HELP: Record<RoomStatus, string> = {
  occupied: "Someone lives here now.",
  contracted_empty: "Leased to a company, but no one has moved in.",
  vacant: "Not leased. Ready for a new contract.",
  needs_work: "Has an open problem report or maintenance request, or staff marked it for repair or cleaning.",
  not_available: "Closed. No one can be assigned here.",
};

export const STATUS_TONES: Record<RoomStatus, Tone> = {
  occupied: "green",
  contracted_empty: "blue",
  vacant: "gray",
  needs_work: "amber",
  not_available: "red",
};

export const CONDITION_LABELS = {
  ready: "Ready",
  needs_work: "Needs attention (repair or cleaning)",
  not_available: "Out of service",
} as const;
