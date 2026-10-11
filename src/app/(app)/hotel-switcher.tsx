import type { Property } from "@/db/schema";
import { AutoSubmitSelect } from "@/components/auto-submit";
import { switchHotel } from "../hotel-actions";

/** For the owner: which hotel the pages show. Applies as soon as one is picked. */
export function HotelSwitcher({ hotels, current, className, dark }: { hotels: Property[]; current: string; className?: string; dark?: boolean }) {
  return (
    <form action={switchHotel} className={className}>
      <label className={`mb-1 block text-xs ${dark ? "text-sidebar-muted" : "text-muted"}`} htmlFor={dark ? "hotel-side" : "hotel-more"}>
        Hotel
      </label>
      <AutoSubmitSelect
        id={dark ? "hotel-side" : "hotel-more"}
        name="hotel"
        defaultValue={current}
        className={dark ? "w-full border-white/20 bg-white/10 text-sidebar-foreground" : "w-full"}
      >
        {hotels.map((h) => (
          <option key={h.id} value={h.id} className="text-foreground">
            {h.name}
          </option>
        ))}
      </AutoSubmitSelect>
    </form>
  );
}
