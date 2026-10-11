import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN } from "@/lib/auth";
import { requireHotel, roomInReach } from "@/lib/hotel";
import { ActionForm } from "@/components/action-form";
import { Card, FormGrid, Input, SectionTitle } from "@/components/ui";
import { addArea, updateArea } from "./actions";
import { qrSvg, roomScanUrl } from "@/lib/room-qr";
import { PrintButton } from "@/components/print-button";
import { Field, PageHeader } from "@/components/ui";
import { AutoSubmitSelect } from "@/components/auto-submit";

/** Door codes ready to print and stick on each door: one room, a floor, or every room. */
export default async function DoorCodesPage({ searchParams }: PageProps<"/rooms/door-codes">) {
  const { user, hotel: viewed } = await requireHotel(CAN.printDoorCodes);
  const canManageAreas = CAN.manageAreas.includes(user.role);
  const { room: roomId, floor } = await searchParams;
  const db = await getDb();
  // One room's code opens in that room's own hotel, even when the owner is looking at another.
  const picked = typeof roomId === "string" ? await roomInReach(user, roomId) : null;
  const hotelId = picked?.propertyId ?? viewed.id;
  const all = await db.select().from(schema.rooms).where(eq(schema.rooms.propertyId, hotelId)).orderBy(asc(schema.rooms.floor), asc(schema.rooms.number));
  const floors = [...new Set(all.map((r) => r.floor))];
  const rooms =
    typeof roomId === "string" ? all.filter((r) => r.id === roomId)
    : typeof floor === "string" && floor && floor !== "areas" ? all.filter((r) => String(r.floor) === floor)
    : all;
  const allAreas = await db.select().from(schema.areas).where(eq(schema.areas.propertyId, hotelId)).orderBy(asc(schema.areas.name));
  const showAreas = floor === "areas";
  const areaUrls = new Map(await Promise.all(allAreas.map(async (a) => [a.id, await roomScanUrl(a.qrToken)] as const)));
  const shown = showAreas
    ? allAreas.filter((a) => a.active).map((a) => ({ id: a.id, big: a.name, token: a.qrToken, caption: a.floor != null ? `Floor ${a.floor}. Scan to report a problem here` : "Scan to report a problem here" }))
    : rooms.map((r) => ({ id: r.id, big: r.number, token: r.qrToken, caption: "Scan for help with this room" }));
  const codes = await Promise.all(shown.map(async (c) => ({ ...c, svg: await qrSvg(await roomScanUrl(c.token)) })));
  const single = typeof roomId === "string" && rooms.length === 1 ? rooms[0] : null;

  return (
    <>
      <div className="no-print">
        <PageHeader
          back={single ? { href: `/rooms/${single.id}`, label: `Room ${single.number}` } : { href: "/rooms", label: "Rooms" }}
          title={single ? `Door code for Room ${single.number}` : "Door codes"}
          subtitle="Print and stick each code on its room's door. Tenants scan it to ask for help; staff scan it to check in."
          actions={codes.length > 0 && <PrintButton label={single ? "Print code" : `Print ${codes.length} codes`} />}
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
                {allAreas.some((a) => a.active) && <option value="areas">Shared spaces</option>}
              </AutoSubmitSelect>
            </Field>
          </form>
        )}
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 print:grid-cols-3 print:gap-6">
        {codes.map(({ id, big, caption, svg }) => (
          <figure key={id} className="flex break-inside-avoid flex-col items-center border-2 border-black bg-white p-3 text-black">
            <div className="w-full max-w-48" dangerouslySetInnerHTML={{ __html: svg }} />
            <figcaption className="mt-1 text-center">
              <span className={`plate block font-bold leading-none ${showAreas ? "text-xl" : "text-3xl"}`}>{big}</span>
              <span className="mt-1 block text-xs">{caption}</span>
            </figcaption>
          </figure>
        ))}
      </div>

      {canManageAreas && !single && (
        <Card className="no-print mt-8">
          <SectionTitle>Shared spaces</SectionTitle>
          <p className="mb-4 text-sm text-muted">
            Places that aren&apos;t rooms, like the kitchen, laundry area or hallways. Tenants who scan their code can report a problem there.
            To print them, pick Shared spaces above.
          </p>
          {allAreas.length > 0 && (
            <ul className="mb-5 divide-y divide-border border-y border-border">
              {allAreas.map((a) => (
                <li key={a.id} className="py-2">
                  <details>
                    <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm sm:min-h-0">
                      <span className="font-medium">{a.name}</span>
                      <span className="text-muted">{[a.floor != null && `Floor ${a.floor}`, !a.active && "Code turned off"].filter(Boolean).join(", ")}</span>
                    </summary>
                    <p className="mt-2 text-xs text-muted">
                      Its address is <a className="break-all underline" href={areaUrls.get(a.id)}>{areaUrls.get(a.id)}</a>
                    </p>
                    <ActionForm action={updateArea.bind(null, a.id)} className="mt-3 space-y-3">
                      <FormGrid>
                        <Field label="Name"><Input name="name" defaultValue={a.name} required /></Field>
                        <Field label="Floor" hint="Blank if it isn't on one floor"><Input name="floor" type="number" defaultValue={a.floor ?? ""} className="w-24" /></Field>
                      </FormGrid>
                      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={a.active} /> Code works</label>
                      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="newCode" /> Make a new code (the printed one stops working)</label>
                    </ActionForm>
                  </details>
                </li>
              ))}
            </ul>
          )}
          <ActionForm action={addArea} submitLabel="Add place" resetOnSuccess className="space-y-3">
            <FormGrid>
              <Field label="Name" hint="e.g. Kitchen, 2nd floor"><Input name="name" required /></Field>
              <Field label="Floor" hint="Blank if it isn't on one floor"><Input name="floor" type="number" className="w-24" /></Field>
            </FormGrid>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
