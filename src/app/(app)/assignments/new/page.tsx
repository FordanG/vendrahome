import Link from "next/link";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN } from "@/lib/auth";
import { requireHotel } from "@/lib/hotel";
import { getRoomOptions } from "@/lib/assignments";
import { ActionForm } from "@/components/action-form";
import { Card, Field, PageHeader, Select } from "@/components/ui";
import { assignPickedOccupant } from "../../occupants/actions";
import { StayFields } from "../../occupants/occupant-fields";

export default async function NewAssignmentPage({ searchParams }: PageProps<"/assignments/new">) {
  const { hotel } = await requireHotel(CAN.manageOccupants);
  const { room } = await searchParams;
  const roomId = typeof room === "string" ? room : undefined;
  const db = await getDb();
  const [people, rooms] = await Promise.all([
    db
      .select({ id: schema.occupants.id, fullName: schema.occupants.fullName, employeeId: schema.occupants.employeeId })
      .from(schema.occupants)
      .leftJoin(
        schema.roomAssignments,
        and(eq(schema.roomAssignments.occupantId, schema.occupants.id), isNull(schema.roomAssignments.actualCheckOut)),
      )
      .where(and(isNull(schema.roomAssignments.id), or(eq(schema.occupants.propertyId, hotel.id), isNull(schema.occupants.propertyId))))
      .orderBy(asc(schema.occupants.fullName)),
    getRoomOptions(hotel.id),
  ]);

  return (
    <>
      <PageHeader back={{ href: "/assignments", label: "Room assignments" }} title="Give a tenant a room" />
      <Card className="max-w-3xl">
        <p className="mb-4 text-sm text-muted">
          Pick a tenant who is already on file but has no room.{" "}
          <Link className="underline" href={`/occupants/new${roomId ? `?room=${roomId}` : ""}`}>
            Add a new tenant instead
          </Link>
          .
        </p>
        <ActionForm action={assignPickedOccupant} submitLabel="Give room">
          <Field label="Tenant">
            <Select name="occupantId" defaultValue="" required>
              <option value="">Pick a tenant</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName}
                  {p.employeeId ? ` (employee ID ${p.employeeId})` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <StayFields rooms={rooms} defaultRoomId={roomId} />
        </ActionForm>
      </Card>
    </>
  );
}
