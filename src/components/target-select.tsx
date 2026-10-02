import { Select } from "./ui";

/** Picks everyone, one floor or one room. Read it with parseTarget(). */
export function TargetSelect({
  rooms,
  name = "target",
  allLabel = "Everyone",
}: {
  rooms: { id: string; number: string; floor: number }[];
  name?: string;
  allLabel?: string;
}) {
  const floors = [...new Set(rooms.map((r) => r.floor))].sort((a, b) => a - b);
  return (
    <Select name={name} defaultValue="all">
      <option value="all">{allLabel}</option>
      <optgroup label="Floor">
        {floors.map((f) => (
          <option key={f} value={`floor:${f}`}>
            Floor {f}
          </option>
        ))}
      </optgroup>
      <optgroup label="Room">
        {rooms.map((r) => (
          <option key={r.id} value={`room:${r.id}`}>
            Room {r.number}
          </option>
        ))}
      </optgroup>
    </Select>
  );
}
