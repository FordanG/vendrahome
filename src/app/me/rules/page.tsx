import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireTenant } from "@/lib/auth";
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
      <PageHeader title="House rules" subtitle="Please follow these rules throughout your stay. Contact the front desk if you need clarification." />
      {rules.length === 0 ? (
        <Empty>No house rules have been posted yet.</Empty>
      ) : (
        <Card>
          <ol className="list-decimal space-y-4 pl-5">
            {rules.map((r) => (
              <li key={r.id}>
                <p className="font-medium">{r.title}</p>
                {r.body && <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{r.body}</p>}
              </li>
            ))}
          </ol>
        </Card>
      )}
    </>
  );
}
