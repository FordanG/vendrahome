import { asc, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { ItemTemplate } from "@/db/schema";
import { CAN, requireStaff } from "@/lib/auth";
import { CATEGORY_LABELS } from "@/lib/inventory";
import { centavosToInput, formatPeso } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Button, Card, Empty, Field, Input, PageHeader, SectionTitle, Select } from "@/components/ui";
import { applyTemplates, removeTemplate, saveTemplate } from "../actions";

/** The standard list of items for each room type, so all rooms can be set up in one step. */
export default async function TemplatesPage() {
  await requireStaff(CAN.manageRooms);
  const db = await getDb();
  const [types, templates] = await Promise.all([
    db
      .select({ type: schema.roomTypes, rooms: sql<number>`(select count(*)::int from rooms r where r.room_type_id = "room_types"."id")` })
      .from(schema.roomTypes)
      .orderBy(asc(schema.roomTypes.name)),
    db.select().from(schema.itemTemplates).orderBy(asc(schema.itemTemplates.position), asc(schema.itemTemplates.name)),
  ]);
  return (
    <>
      <PageHeader
        back={{ href: "/inventory", label: "Room inventory" }}
        title="Standard lists"
        subtitle="What every room of a type should have. Add a list to all its rooms in one step; rooms keep anything extra, and items they already have aren't added twice."
      />
      {types.length === 0 && <Empty>No room types yet. Add them on the Rooms page first.</Empty>}
      <div className="space-y-6">
        {types.map(({ type, rooms }) => {
          const list = templates.filter((t) => t.roomTypeId === type.id);
          return (
            <Card key={type.id}>
              <SectionTitle
                actions={list.length > 0 && rooms > 0 && (
                  <ActionForm action={applyTemplates.bind(null, type.id)} submitLabel={`Add to all ${rooms} ${type.name} rooms`} pendingLabel="Adding…" className="flex flex-wrap items-center gap-2" />
                )}
              >
                {type.name} <span className="font-normal text-muted">({rooms} {rooms === 1 ? "room" : "rooms"})</span>
              </SectionTitle>
              {list.length === 0 ? (
                <p className="mb-4 text-sm text-muted">No items on this list yet.</p>
              ) : (
                <ul className="mb-4 divide-y divide-border">
                  {list.map((t) => (
                    <li key={t.id} className="py-3">
                      <details>
                        <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm">
                          <span><strong>{t.name}</strong>{t.quantity > 1 && ` × ${t.quantity}`} <span className="text-muted">{CATEGORY_LABELS[t.category]}</span></span>
                          <span className="text-muted">
                            {formatPeso(t.replacementCost)} each{t.serviceEveryMonths ? `, service every ${t.serviceEveryMonths} months` : ""}
                          </span>
                        </summary>
                        <div className="mt-3 grid gap-4 md:grid-cols-[1fr_auto]">
                          <ActionForm action={saveTemplate.bind(null, type.id, t.id)} submitLabel="Save" submitVariant="secondary">
                            <TemplateFields template={t} />
                          </ActionForm>
                          <form action={async () => { "use server"; await removeTemplate(type.id, t.id); }} className="self-end">
                            <Button variant="danger">Remove from list</Button>
                          </form>
                        </div>
                      </details>
                    </li>
                  ))}
                </ul>
              )}
              <details className="border-t border-border pt-3">
                <summary className="cursor-pointer text-sm font-medium">Add an item to the {type.name} list</summary>
                <div className="mt-3">
                  <ActionForm action={saveTemplate.bind(null, type.id, null)} submitLabel="Add to list" resetOnSuccess>
                    <TemplateFields />
                  </ActionForm>
                </div>
              </details>
            </Card>
          );
        })}
      </div>
    </>
  );
}

function TemplateFields({ template }: { template?: ItemTemplate }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <Field label="Name" className="lg:col-span-2">
        <Input name="name" defaultValue={template?.name} required placeholder="e.g. Mattress" />
      </Field>
      <Field label="Kind">
        <Select name="category" defaultValue={template?.category ?? "furniture"}>
          {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </Field>
      <Field label="How many">
        <Input name="quantity" type="number" min={1} max={999} defaultValue={template?.quantity ?? 1} required />
      </Field>
      <Field label="Replacement each (₱)">
        <Input name="replacementCost" inputMode="decimal" defaultValue={centavosToInput(template?.replacementCost)} />
      </Field>
      <Field label="Service every (months)" hint="Blank if none" className="sm:col-span-2 lg:col-span-1">
        <Input name="serviceEveryMonths" type="number" min={1} max={120} defaultValue={template?.serviceEveryMonths ?? ""} />
      </Field>
    </div>
  );
}
