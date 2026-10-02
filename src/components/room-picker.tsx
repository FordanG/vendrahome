"use client";

import { useState } from "react";

type PickRoom = { id: string; label: string; floor: number; note?: string };

/** Checkbox grid of rooms grouped by floor, with select-all per floor. */
export function RoomPicker({ rooms, name }: { rooms: PickRoom[]; name: string }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const floors = [...new Set(rooms.map((r) => r.floor))];
  const toggle = (ids: string[], on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });

  if (rooms.length === 0) return <p className="text-sm text-muted">No rooms to pick.</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted">{picked.size} selected</span>
        <button type="button" className="underline" onClick={() => toggle(rooms.map((r) => r.id), true)}>
          Select all
        </button>
        <button type="button" className="underline" onClick={() => setPicked(new Set())}>
          Clear
        </button>
      </div>
      {floors.map((f) => {
        const onFloor = rooms.filter((r) => r.floor === f);
        const all = onFloor.every((r) => picked.has(r.id));
        return (
          <div key={f}>
            <label className="mb-1 flex items-center gap-2 text-xs font-medium text-muted">
              <input type="checkbox" checked={all} onChange={(e) => toggle(onFloor.map((r) => r.id), e.target.checked)} />
              Floor {f}
            </label>
            <div className="flex flex-wrap gap-1.5">
              {onFloor.map((r) => (
                <label
                  key={r.id}
                  title={r.note}
                  className={`flex min-h-10 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm sm:min-h-0 sm:px-2 ${
                    picked.has(r.id) ? "border-accent bg-accent/10" : "border-border"
                  }`}
                >
                  <input
                    type="checkbox"
                    name={name}
                    value={r.id}
                    checked={picked.has(r.id)}
                    onChange={(e) => toggle([r.id], e.target.checked)}
                  />
                  {r.label}
                  {r.note && <span className="text-xs text-muted">{r.note}</span>}
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
