import Link from "next/link";
import { and, asc, desc, eq, gt, gte, inArray, isNull, lte, ne, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { addDaysISO, formatDate, formatMoment, formatPeso, manilaDate, todayISO } from "@/lib/format";
import { CLAIM_KIND_LABELS, formatKilos, loadLabel } from "@/lib/laundry";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Empty, Field, Input, LinkButton, PageHeader, SectionTitle, Select } from "@/components/ui";
import type { LaundryLoad } from "@/db/schema";
import { addClaim, cancelLoad, markCollected, receiveLoad, recordReturn, resolveClaim, sendToShop } from "./actions";

type Row = { l: LaundryLoad; name: string; roomNumber: string | null; service: string; turnaroundDays: number };

function Who({ row }: { row: Row }) {
  return (
    <span className="min-w-0 flex-1 basis-full text-sm sm:basis-0">
      <span className="block font-medium">
        <span className="plate">{loadLabel(row.l.number)}</span>
        <span className="text-muted">, room {row.roomNumber ?? "?"}</span>
      </span>
      <span className="block text-muted">
        {row.name}, {row.l.bags} {row.l.bags === 1 ? "bag" : "bags"}, {row.service}
      </span>
      {row.l.notes && <span className="block text-xs text-muted">{row.l.notes}</span>}
    </span>
  );
}

