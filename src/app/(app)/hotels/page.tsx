import { notFound } from "next/navigation";
import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { STAFF_ROLES } from "@/lib/auth";
import { isOwner, requireHotel } from "@/lib/hotel";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Field, FormGrid, Input, PageHeader, SectionTitle } from "@/components/ui";
import type { Property } from "@/db/schema";
import { switchHotel } from "../../hotel-actions";
import { createHotel, updateHotel } from "./actions";

function HotelFields({ hotel }: { hotel?: Property }) {
  return (
    <FormGrid>
      <Field label="Name" className="sm:col-span-2">
        <Input name="name" defaultValue={hotel?.name} required maxLength={100} />
      </Field>
      <Field label="Address" className="sm:col-span-2">
        <Input name="address" defaultValue={hotel?.address ?? ""} />
      </Field>
      <Field label="Phone">
        <Input name="phone" type="tel" defaultValue={hotel?.phone ?? ""} />
      </Field>
    </FormGrid>
  );
}

/** The owner's list of hotels. Each hotel's rooms, staff and records are kept apart. */
export default async function HotelsPage() {
  const { user, hotel: current, hotels } = await requireHotel(["admin"]);
  if (!isOwner(user)) notFound();
  const db = await getDb();
  const [rooms, staff, living] = await Promise.all([
    db.select({ id: schema.rooms.propertyId, n: count() }).from(schema.rooms).groupBy(schema.rooms.propertyId),
    db
      .select({ id: schema.staff.propertyId, n: count() })
      .from(schema.staff)
      .where(and(inArray(schema.staff.role, STAFF_ROLES), eq(schema.staff.active, true)))
      .groupBy(schema.staff.propertyId),
    db
      .select({ id: schema.rooms.propertyId, n: count() })
      .from(schema.roomAssignments)
      .innerJoin(schema.rooms, eq(schema.roomAssignments.roomId, schema.rooms.id))
      .where(isNull(schema.roomAssignments.actualCheckOut))
      .groupBy(schema.rooms.propertyId),
  ]);
  const n = (list: { id: string | null; n: number }[], id: string) => list.find((x) => x.id === id)?.n ?? 0;

  return (
    <>
      <PageHeader title="Hotels" subtitle="Each hotel has its own rooms, staff, contracts, billing and laundry. Companies, room types and checklists are shared." />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-3 lg:col-span-2">
          {hotels.map((h) => (
            <Card key={h.id}>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="plate text-lg font-bold">{h.name}</h2>
                {h.id === current.id && <Badge tone="green">Looking at it now</Badge>}
              </div>
              <p className="mt-1 text-sm text-muted">
                {n(rooms, h.id)} rooms, {n(living, h.id)} tenants, {n(staff, h.id)} staff
                {h.address && `. ${h.address}`}
              </p>
              <div className="mt-3 flex flex-wrap items-start gap-3">
                {h.id !== current.id && (
                  <form action={switchHotel}>
                    <input type="hidden" name="hotel" value={h.id} />
                    <button className="min-h-11 rounded-md border border-border bg-surface px-4 text-sm font-medium hover:bg-background sm:min-h-0 sm:py-2">
                      Look at this hotel
                    </button>
                  </form>
                )}
                <details className="min-w-0 flex-1">
                  <summary className="cursor-pointer py-2 text-sm underline underline-offset-2">Edit details</summary>
                  <ActionForm action={updateHotel.bind(null, h.id)} className="mt-3 space-y-4">
                    <HotelFields hotel={h} />
                  </ActionForm>
                </details>
              </div>
            </Card>
          ))}
        </div>
        <Card className="self-start">
          <SectionTitle>Add a hotel</SectionTitle>
          <ActionForm action={createHotel} submitLabel="Add hotel" resetOnSuccess>
            <HotelFields />
            <p className="text-sm text-muted">Rooms can be made now and renumbered later, or added one by one on the Rooms page.</p>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Floors" hint="Optional">
                <Input name="floors" type="number" min={0} max={60} />
              </Field>
              <Field label="Rooms per floor" hint="Optional">
                <Input name="roomsPerFloor" type="number" min={0} max={99} />
              </Field>
            </div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
