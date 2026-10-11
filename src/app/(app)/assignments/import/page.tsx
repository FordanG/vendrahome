import { asc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN } from "@/lib/auth";
import { requireHotel } from "@/lib/hotel";
import { OCCUPANT_FIELDS, STAY_COLUMNS } from "@/lib/occupants";
import { ActionForm } from "@/components/action-form";
import { Card, Field, Input, LinkButton, PageHeader, SectionTitle, Select, Textarea } from "@/components/ui";
import { importOccupants } from "./actions";

export default async function ImportPage() {
  const { hotel } = await requireHotel(CAN.manageOccupants);
  const db = await getDb();
  const clients = await db
    .select({ id: schema.clients.id, name: schema.clients.name })
    .from(schema.clients)
    .orderBy(asc(schema.clients.name));

  return (
    <>
      <PageHeader
        back={{ href: "/assignments", label: "Room assignments" }}
        title="Import tenants"
        subtitle={`Add the company's list of tenants and their rooms at ${hotel.name} in one go, from a spreadsheet.`}
        actions={
          <LinkButton variant="secondary" href="/assignments/import/template">
            Download template (CSV)
          </LinkButton>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <ActionForm action={importOccupants} submitLabel="Import" pendingLabel="Importing…" resetOnSuccess>
            <Field label="Company" hint="Everyone in this file works for this company.">
              <Select name="clientId" defaultValue={clients[0]?.id ?? ""}>
                <option value="">No company</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="CSV file" hint="In Excel or Google Sheets: File → Save as / Download → CSV.">
              <Input name="file" type="file" accept=".csv,text/csv" />
            </Field>
            <Field label="Or paste the rows here" hint="Include the header row.">
              <Textarea name="pasted" rows={6} className="font-mono text-xs" />
            </Field>
          </ActionForm>
        </Card>
        <Card>
          <SectionTitle>How it works</SectionTitle>
          <ul className="list-disc space-y-2 pl-4 text-sm">
            <li>The first row is the header. Only <code>full_name</code> is required.</li>
            <li>
              To give someone a room, fill in <code>room</code> (the room number) and <code>check_in</code> (the
              move-in date). <code>bed</code> is optional, e.g. Bed A. Leave <code>room</code> blank to add the tenant
              without a room.
            </li>
            <li>Dates can be 2027-01-15 or 1/15/2027.</li>
            <li>The whole file is checked first. If any row has a problem, nothing is imported and you get a list of rows to fix.</li>
            <li>A room can&apos;t get more people than it has beds, and employee IDs can&apos;t repeat.</li>
          </ul>
          <p className="mt-4 text-xs text-muted">
            Columns: {[...STAY_COLUMNS, ...OCCUPANT_FIELDS.map((f) => f.csv)].join(", ")}
          </p>
        </Card>
      </div>
    </>
  );
}
