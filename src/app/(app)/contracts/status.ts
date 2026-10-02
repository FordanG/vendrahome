import type { Tone } from "@/components/ui";

export const CONTRACT_STATUS_TONES: Record<"draft" | "active" | "ended" | "terminated", Tone> = {
  draft: "gray",
  active: "green",
  ended: "blue",
  terminated: "red",
};

export const CONTRACT_STATUS_LABELS = {
  draft: "Draft, not started",
  active: "Active",
  ended: "Ended",
  terminated: "Ended early",
} as const;
