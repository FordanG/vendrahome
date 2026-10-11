import { and, asc, eq, gte, inArray, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN } from "@/lib/auth";
import { requireHotel } from "@/lib/hotel";
import { addDaysISO, formatDate, todayISO } from "@/lib/format";
import { PrintButton } from "@/components/print-button";
import { Empty, PageHeader } from "@/components/ui";

/** A printed list that goes with the bags: the shop fills in the kilos and signs. */
export default async function HandoffPage() {
  const { hotel } = await requireHotel(CAN.handleLaundry);
  const today = todayISO();
  const db = await getDb();
  // Bags still at the desk, plus any sent to the shop today.
  const rows = await db
    .select({ l: schema.laundryLoads, roomNumber: schema.rooms.number, service: schema.laundryServices.name, name: schema.occupants.fullName })
    .from(schema.laundryLoads)
    .innerJoin(schema.laundryServices, eq(schema.laundryLoads.serviceId, schema.laundryServices.id))
    .innerJoin(schema.occupants, eq(schema.laundryLoads.occupantId, schema.occupants.id))
    .leftJoin(schema.rooms, eq(schema.laundryLoads.roomId, schema.rooms.id))
    .where(
      and(
        eq(schema.laundryServices.propertyId, hotel.id),
        or(
          eq(schema.laundryLoads.status, "at_desk"),
          and(inArray(schema.laundryLoads.status, ["at_shop"]), gte(schema.laundryLoads.sentAt, new Date(addDaysISO(today, -1) + "T16:00:00Z"))),
        ),
      ),
    )
    .orderBy(asc(schema.rooms.number), asc(schema.laundryLoads.number));
  const bags = rows.reduce((n, r) => n + r.l.bags, 0);

  return (
    <>
      <PageHeader
        back={{ href: "/laundry", label: "Laundry" }}
        title="Laundry for the shop"
        subtitle={`${formatDate(today)}. ${rows.length} ${rows.length === 1 ? "load" : "loads"}, ${bags} ${bags === 1 ? "bag" : "bags"}. Bags still at the desk and any sent today.`}
        actions={rows.length > 0 && <PrintButton label="Print" />}
      />
      {rows.length === 0 ? (
        <Empty>No bags to hand over.</Empty>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-foreground text-left">
              <th className="py-2 pr-3">Load</th>
              <th className="py-2 pr-3">Room</th>
              <th className="py-2 pr-3">Name</th>
              <th className="py-2 pr-3">Bags</th>
              <th className="py-2 pr-3">Service</th>
              <th className="w-24 py-2">Kilos</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.l.id} className="border-b border-border align-top">
                <td className="plate py-2 pr-3 font-bold">{r.l.number}</td>
                <td className="py-2 pr-3">{r.roomNumber ?? "?"}</td>
                <td className="py-2 pr-3">{r.name.split(/\s+/)[0]}</td>
                <td className="py-2 pr-3">{r.l.bags}</td>
                <td className="py-2 pr-3">
                  {r.service}
                  {r.l.notes && <span className="block text-xs">{r.l.notes}</span>}
                </td>
                <td className="py-2" />
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rows.length > 0 && (
        <div className="mt-10 grid grid-cols-2 gap-10 text-sm">
          <p className="border-t border-foreground pt-1">Handed over by (hotel)</p>
          <p className="border-t border-foreground pt-1">Received by (shop), date</p>
        </div>
      )}
    </>
  );
}
