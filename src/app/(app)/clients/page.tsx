import Link from "next/link";
import { asc, count, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { Empty, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";

export default async function ClientsPage() {
  const user = await requireStaff(CAN.viewClients);
  const db = await getDb();
  const [clients, contractCounts, occupantCounts] = await Promise.all([
    db.select().from(schema.clients).orderBy(asc(schema.clients.name)),
    db
      .select({ clientId: schema.contracts.clientId, n: count() })
      .from(schema.contracts)
      .where(eq(schema.contracts.status, "active"))
      .groupBy(schema.contracts.clientId),
    db
      .select({ clientId: schema.occupants.clientId, n: count() })
      .from(schema.occupants)
      .where(eq(schema.occupants.status, "active"))
      .groupBy(schema.occupants.clientId),
  ]);
  const contractsBy = new Map(contractCounts.map((c) => [c.clientId, c.n]));
  const peopleBy = new Map(occupantCounts.map((c) => [c.clientId, c.n]));

  return (
    <>
      <PageHeader
        title="Companies"
        subtitle="Companies that lease rooms for their people"
        actions={CAN.manageContracts.includes(user.role) && <LinkButton href="/clients/new">Add company</LinkButton>}
      />
      {clients.length === 0 ? (
        <Empty>No companies yet. Add the company leasing the rooms to get started.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Company</Th>
              <Th>Contact person</Th>
              <Th>Active contracts</Th>
              <Th>Tenants living here</Th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id} className="hover:bg-background">
                <Td primary>
                  <Link className="font-medium hover:underline" href={`/clients/${c.id}`}>
                    {c.name}
                  </Link>
                </Td>
                <Td label="Contact person">
                  {c.contactName ?? <span className="text-muted">Not set</span>}
                  {c.contactPhone && <span className="block text-xs text-muted">{c.contactPhone}</span>}
                </Td>
                <Td label="Active contracts">{contractsBy.get(c.id) ?? 0}</Td>
                <Td label="Tenants living here">{peopleBy.get(c.id) ?? 0}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
