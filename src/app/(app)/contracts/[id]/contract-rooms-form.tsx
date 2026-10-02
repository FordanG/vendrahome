"use client";

import { startTransition, useActionState, useState } from "react";
import type { ActionState } from "@/lib/action-state";
import { Button, Input } from "@/components/ui";

type Row = { id: string; number: string; floor: number; rate: string; people: number; capacity: number };

export function ContractRoomsForm({
  rows,
  perRoom,
  canManage,
  action,
}: {
  rows: Row[];
  perRoom: boolean;
  canManage: boolean;
  action: (state: ActionState, fd: FormData) => Promise<ActionState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const allPicked = rows.length > 0 && rows.every((r) => picked.has(r.id));
  const toggle = (id: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        startTransition(() => formAction(fd));
      }}
    >
      {canManage && (
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <span className="py-2 text-muted">{picked.size} ticked</span>
          {perRoom && (
            <>
              <Input name="monthlyRate" inputMode="decimal" placeholder="Monthly rate ₱" className="w-40" />
              <Button type="submit" name="intent" value="rate" variant="secondary" disabled={pending || picked.size === 0}>
                Set rate
              </Button>
            </>
          )}
          <Button
            type="submit"
            name="intent"
            value="remove"
            variant="danger"
            disabled={pending || picked.size === 0}
            onClick={(e) => {
              if (!window.confirm(`Remove ${picked.size} room(s) from this contract?`)) e.preventDefault();
            }}
          >
            Remove from contract
          </Button>
          {state.error && <p className="w-full text-attention">{state.error}</p>}
          {state.ok && <p className="w-full text-accent">{state.ok}</p>}
        </div>
      )}
      <div className="max-h-[28rem] overflow-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-surface">
            <tr className="bg-background/60 text-xs text-muted">
              {canManage && (
                <th className="border-b border-border px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Tick all rooms"
                    checked={allPicked}
                    onChange={(e) => setPicked(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                  />
                </th>
              )}
              <th className="border-b border-border px-3 py-2">Room</th>
              <th className="border-b border-border px-3 py-2">Floor</th>
              <th className="border-b border-border px-3 py-2">Beds</th>
              {perRoom && <th className="border-b border-border px-3 py-2">Monthly rate</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {canManage && (
                  <td className="border-b border-border px-3 py-1.5">
                    <input
                      type="checkbox"
                      name="contractRoomIds"
                      value={r.id}
                      checked={picked.has(r.id)}
                      onChange={(e) => toggle(r.id, e.target.checked)}
                    />
                  </td>
                )}
                <td className="border-b border-border px-3 py-1.5 font-medium">Room {r.number}</td>
                <td className="border-b border-border px-3 py-1.5">{r.floor}</td>
                <td className="border-b border-border px-3 py-1.5">
                  {r.people} of {r.capacity} taken
                </td>
                {perRoom && (
                  <td className={`border-b border-border px-3 py-1.5 ${r.rate ? "" : "text-attention"}`}>
                    {r.rate || "No rate yet"}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </form>
  );
}
