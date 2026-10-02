import { asc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { getRoomOptions } from "@/lib/assignments";
import { ActionForm } from "@/components/action-form";
import { Card, PageHeader, SectionTitle } from "@/components/ui";
import { createOccupant } from "../actions";
import { OccupantFields, StayFields } from "../occupant-fields";

export default async function NewOccupantPage({ searchParams }: PageProps<"/occupants/new">) {
  await requireStaff(CAN.manageOccupants);
  const { room, client } = await searchParams;
  const db = await getDb();
  const [clients, rooms] = await Promise.all([
    db.select({ id: schema.clients.id, name: schema.clients.name }).from(schema.clients).orderBy(asc(schema.clients.name)),
    getRoomOptions(),
  ]);

  return (
    <>
      <PageHeader back={{ href: "/occupants", label: "Tenants" }} title="Add tenant" />
      <ActionForm action={createOccupant} submitLabel="Save tenant" className="max-w-3xl space-y-6">
        <Card>
          <SectionTitle>Room assignment</SectionTitle>
          <StayFields rooms={rooms} defaultRoomId={typeof room === "string" ? room : undefined} optional />
        </Card>
        <Card>
          <SectionTitle>Personal details</SectionTitle>
          <OccupantFields clients={clients} defaultClientId={typeof client === "string" ? client : undefined} />
        </Card>
      </ActionForm>
    </>
  );
}
