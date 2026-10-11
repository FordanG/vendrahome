import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireTenant } from "@/lib/auth";
import { RuleBody } from "@/components/rule-body";
import { tenantHotelId } from "@/lib/portal";
import { Card, Empty, PageHeader } from "@/components/ui";

export default async function TenantRulesPage() {
  const { occupant } = await requireTenant();
  const hotelId = await tenantHotelId(occupant);
  const db = await getDb();
  const rules = await db
    .select()
    .from(schema.houseRules)
    .where(eq(schema.houseRules.propertyId, hotelId ?? ""))
    .orderBy(asc(schema.houseRules.position), asc(schema.houseRules.title));

  return (
    <>
      <PageHeader title="House rules" subtitle="Please follow these rules while you stay here. Ask the front desk if anything is unclear." />
      {rules.length === 0 ? (
        <Empty>No house rules have been posted yet.</Empty>
      ) : (
        <Card>
          <ol className="list-decimal space-y-4 pl-5">
            {rules.map((r) => (
              <li key={r.id}>
                <p className="font-medium">{r.title}</p>
                {r.body && <RuleBody body={r.body} />}
              </li>
            ))}
          </ol>
        </Card>
      )}
    </>
  );
}
