import { asc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { qrSvg, roomScanUrl } from "@/lib/room-qr";
import { PrintButton } from "@/components/print-button";
import { Field, PageHeader } from "@/components/ui";
import { AutoSubmitSelect } from "@/components/auto-submit";

/** Door codes ready to print and stick on each door: one room, a floor, or every room. */
export default async function DoorCodesPage({ searchParams }: PageProps<"/rooms/door-codes">) {
  await requireStaff(CAN.printDoorCodes);
  const { room: roomId, floor } = await searchParams;
  const db = await getDb();
  const all = await db.select().from(schema.rooms).orderBy(asc(schema.rooms.floor), asc(schema.rooms.number));
  const floors = [...new Set(all.map((r) => r.floor))];
  const rooms =
    typeof roomId === "string" ? all.filter((r) => r.id === roomId)
    : typeof floor === "string" && floor ? all.filter((r) => String(r.floor) === floor)
    : all;
  const codes = await Promise.all(rooms.map(async (r) => ({ room: r, svg: await qrSvg(await roomScanUrl(r.qrToken)) })));
  const single = rooms.length === 1 ? rooms[0] : null;

  return (
    <>
      <div className="no-print">
        <PageHeader
          back={single ? { href: `/rooms/${single.id}`, label: `Room ${single.number}` } : { href: "/rooms", label: "Rooms" }}
          title={single ? `Door code for Room ${single.number}` : "Door codes"}
          subtitle="Print and stick each code on its room's door. Tenants scan it to ask for help; staff scan it to check in."
          actions={<PrintButton label={single ? "Print code" : `Print ${codes.length} codes`} />}
        />
        {!single && (
          <form className="mb-6 max-w-xs">
            <Field label="Rooms">
              <AutoSubmitSelect name="floor" defaultValue={typeof floor === "string" ? floor : ""}>
                <option value="">Every room</option>
                {floors.map((f) => (
                  <option key={f} value={f}>
                    Floor {f}
                  </option>
                ))}
              </AutoSubmitSelect>
            </Field>
          </form>
        )}
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 print:grid-cols-3 print:gap-6">
        {codes.map(({ room, svg }) => (
          <figure key={room.id} className="flex break-inside-avoid flex-col items-center border-2 border-black bg-white p-3 text-black">
            <div className="w-full max-w-48" dangerouslySetInnerHTML={{ __html: svg }} />
            <figcaption className="mt-1 text-center">
              <span className="plate block text-3xl font-bold leading-none">{room.number}</span>
              <span className="mt-1 block text-xs">Scan for help with this room</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </>
  );
}
