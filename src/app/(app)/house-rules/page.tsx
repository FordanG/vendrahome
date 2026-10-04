import { asc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { ActionForm } from "@/components/action-form";
import { Card, Empty, Field, Input, PageHeader, SectionTitle, Textarea } from "@/components/ui";
import { createRule, deleteRule, updateRule } from "./actions";

function RuleFields({ rule }: { rule?: { title: string; body: string | null; position: number } }) {
  return (
    <>
      <Field label="Title">
        <Input name="title" defaultValue={rule?.title} required />
      </Field>
      <Field label="Details">
        <Textarea name="body" rows={4} defaultValue={rule?.body ?? ""} />
      </Field>
      <Field label="Place in the list" hint="1 shows first, 2 next, and so on">
        <Input name="position" type="number" defaultValue={rule?.position ?? 0} className="w-24" />
      </Field>
    </>
  );
}

export default async function HouseRulesPage() {
  const user = await requireStaff();
  const canManage = CAN.manageHouseRules.includes(user.role);
  const db = await getDb();
  const rules = await db
    .select()
    .from(schema.houseRules)
    .orderBy(asc(schema.houseRules.position), asc(schema.houseRules.title));

  return (
    <>
      <PageHeader title="House rules" subtitle={canManage ? "Property rules for residents, staff and authorized service providers. Residents can read them in the app. Open a rule to edit it." : "Property rules for residents, staff and authorized service providers."} />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          {rules.length === 0 && <Empty>No house rules yet. Add the first one with the form.</Empty>}
          {rules.map((r) => (
            <Card key={r.id}>
              {canManage ? (
                <details>
                  <summary className="cursor-pointer select-none">
                    <span className="font-medium">{r.title}</span>
                    {r.body && <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{r.body}</p>}
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
                  {r.body && <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{r.body}</p>}
                </>
              )}
            </Card>
          ))}
        </div>
        {canManage && (
          <Card className="self-start">
            <SectionTitle>Add a rule</SectionTitle>
            <ActionForm action={createRule} submitLabel="Add rule" resetOnSuccess>
              <RuleFields />
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