export default async function LaundryPage() {
  const user = await requireStaff(CAN.handleLaundry);
  const seeMargin = CAN.manageLaundryRates.includes(user.role);
  const today = todayISO();
  const monthStart = today.slice(0, 8) + "01";
  const db = await getDb();
  // A fresh query each time: a Drizzle query keeps the last .where() it was given.
  const loadQuery = () => db
    .select({
      l: schema.laundryLoads,
      name: schema.occupants.fullName,
      roomNumber: schema.rooms.number,
      service: schema.laundryServices.name,
      turnaroundDays: schema.laundryServices.turnaroundDays,
    })
    .from(schema.laundryLoads)
    .innerJoin(schema.occupants, eq(schema.laundryLoads.occupantId, schema.occupants.id))
    .innerJoin(schema.laundryServices, eq(schema.laundryLoads.serviceId, schema.laundryServices.id))
    .leftJoin(schema.rooms, eq(schema.laundryLoads.roomId, schema.rooms.id));
  const [open, recent, services, residents, claims, month] = await Promise.all([
    loadQuery().where(inArray(schema.laundryLoads.status, ["at_desk", "at_shop", "ready"])).orderBy(asc(schema.laundryLoads.number)),
    loadQuery()
      .where(and(eq(schema.laundryLoads.status, "collected"), gte(schema.laundryLoads.collectedAt, new Date(addDaysISO(today, -8) + "T16:00:00Z"))))
      .orderBy(desc(schema.laundryLoads.collectedAt))
      .limit(50),
    db.select().from(schema.laundryServices).where(eq(schema.laundryServices.active, true)).orderBy(asc(schema.laundryServices.position), asc(schema.laundryServices.name)),
    db
      .select({ id: schema.occupants.id, name: schema.occupants.fullName, room: schema.rooms.number })
      .from(schema.roomAssignments)
      .innerJoin(schema.occupants, eq(schema.roomAssignments.occupantId, schema.occupants.id))
      .innerJoin(schema.rooms, eq(schema.roomAssignments.roomId, schema.rooms.id))
      .where(and(lte(schema.roomAssignments.checkIn, today), or(isNull(schema.roomAssignments.actualCheckOut), gt(schema.roomAssignments.actualCheckOut, today))))
      .orderBy(asc(schema.rooms.number), asc(schema.occupants.fullName)),
    db
      .select({ c: schema.laundryClaims, number: schema.laundryLoads.number, name: schema.occupants.fullName, roomNumber: schema.rooms.number })
      .from(schema.laundryClaims)
      .innerJoin(schema.laundryLoads, eq(schema.laundryClaims.loadId, schema.laundryLoads.id))
      .innerJoin(schema.occupants, eq(schema.laundryLoads.occupantId, schema.occupants.id))
      .leftJoin(schema.rooms, eq(schema.laundryLoads.roomId, schema.rooms.id))
      .where(eq(schema.laundryClaims.status, "open"))
      .orderBy(asc(schema.laundryClaims.createdAt)),
    db
      .select({ grams: schema.laundryLoads.grams, amount: schema.laundryLoads.amount, cost: schema.laundryLoads.cost })
      .from(schema.laundryLoads)
      .where(and(ne(schema.laundryLoads.status, "cancelled"), gte(schema.laundryLoads.returnedAt, new Date(addDaysISO(monthStart, -1) + "T16:00:00Z")))),
  ]);
  const atDesk = open.filter((r) => r.l.status === "at_desk");
  const atShop = open.filter((r) => r.l.status === "at_shop");
  const ready = open.filter((r) => r.l.status === "ready");
  const dueBack = (r: Row) => addDaysISO(manilaDate(r.l.sentAt ?? r.l.receivedAt), r.turnaroundDays);
  const kilos = month.reduce((n, m) => n + (m.grams ?? 0), 0);
  const income = month.reduce((n, m) => n + (m.amount ?? 0), 0);
  const cost = month.reduce((n, m) => n + (m.cost ?? 0), 0);
  const costKnown = month.every((m) => m.cost != null);

  return (
    <>
      <PageHeader
        title="Laundry"
        subtitle={`${atDesk.length} at the desk, ${atShop.length} at the shop, ${ready.length} ready to pick up.`}
        actions={
          <>
            <LinkButton variant="secondary" href="/laundry/handoff">List for the shop</LinkButton>
            {seeMargin && <LinkButton variant="secondary" href="/laundry/settings">Services and rates</LinkButton>}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {claims.length > 0 && (
            <Card className="border-warn">
              <SectionTitle>Problems reported</SectionTitle>
              <ul className="divide-y divide-border">
                {claims.map(({ c, number, name, roomNumber }) => (
                  <li key={c.id} className="space-y-2 py-3 first:pt-0">
                    <p className="text-sm">
                      <span className="font-medium">{CLAIM_KIND_LABELS[c.kind]}</span>
                      <span className="text-muted">, {loadLabel(number)}, {name}, room {roomNumber ?? "?"}, {formatMoment(c.createdAt)}</span>
                    </p>
                    <p className="whitespace-pre-wrap text-sm">{c.details}</p>
                    {c.photoId && (
                      <a className="text-sm underline" href={`/api/photos/${c.photoId}`} target="_blank" rel="noreferrer">
                        See the photo
                      </a>
                    )}
                    <ActionForm action={resolveClaim.bind(null, c.id)} submitLabel="Close claim" submitVariant="secondary" className="flex flex-wrap items-end gap-3">
                      <Field label="How it was settled" hint="The tenant sees this" className="min-w-0 flex-1">
                        <Input name="resolution" placeholder="e.g. Shop paid ₱300 to the tenant" />
                      </Field>
                    </ActionForm>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <section>
            <SectionTitle>At the front desk</SectionTitle>
            {atDesk.length === 0 ? (
              <Empty>No bags waiting to go to the shop.</Empty>
            ) : (
              <Card className="p-0 sm:p-0">
                <ActionForm action={sendToShop} submitLabel="Send ticked bags to the shop" pendingLabel="Sending…" className="space-y-0 [&>div:last-child]:p-4">
                  <ul className="divide-y divide-border">
                    {atDesk.map((r) => (
                      <li key={r.l.id}>
                        <label className="flex cursor-pointer items-center gap-3 px-4 py-3">
                          <input type="checkbox" name="loadId" value={r.l.id} defaultChecked className="size-5" />
                          <Who row={r} />
                          <span className="text-xs text-muted">{formatMoment(r.l.receivedAt)}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </ActionForm>
              </Card>
            )}
          </section>

          <section>
            <SectionTitle>At the laundry shop</SectionTitle>
            {atShop.length === 0 ? (
              <Empty>Nothing at the shop.</Empty>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
                {atShop.map((r) => {
                  const late = dueBack(r) < today;
                  return (
                    <li key={r.l.id} className="space-y-2 px-4 py-3">
                      <div className="flex flex-wrap items-start gap-3">
                        <Who row={r} />
                        {late ? <Badge tone="red">Due back {formatDate(dueBack(r))}</Badge> : <span className="text-xs text-muted">Due back {formatDate(dueBack(r))}</span>}
                      </div>
                      <ActionForm action={recordReturn.bind(null, r.l.id)} submitLabel="Back from the shop" pendingLabel="Saving…" className="flex flex-wrap items-end gap-3">
                        <Field label="Kilos on the shop's slip">
                          <Input name="kilos" inputMode="decimal" placeholder="e.g. 3.5" required className="w-28" />
                        </Field>
                      </ActionForm>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section>
            <SectionTitle>Ready to pick up</SectionTitle>
            {ready.length === 0 ? (
              <Empty>Nothing waiting for tenants.</Empty>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
                {ready.map((r) => (
                  <li key={r.l.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <Who row={r} />
                    <span className="text-sm text-muted">
                      {formatKilos(r.l.grams)}, {formatPeso(r.l.amount ?? 0)}
                    </span>
                    <ActionForm
                      action={async () => {
                        "use server";
                        return markCollected(r.l.id);
                      }}
                      submitLabel="Picked up"
                      className="flex items-center gap-3"
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <SectionTitle>Picked up in the last week</SectionTitle>
            {recent.length === 0 ? (
              <Empty>None yet.</Empty>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface text-sm">
                {recent.map((r) => (
                  <li key={r.l.id}>
                    <details>
                      <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                        <span className="plate w-20 font-bold">{loadLabel(r.l.number)}</span>
                        <span className="flex-1 text-muted">
                          {r.name}, room {r.roomNumber ?? "?"}
                        </span>
                        <span className="text-muted">
                          {formatKilos(r.l.grams)}, {formatPeso(r.l.amount ?? 0)}
                        </span>
                      </summary>
                      <div className="border-t border-border px-4 py-3">
                        <ActionForm action={addClaim.bind(null, r.l.id)} submitLabel="Record a problem" submitVariant="secondary">
                          <Field label="What happened">
                            <Select name="kind" defaultValue="missing">
                              {Object.entries(CLAIM_KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                            </Select>
                          </Field>
                          <Field label="Details">
                            <Input name="details" required placeholder="e.g. One white shirt missing" />
                          </Field>
                          <Field label="Photo" hint="Optional">
                            <Input name="photo" type="file" accept="image/*" />
                          </Field>
                        </ActionForm>
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <Card className="lg:sticky lg:top-8">
            <SectionTitle>Bag dropped off</SectionTitle>
            {services.length === 0 ? (
              <p className="text-sm text-muted">
                {seeMargin ? (
                  <>
                    Add a service and its price per kilo first, under <Link className="underline" href="/laundry/settings">Services and rates</Link>.
                  </>
                ) : (
                  "The admin needs to add a laundry service and its price first."
                )}
              </p>
            ) : (
              <ActionForm action={receiveLoad} submitLabel="Log the bag" pendingLabel="Saving…" resetOnSuccess>
                <Field label="Tenant">
                  <Select name="occupantId" required defaultValue="">
                    <option value="">Choose the tenant</option>
                    {residents.map((t) => (
                      <option key={t.id} value={t.id}>
                        Room {t.room}, {t.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Service">
                  <Select name="serviceId" defaultValue={services[0].id}>
                    {services.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}, {formatPeso(s.ratePerKilo)} a kilo
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Bags">
                  <Input name="bags" type="number" min={1} max={10} defaultValue={1} className="w-24" />
                </Field>
                <Field label="Notes" hint="Optional, e.g. Delicates inside, no fabric softener">
                  <Input name="notes" />
                </Field>
              </ActionForm>
            )}
          </Card>

          {seeMargin && (
            <Card>
              <SectionTitle>This month</SectionTitle>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-xs text-muted">Loads back</dt><dd>{month.length}</dd></div>
                <div><dt className="text-xs text-muted">Weight</dt><dd>{formatKilos(kilos) || "0 kg"}</dd></div>
                <div><dt className="text-xs text-muted">Charged</dt><dd>{formatPeso(income)}</dd></div>
                <div><dt className="text-xs text-muted">Shop&apos;s cost</dt><dd>{costKnown ? formatPeso(cost) : "Not all known"}</dd></div>
                {costKnown && <div className="col-span-2"><dt className="text-xs text-muted">Margin</dt><dd className="font-semibold">{formatPeso(income - cost)}</dd></div>}
              </dl>
            </Card>
          )}

          {[...atDesk, ...atShop].length > 0 && (
            <Card>
              <SectionTitle>Logged by mistake?</SectionTitle>
              <ul className="space-y-2 text-sm">
                {[...atDesk, ...atShop].map((r) => (
                  <li key={r.l.id} className="flex items-center justify-between gap-3">
                    <span>{loadLabel(r.l.number)}, {r.name}</span>
                    <ActionForm
                      action={async () => {
                        "use server";
                        return cancelLoad(r.l.id);
                      }}
                      submitLabel="Cancel"
                      submitVariant="ghost"
                      confirm={`Cancel ${loadLabel(r.l.number)}?`}
                      className="flex items-center gap-2"
                    />
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
