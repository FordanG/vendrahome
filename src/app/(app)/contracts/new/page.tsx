import { asc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { ActionForm } from "@/components/action-form";
import { Card, Empty, Field, LinkButton, PageHeader, Select } from "@/components/ui";
import { createContract } from "../actions";
import { ContractFields } from "../contract-fields";

export default async function NewContractPage({ searchParams }: PageProps<"/contracts/new">) {
  await requireStaff(CAN.manageContracts);
  const { client } = await searchParams;
  const db = await getDb();
  const [clients, rooms] = await Promise.all([
    db.select({ id: schema.clients.id, name: schema.clients.name }).from(schema.clients).orderBy(asc(schema.clients.name)),
    db.select({ id: schema.rooms.id }).from(schema.rooms),
  ]);

  return (
    <>
      <PageHeader back={{ href: "/contracts", label: "Contracts" }} title="New contract" />
      {clients.length === 0 ? (
        <Empty>
          Add the company first.
          <span className="mt-3 block">
            <LinkButton href="/clients/new">Add company</LinkButton>
          </span>
        </Empty>
      ) : (
        <Card className="max-w-3xl">
          <ActionForm action={createContract} submitLabel="Create contract">
            <ContractFields clients={clients} defaultClientId={typeof client === "string" ? client : undefined} />
            <Field label="Rooms" hint="You can add or remove rooms on the next page. The contract starts as a draft.">
              <Select name="rooms" defaultValue="all">
                <option value="all">All {rooms.length} rooms</option>
                <option value="none">Pick rooms on the next page</option>
              </Select>
            </Field>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
