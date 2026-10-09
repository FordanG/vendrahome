import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { RoomItem } from "@/db/schema";
import { CAN, requireStaff } from "@/lib/auth";
import { CATEGORY_LABELS, CHECK_KIND_LABELS, CONDITION_LABELS, CONDITION_TONES, itemsIn, nextServiceDate } from "@/lib/inventory";
import { addDaysISO, centavosToInput, formatDate, formatPeso, todayISO } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Empty, Field, FormGrid, Input, PageHeader, SectionTitle, Select, Textarea } from "@/components/ui";
import { addItem, markServiced, moveItem, recordCheck, retireItem, setItemCondition, updateItem } from "../../actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function RoomInventoryPage({ params }: PageProps<"/inventory/rooms/[id]">) {
  const user = await requireStaff(CAN.viewInventory);
  const canManage = CAN.manageInventory.includes(user.role);
  const { id } = await params;
  const storeroom = id === "storeroom";
  if (!storeroom && !UUID.test(id)) notFound();
  const db = await getDb();
  const room = storeroom ? null : await db.query.rooms.findFirst({ where: eq(schema.rooms.id, id) });
  if (!storeroom && !room) notFound();
  const roomId = room?.id ?? null;
  const today = todayISO();

  const [items, roomType, checks, stays, allRooms] = await Promise.all([
    itemsIn(roomId),
    room?.roomTypeId ? db.query.roomTypes.findFirst({ where: eq(schema.roomTypes.id, room.roomTypeId) }) : null,
    roomId
      ? db.select({ check: schema.inventoryChecks, by: schema.staff.name }).from(schema.inventoryChecks)
          .leftJoin(schema.staff, eq(schema.inventoryChecks.checkedBy, schema.staff.id))
          .where(eq(schema.inventoryChecks.roomId, roomId))
          .orderBy(desc(schema.inventoryChecks.checkedOn), desc(schema.inventoryChecks.createdAt)).limit(20)
      : [],
    roomId
      ? db.select({ a: schema.roomAssignments, name: schema.occupants.fullName }).from(schema.roomAssignments)
          .innerJoin(schema.occupants, eq(schema.roomAssignments.occupantId, schema.occupants.id))
          .where(eq(schema.roomAssignments.roomId, roomId))
          .orderBy(desc(schema.roomAssignments.checkIn)).limit(15)
      : [],
    canManage ? db.select({ id: schema.rooms.id, number: schema.rooms.number }).from(schema.rooms).orderBy(asc(schema.rooms.floor), asc(schema.rooms.number)) : [],
  ]);
  const events = items.length
    ? await db.select({ e: schema.itemEvents, by: schema.staff.name }).from(schema.itemEvents)
        .leftJoin(schema.staff, eq(schema.itemEvents.staffId, schema.staff.id))
        .where(inArray(schema.itemEvents.itemId, items.map((i) => i.id)))
        .orderBy(desc(schema.itemEvents.at)).limit(400)
    : [];
  const retired = roomId
    ? await db.select({ id: schema.roomItems.id }).from(schema.roomItems).where(eq(schema.roomItems.roomId, roomId)).then((r) => r.length - items.length)
    : 0;
  const current = stays.filter((s) => !s.a.actualCheckOut);
  const title = storeroom ? "Storeroom" : `Room ${room!.number}`;

  return (
    <>
      <PageHeader
        back={{ href: "/inventory", label: "Room inventory" }}
        title={title}
        subtitle={
          storeroom ? "Items not in any room: spares, and things waiting for repair." : (
            <span className="inline-flex flex-wrap gap-2">
              <span>Floor {room!.floor}{roomType ? `, ${roomType.name}` : ""}.</span>
              <span>{items.length} items{retired > 0 ? `, ${retired} removed earlier` : ""}.</span>
              <Link className="underline underline-offset-2" href={`/rooms/${room!.id}`}>Room details</Link>
            </span>
          )
        }
      />

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="min-w-0 space-y-3 lg:col-span-3">
          <SectionTitle>Items</SectionTitle>
          {items.length === 0 && (
            <Empty>
              No items yet.{" "}
              {!storeroom && CAN.manageRooms.includes(user.role) && roomType
                ? <>Use the <Link className="underline" href="/inventory/templates">standard list for {roomType.name} rooms</Link>, or add items below.</>
                : canManage ? "Add them below." : "The front desk or admin adds them."}
            </Empty>
          )}
          {items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              canManage={canManage}
              storeroom={storeroom}
              today={today}
              rooms={allRooms.filter((r) => r.id !== roomId)}
              events={events.filter((e) => e.e.itemId === item.id).slice(0, 8)}
            />
          ))}
          {canManage && (
            <details className="border border-border bg-surface">
              <summary className="cursor-pointer select-none px-5 py-4 text-base font-semibold">Add an item</summary>
              <div className="border-t border-border p-5">
                <ActionForm action={addItem.bind(null, roomId)} submitLabel="Add item" resetOnSuccess>
                  <ItemFields />
                </ActionForm>
              </div>
            </details>
          )}
        </div>

        {!storeroom && (
          <div className="min-w-0 space-y-6 lg:col-span-2">
            <Card id="check" className="scroll-mt-20">
              <SectionTitle>Check the room</SectionTitle>
              {items.length === 0 ? (
                <p className="text-sm text-muted">Add the room&apos;s items first.</p>
              ) : (
                <ActionForm action={recordCheck.bind(null, room!.id)} submitLabel="Save check" pendingLabel="Saving check…">
                  <p className="text-sm text-muted">Go through every item. Each item&apos;s condition is updated to what you find, and this check is kept as the record for later.</p>
                  <FormGrid>
                    <Field label="Kind of check">
                      <Select name="kind" defaultValue={current.length ? "spot" : "contract_start"}>
                        {Object.entries(CHECK_KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </Select>
                    </Field>
                    <Field label="Date">
                      <Input name="checkedOn" type="date" defaultValue={today} max={today} required />
                    </Field>
                  </FormGrid>
                  {stays.length > 0 && (
                    <Field label="Whose move-in or move-out" hint="Only for move-in and move-out checks">
                      <Select name="assignmentId" defaultValue="">
                        <option value="">Not for a move-in or move-out</option>
                        {stays.map((s) => (
                          <option key={s.a.id} value={s.a.id}>
                            {s.name}{s.a.slot ? `, ${s.a.slot}` : ""}: {formatDate(s.a.checkIn)}{s.a.actualCheckOut ? ` – ${formatDate(s.a.actualCheckOut)}` : " (living here)"}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                  <ul className="divide-y divide-border border-y border-border">
                    {items.map((item) => (
                      <li key={item.id} className="space-y-2 py-3">
                        <p className="text-sm font-medium">{item.name}{item.quantity > 1 && <span className="text-muted"> ({item.quantity} should be here)</span>}</p>
                        <div className="grid grid-cols-2 gap-2">
                          <Field label="Found">
                            <Input name={`found_${item.id}`} type="number" min={0} max={item.quantity} defaultValue={item.condition === "missing" ? 0 : item.quantity} required />
                          </Field>
                          <Field label="Condition">
                            <Select name={`condition_${item.id}`} defaultValue={item.condition}>
                              {Object.entries(CONDITION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                            </Select>
                          </Field>
                        </div>
                        <details>
                          <summary className="cursor-pointer text-xs text-muted underline underline-offset-2">Add a note or photo</summary>
                          <div className="mt-2 space-y-2">
                            <Input name={`note_${item.id}`} placeholder="e.g. Scratch on the left door" aria-label={`${item.name} note`} />
                            <Input name={`photo_${item.id}`} type="file" accept="image/*" aria-label={`${item.name} photo`} />
                          </div>
                        </details>
                      </li>
                    ))}
                  </ul>
                  <Field label="Signed off by" hint="The company representative or tenant who walked through it with you">
                    <Input name="signedBy" />
                  </Field>
                  <Field label="Notes">
                    <Textarea name="notes" rows={2} />
                  </Field>
                </ActionForm>
              )}
            </Card>

            <Card>
              <SectionTitle>Past checks</SectionTitle>
              {checks.length === 0 ? <p className="text-sm text-muted">This room hasn&apos;t been checked yet.</p> : (
                <ul className="divide-y divide-border text-sm">
                  {checks.map(({ check, by }) => (
                    <li key={check.id} className="py-2">
                      <Link className="font-medium underline underline-offset-2" href={`/inventory/checks/${check.id}`}>
                        {CHECK_KIND_LABELS[check.kind]}, {formatDate(check.checkedOn)}
                      </Link>
                      <span className="block text-xs text-muted">{[by && `By ${by}`, check.signedBy && `signed off by ${check.signedBy}`].filter(Boolean).join(", ")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}
      </div>
    </>
  );
}

const EVENT_LABELS = { added: "Added", updated: "Details changed", condition: "Condition", moved: "Moved", serviced: "Serviced", retired: "Removed" } as const;

function ItemCard({
  item,
  canManage,
  storeroom,
  today,
  rooms,
  events,
}: {
  item: RoomItem;
  canManage: boolean;
  storeroom: boolean;
  today: string;
  rooms: { id: string; number: string }[];
  events: { e: typeof schema.itemEvents.$inferSelect; by: string | null }[];
}) {
  const due = nextServiceDate(item);
  const details = [item.brand, item.model, item.serialNumber && `S/N ${item.serialNumber}`, item.tagCode && `Tag ${item.tagCode}`].filter(Boolean).join(" · ");
  return (
    <Card id={`item-${item.id}`} className="scroll-mt-20">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">{item.name}{item.quantity > 1 && <span className="font-normal text-muted"> × {item.quantity}</span>}</p>
          <p className="text-xs text-muted">
            {CATEGORY_LABELS[item.category]}. Replacement {formatPeso(item.replacementCost)}{item.quantity > 1 ? " each" : ""}.
            {due && <> Service {due < today ? <span className="text-attention">was due {formatDate(due)}</span> : `due ${formatDate(due)}`}.</>}
          </p>
          {details && <p className="text-xs text-muted">{details}</p>}
          {item.notes && <p className="mt-1 text-sm">{item.notes}</p>}
          {item.photoId && <Link className="text-xs underline" href={`/api/photos/${item.photoId}`} target="_blank">Photo</Link>}
        </div>
        <Badge tone={CONDITION_TONES[item.condition]}>{CONDITION_LABELS[item.condition]}</Badge>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <Action label="Update condition">
          <ActionForm action={setItemCondition.bind(null, item.id)} submitLabel="Save">
            <Field label="Condition">
              <Select name="condition" defaultValue={item.condition}>
                {Object.entries(CONDITION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <Field label="Note">
              <Input name="note" placeholder="What's wrong, if anything" />
            </Field>
            {!storeroom && (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="repair" /> Book a repair visit for this
                </label>
                <Field label="Repair date">
                  <Input name="repairDate" type="date" defaultValue={addDaysISO(today, 1)} min={today} />
                </Field>
              </>
            )}
          </ActionForm>
        </Action>
        {item.serviceEveryMonths && (
          <Action label="Record service">
            <ActionForm action={markServiced.bind(null, item.id)} submitLabel="Save">
              <Field label="Serviced on">
                <Input name="date" type="date" defaultValue={today} max={today} required />
              </Field>
              <Field label="Note">
                <Input name="note" placeholder="e.g. Filter cleaned" />
              </Field>
            </ActionForm>
          </Action>
        )}
        {canManage && (
          <>
            <Action label="Edit details">
              <ActionForm action={updateItem.bind(null, item.id)}>
                <ItemFields item={item} />
              </ActionForm>
            </Action>
            <Action label="Move">
              <ActionForm action={moveItem.bind(null, item.id)} submitLabel="Move">
                <Field label="Move to">
                  <Select name="toRoomId" defaultValue="">
                    <option value="" disabled>Pick a room</option>
                    {!storeroom && <option value="storeroom">Storeroom</option>}
                    {rooms.map((r) => <option key={r.id} value={r.id}>Room {r.number}</option>)}
                  </Select>
                </Field>
                <Field label="Note">
                  <Input name="note" placeholder="e.g. Swapped for repair" />
                </Field>
              </ActionForm>
            </Action>
            <Action label="Remove from inventory">
              <ActionForm action={retireItem.bind(null, item.id)} submitLabel="Remove" submitVariant="danger">
                <p className="text-sm text-muted">For items thrown away, sold or beyond repair. Its history is kept.</p>
                <Field label="Why">
                  <Input name="reason" required />
                </Field>
              </ActionForm>
            </Action>
          </>
        )}
        {events.length > 0 && (
          <Action label="History">
            <ul className="space-y-1 text-xs text-muted">
              {events.map(({ e, by }) => (
                <li key={e.id}>
                  {e.at.toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" })}:{" "}
                  {EVENT_LABELS[e.kind]}{e.condition && e.kind === "condition" ? ` ${CONDITION_LABELS[e.condition].toLowerCase()}` : ""}
                  {e.note && `. ${e.note}`}{by && ` (${by})`}
                </li>
              ))}
            </ul>
          </Action>
        )}
      </div>
    </Card>
  );
}

function Action({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="group w-full sm:w-auto">
      <summary className="inline-flex min-h-9 cursor-pointer select-none items-center text-muted underline underline-offset-2 hover:text-foreground group-open:text-foreground">{label}</summary>
      <div className="mt-2 w-full border-t border-border pt-3 sm:w-96">{children}</div>
    </details>
  );
}

function ItemFields({ item }: { item?: RoomItem }) {
  return (
    <>
      <FormGrid>
        <Field label="Name">
          <Input name="name" defaultValue={item?.name} required placeholder="e.g. Aircon" />
        </Field>
        <Field label="Kind">
          <Select name="category" defaultValue={item?.category ?? "furniture"}>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="How many">
          <Input name="quantity" type="number" min={1} max={999} defaultValue={item?.quantity ?? 1} required />
        </Field>
        <Field label="Replacement cost each (₱)" hint="What it costs to replace; used for damage charges">
          <Input name="replacementCost" inputMode="decimal" defaultValue={centavosToInput(item?.replacementCost)} />
        </Field>
        <Field label="Brand">
          <Input name="brand" defaultValue={item?.brand ?? ""} />
        </Field>
        <Field label="Model">
          <Input name="model" defaultValue={item?.model ?? ""} />
        </Field>
        <Field label="Serial number">
          <Input name="serialNumber" defaultValue={item?.serialNumber ?? ""} />
        </Field>
        <Field label="Tag code" hint="The label stuck on the item, if any">
          <Input name="tagCode" defaultValue={item?.tagCode ?? ""} />
        </Field>
        <Field label="Bought on">
          <Input name="purchaseDate" type="date" defaultValue={item?.purchaseDate ?? ""} />
        </Field>
        <Field label="Purchase cost (₱)">
          <Input name="purchaseCost" inputMode="decimal" defaultValue={centavosToInput(item?.purchaseCost)} />
        </Field>
        <Field label="Service every (months)" hint="e.g. 6 for aircon cleaning. Blank if none">
          <Input name="serviceEveryMonths" type="number" min={1} max={120} defaultValue={item?.serviceEveryMonths ?? ""} />
        </Field>
        <Field label="Last serviced">
          <Input name="lastServicedOn" type="date" defaultValue={item?.lastServicedOn ?? ""} />
        </Field>
      </FormGrid>
      <Field label="Photo" hint={item?.photoId ? "Choose a new one to replace the current photo" : "Optional"}>
        <Input name="photo" type="file" accept="image/*" />
      </Field>
      <Field label="Notes">
        <Input name="notes" defaultValue={item?.notes ?? ""} />
      </Field>
    </>
  );
}
