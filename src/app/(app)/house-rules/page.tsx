import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN } from "@/lib/auth";
import { requireHotel } from "@/lib/hotel";
import { ActionForm } from "@/components/action-form";
import { Card, Empty, Field, Input, PageHeader, SectionTitle, Textarea } from "@/components/ui";
import { RuleBody } from "@/components/rule-body";
import { createRule, deleteRule, updateRule } from "./actions";

function RuleFields({ rule, nextPosition }: { rule?: { title: string; body: string | null; position: number }; nextPosition?: number }) {
  return (
    <>
      <Field label="Title">
        <Input name="title" defaultValue={rule?.title} required />
      </Field>
      <Field label="Details" hint='Keep it short. Start a line with "- " to make a bullet point.'>
        <Textarea name="body" rows={4} defaultValue={rule?.body ?? ""} />
      </Field>
      <Field label="Place in the list" hint="1 shows first, 2 next, and so on">
        <Input name="position" type="number" defaultValue={rule?.position ?? nextPosition ?? 1} className="w-24" />
      </Field>
    </>
  );
}

export default async function HouseRulesPage() {
  const { user, hotel } = await requireHotel();
  const canManage = CAN.manageHouseRules.includes(user.role);
  const db = await getDb();
  const rules = await db
    .select()
    .from(schema.houseRules)
    .where(eq(schema.houseRules.propertyId, hotel.id))
    .orderBy(asc(schema.houseRules.position), asc(schema.houseRules.title));

  return (
    <>
      <PageHeader title="House rules" subtitle={canManage ? `The rules at ${hotel.name}. Tenants read them in the app. Open a rule to edit it.` : `The rules at ${hotel.name}. Tenants read them in the app.`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          {rules.length === 0 && <Empty>No house rules yet. Add the first one with the form.</Empty>}
          {rules.map((r) => (
            <Card key={r.id}>
              {canManage ? (
                <details>
                  <summary className="cursor-pointer select-none">
                    <span className="font-medium">{r.title}</span>
                    {r.body && <RuleBody body={r.body} />}
                  </summary>
                  <div className="mt-4 space-y-3 border-t border-border pt-4">
                    <ActionForm action={updateRule.bind(null, r.id)}>
                      <RuleFields rule={r} />
                    </ActionForm>
                    <ActionForm
                      action={deleteRule.bind(null, r.id)}
                      submitLabel="Delete rule"
                      submitVariant="danger"
                      confirm={`Delete "${r.title}"?`}
                    />
                  </div>
                </details>
              ) : (
                <>
                  <p className="font-medium">{r.title}</p>
                  {r.body && <RuleBody body={r.body} />}
                </>
              )}
            </Card>
          ))}
        </div>
        {canManage && (
          <Card className="self-start">
            <SectionTitle>Add a rule</SectionTitle>
            <ActionForm action={createRule} submitLabel="Add rule" resetOnSuccess>
              <RuleFields nextPosition={(rules.at(-1)?.position ?? 0) + 1} />
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
