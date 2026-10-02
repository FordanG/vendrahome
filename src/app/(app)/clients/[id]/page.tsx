import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Detail, Empty, LinkButton, PageHeader, SectionTitle, Table, Td, Th } from "@/components/ui";
import { updateClient } from "../actions";
import { ClientFields } from "../client-fields";
import { CONTRACT_STATUS_LABELS, CONTRACT_STATUS_TONES } from "../../contracts/status";

export default async function ClientPage({ params }: PageProps<"/clients/[id]">) {
  const user = await requireStaff(CAN.viewClients);
  const { id } = await params;
  const db = await getDb();
  const client = await db.query.clients.findFirst({ where: eq(schema.clients.id, id) });
  if (!client) notFound();

  const [contracts, people] = await Promise.all([
    db.select().from(schema.contracts).where(eq(schema.contracts.clientId, id)).orderBy(desc(schema.contracts.startDate)),
    db
      .select({ id: schema.occupants.id })
      .from(schema.occupants)
      .where(and(eq(schema.occupants.clientId, id), eq(schema.occupants.status, "active"))),
  ]);
  const canManage = CAN.manageContracts.includes(user.role);

  return (
    <>
      <PageHeader
        back={{ href: "/clients", label: "Companies" }}
        title={client.name}
        subtitle={`${people.length} ${people.length === 1 ? "tenant" : "tenants"} living here now`}
        actions={
          <>
            <LinkButton variant="secondary" href={`/occupants?client=${client.id}`}>
              See their tenants
            </LinkButton>
            {canManage && <LinkButton href={`/contracts/new?client=${client.id}`}>New contract</LinkButton>}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div>
            <SectionTitle>Contracts</SectionTitle>
            {contracts.length === 0 ? (
              <Empty>No contracts with this company yet.</Empty>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Contract</Th>
                    <Th>Dates</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {contracts.map((c) => (
                    <tr key={c.id}>
                      <Td primary>
                        <Link className="font-medium underline" href={`/contracts/${c.id}`}>
                          {c.reference}
                        </Link>
                      </Td>
                      <Td label="Dates" wide>
                        {formatDate(c.startDate)} – {formatDate(c.endDate)}
                      </Td>
                      <Td label="Status">
                        <Badge tone={CONTRACT_STATUS_TONES[c.status]}>{CONTRACT_STATUS_LABELS[c.status]}</Badge>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </div>
        </div>
        <Card>
          <SectionTitle>Company details</SectionTitle>
          {canManage ? (
            <ActionForm action={updateClient.bind(null, client.id)}>
              <ClientFields client={client} />
            </ActionForm>
          ) : (
            <dl className="space-y-3">
              <Detail label="TIN (tax number)">{client.tin}</Detail>
              <Detail label="Address">{client.address}</Detail>
              <Detail label="Contact person">{client.contactName}</Detail>
              <Detail label="Mobile">{client.contactPhone}</Detail>
              <Detail label="Email">{client.contactEmail}</Detail>
              <Detail label="Notes" empty="None">{client.notes}</Detail>
            </dl>
          )}
        </Card>
      </div>
    </>
  );
}
