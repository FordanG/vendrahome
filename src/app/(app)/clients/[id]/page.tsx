import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, COMPANY_ROLES, requireStaff, ROLE_LABELS } from "@/lib/auth";
import { AGREEMENT_FIELDS } from "@/lib/company";
import { formatDate } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Detail, Empty, Field, Input, LinkButton, PageHeader, SectionTitle, Select, Table, Td, Th } from "@/components/ui";
import { createCompanyLogin, saveAgreement, updateClient, updateCompanyLogin } from "../actions";
import { ClientFields } from "../client-fields";
import { CONTRACT_STATUS_LABELS, CONTRACT_STATUS_TONES } from "../../contracts/status";

export default async function ClientPage({ params }: PageProps<"/clients/[id]">) {
  const user = await requireStaff(CAN.viewClients);
  const { id } = await params;
  const db = await getDb();
  const client = await db.query.clients.findFirst({ where: eq(schema.clients.id, id) });
  if (!client) notFound();

  const canAccounts = CAN.manageCompanyAccounts.includes(user.role);
  const [contracts, people, logins] = await Promise.all([
    db.select().from(schema.contracts).where(eq(schema.contracts.clientId, id)).orderBy(desc(schema.contracts.startDate)),
    db
      .select({ id: schema.occupants.id })
      .from(schema.occupants)
      .where(and(eq(schema.occupants.clientId, id), eq(schema.occupants.status, "active"))),
    canAccounts
      ? db.select().from(schema.staff).where(and(eq(schema.staff.clientId, id), inArray(schema.staff.role, COMPANY_ROLES))).orderBy(asc(schema.staff.name))
      : Promise.resolve([]),
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

          {canAccounts && (
            <section>
              <SectionTitle>Company account</SectionTitle>
              <p className="mb-3 text-sm text-muted">
                People at the company sign in to see their own rooms, people, requests and bills, and nothing else at the hotel. Company admins add the rest of their team.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Card>
                  <h3 className="mb-3 text-sm font-semibold">What the agreement allows</h3>
                  <ActionForm action={saveAgreement.bind(null, client.id)}>
                    {AGREEMENT_FIELDS.map((f) => (
                      <label key={f.key} className="flex items-start gap-2 text-sm">
                        <input type="checkbox" name={f.key} defaultChecked={client[f.key]} className="mt-1" />
                        <span>
                          {f.label}
                          <span className="block text-xs text-muted">{f.hint}</span>
                        </span>
                      </label>
                    ))}
                  </ActionForm>
                </Card>
                <Card>
                  <h3 className="mb-3 text-sm font-semibold">Logins</h3>
                  {logins.length === 0 && <p className="mb-3 text-sm text-muted">Nobody from the company can sign in yet.</p>}
                  <ul className="mb-4 space-y-2">
                    {logins.map((l) => (
                      <li key={l.id}>
                        <details>
                          <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                            <span className="font-medium">{l.name}</span>
                            <Badge tone={l.role === "company_admin" ? "blue" : "gray"}>{ROLE_LABELS[l.role]}</Badge>
                            {!l.active && <Badge tone="red">Turned off</Badge>}
                            <span className="w-full text-xs text-muted">Signs in as {l.username}</span>
                          </summary>
                          <ActionForm action={updateCompanyLogin.bind(null, l.id)} className="mt-3 space-y-3">
                            <CompanyRoleSelect value={l.role} />
                            <label className="flex items-center gap-2 text-sm">
                              <input type="checkbox" name="active" defaultChecked={l.active} /> Can sign in
                            </label>
                            <Field label="New password" hint="Leave blank to keep the current one">
                              <Input name="password" type="password" autoComplete="new-password" />
                            </Field>
                          </ActionForm>
                        </details>
                      </li>
                    ))}
                  </ul>
                  <details open={logins.length === 0}>
                    <summary className="cursor-pointer text-sm underline underline-offset-2">Add a company login</summary>
                    <ActionForm action={createCompanyLogin.bind(null, client.id)} submitLabel="Add login" resetOnSuccess className="mt-3 space-y-3">
                      <Field label="Name">
                        <Input name="name" defaultValue={logins.length === 0 ? client.contactName ?? "" : ""} required />
                      </Field>
                      <Field label="Username">
                        <Input name="username" autoCapitalize="none" autoComplete="off" required />
                      </Field>
                      <Field label="Password" hint="At least 8 characters">
                        <Input name="password" type="password" autoComplete="new-password" required />
                      </Field>
                      <CompanyRoleSelect value="company_admin" />
                    </ActionForm>
                  </details>
                </Card>
              </div>
            </section>
          )}
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

function CompanyRoleSelect({ value }: { value: string }) {
  return (
    <Field label="Role">
      <Select name="role" defaultValue={value}>
        <option value="company_admin">Company admin: everything for their company, bills and team</option>
        <option value="company_staff">Company staff: rooms, people and requests only</option>
      </Select>
    </Field>
  );
}
