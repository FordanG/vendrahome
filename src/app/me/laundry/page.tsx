import { asc, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireTenant } from "@/lib/auth";
import { formatMoment, formatPeso } from "@/lib/format";
import { CLAIM_DAYS, CLAIM_KIND_LABELS, formatKilos, LAUNDRY_STATUS_LABELS, LAUNDRY_STATUS_TONES, loadLabel } from "@/lib/laundry";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Empty, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { reportLaundryClaim } from "../actions";

export default async function TenantLaundryPage() {
  const { occupant } = await requireTenant();
  const db = await getDb();
  const loads = await db
    .select({ l: schema.laundryLoads, service: schema.laundryServices.name })
    .from(schema.laundryLoads)
    .innerJoin(schema.laundryServices, eq(schema.laundryLoads.serviceId, schema.laundryServices.id))
    .where(eq(schema.laundryLoads.occupantId, occupant.id))
    .orderBy(desc(schema.laundryLoads.number))
    .limit(30);
  const claims = loads.length
    ? await db
        .select()
        .from(schema.laundryClaims)
        .where(inArray(schema.laundryClaims.loadId, loads.map((x) => x.l.id)))
        .orderBy(asc(schema.laundryClaims.createdAt))
    : [];
  const claimWindow = Date.now() - CLAIM_DAYS * 86_400_000;

  return (
    <>
      <PageHeader
        back={{ href: "/me", label: "Home" }}
        title="Your laundry"
        subtitle="Bring your bag to the front desk. Each load gets a number on its tag; you'll see it move here."
      />
      {loads.length === 0 ? (
        <Empty>No laundry yet.</Empty>
      ) : (
        <div className="space-y-3">
          {loads.map(({ l, service }) => {
            const mine = claims.filter((c) => c.loadId === l.id);
            const canClaim = (l.status === "ready" || l.status === "collected") && !!l.returnedAt && l.returnedAt.getTime() > claimWindow;
            return (
              <Card key={l.id} className="p-3 sm:p-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="plate font-bold">{loadLabel(l.number)}</span>
                  <Badge tone={LAUNDRY_STATUS_TONES[l.status]}>{LAUNDRY_STATUS_LABELS[l.status]}</Badge>
                  <span className="text-xs text-muted">Dropped off {formatMoment(l.receivedAt)}</span>
                </div>
                <p className="mt-1 text-sm text-muted">
                  {service}, {l.bags} {l.bags === 1 ? "bag" : "bags"}
                  {l.grams != null && `. ${formatKilos(l.grams)}, ${formatPeso(l.amount ?? 0)}`}
                </p>
                {mine.map((c) => (
                  <p key={c.id} className="mt-2 text-sm">
                    <span className="font-medium">{CLAIM_KIND_LABELS[c.kind]}:</span> {c.details}{" "}
                    <span className="text-muted">
                      {c.status === "open" ? "(the front desk is looking into it)" : `(settled: ${c.resolution})`}
                    </span>
                  </p>
                ))}
                {canClaim && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm underline underline-offset-2">Something missing or damaged?</summary>
                    <ActionForm action={reportLaundryClaim.bind(null, l.id)} submitLabel="Send" pendingLabel="Sending…" resetOnSuccess className="mt-3 space-y-3">
                      <Field label="What happened">
                        <Select name="kind" defaultValue="missing">
                          {Object.entries(CLAIM_KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </Select>
                      </Field>
                      <Field label="Details" hint="Which piece, its colour, anything that helps find it">
                        <Textarea name="details" rows={2} required maxLength={2000} />
                      </Field>
                      <Field label="Photo" hint="Optional">
                        <Input name="photo" type="file" accept="image/*" />
                      </Field>
                    </ActionForm>
                  </details>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
