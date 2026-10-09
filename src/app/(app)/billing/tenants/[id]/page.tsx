import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { occupantAccount } from "@/lib/billing";
import { getCurrentStay } from "@/lib/portal";
import { Card, Detail, PageHeader, SectionTitle } from "@/components/ui";
import { Balance, ChargeForm, Ledger, PaymentForm } from "../../parts";

export default async function TenantAccountPage({ params }: PageProps<"/billing/tenants/[id]">) {
  const user = await requireStaff(CAN.viewBilling);
  const isAdmin = CAN.manageBilling.includes(user.role);
  const { id } = await params;
  const db = await getDb();
  const occupant = await db.query.occupants.findFirst({ where: eq(schema.occupants.id, id) });
  if (!occupant) notFound();
  const [account, stay, types] = await Promise.all([
    occupantAccount(id),
    getCurrentStay(id),
    db.select().from(schema.chargeTypes).orderBy(asc(schema.chargeTypes.position), asc(schema.chargeTypes.name)),
  ]);

  return (
    <>
      <PageHeader
        back={{ href: "/billing", label: "Billing" }}
        title={occupant.fullName}
        subtitle={
          <span className="inline-flex flex-wrap gap-2">
            <Link className="underline underline-offset-2" href={`/occupants/${occupant.id}`}>Tenant details</Link>
            <span>{stay ? `Room ${stay.room.number}` : "No current room"}</span>
          </span>
        }
      />
      <Card className="mb-6">
        <dl className="grid gap-4 sm:grid-cols-3">
          <Detail label="Balance"><Balance amount={account.balance} className="text-base font-semibold" /></Detail>
          <Detail label="Charges">{account.charges.length}</Detail>
          <Detail label="Payments">{account.payments.length}</Detail>
        </dl>
        <p className="mt-3 text-xs text-muted">Charges the tenant pays personally. Charges their company pays go on the company&apos;s statement instead.</p>
      </Card>
      <div className="grid gap-6 lg:grid-cols-3">
        <section className="min-w-0 lg:col-span-2">
          <SectionTitle>Charges and payments</SectionTitle>
          <Ledger charges={account.charges} payments={account.payments} canRecord canManage={isAdmin} />
        </section>
        <div className="min-w-0 space-y-6">
          <Card>
            <SectionTitle>Add a charge</SectionTitle>
            <ChargeForm types={types} occupantId={occupant.id} canCredit={isAdmin} />
          </Card>
          <Card>
            <SectionTitle>Record a payment</SectionTitle>
            <PaymentForm billTo="occupant" occupantId={occupant.id} />
          </Card>
        </div>
      </div>
    </>
  );
}
