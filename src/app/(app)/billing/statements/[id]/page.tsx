import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { BRAND } from "@/lib/brand";
import { PAYMENT_METHOD_LABELS } from "@/lib/billing";
import { formatDate, formatPeso } from "@/lib/format";
import { Card, PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";

/** A frozen monthly statement of account, laid out to print or save as PDF. */
export default async function StatementPage({ params }: PageProps<"/billing/statements/[id]">) {
  await requireStaff(CAN.viewBilling);
  const { id } = await params;
  const db = await getDb();
  const statement = await db.query.statements.findFirst({ where: eq(schema.statements.id, id) });
  if (!statement) notFound();
  const [contract, lines, payments] = await Promise.all([
    db.query.contracts.findFirst({ where: eq(schema.contracts.id, statement.contractId) }),
    db
      .select({ charge: schema.charges, code: schema.chargeTypes.code, typeName: schema.chargeTypes.name, room: schema.rooms.number, person: schema.occupants.fullName })
      .from(schema.charges)
      .innerJoin(schema.chargeTypes, eq(schema.charges.chargeTypeId, schema.chargeTypes.id))
      .leftJoin(schema.rooms, eq(schema.charges.roomId, schema.rooms.id))
      .leftJoin(schema.occupants, eq(schema.charges.occupantId, schema.occupants.id))
      .where(eq(schema.charges.statementId, id))
      .orderBy(asc(schema.chargeTypes.position), asc(schema.rooms.number), asc(schema.charges.chargedOn)),
    db.select().from(schema.payments).where(eq(schema.payments.statementId, id)).orderBy(asc(schema.payments.receivedOn)),
  ]);
  const client = contract ? await db.query.clients.findFirst({ where: eq(schema.clients.id, contract.clientId) }) : null;
  const groups = [
    { title: "Rent", rows: lines.filter((l) => l.code === "rent") },
    { title: "Utilities", rows: lines.filter((l) => l.code === "utility") },
    { title: "Other charges", rows: lines.filter((l) => l.code !== "rent" && l.code !== "utility") },
  ].filter((g) => g.rows.length > 0);

  return (
    <>
      <div className="no-print">
        <PageHeader
          back={{ href: `/billing/contracts/${statement.contractId}`, label: client?.name ?? "Account" }}
          title={`Statement ${statement.number}`}
          subtitle="Issued statements are final. Corrections appear on the next statement."
          actions={<PrintButton label="Print or save as PDF" />}
        />
      </div>

      <Card className="mx-auto max-w-3xl p-6 print:border-0 print:p-0 sm:p-8">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
          <div>
            <p className="plate text-2xl font-bold">{BRAND.name}</p>
            <p className="text-sm text-muted">Statement of account</p>
          </div>
          <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-sm">
            <dt className="text-muted">Statement no.</dt><dd className="font-medium">{statement.number}</dd>
            <dt className="text-muted">Issued</dt><dd>{formatDate(statement.issuedOn)}</dd>
            <dt className="text-muted">Due</dt><dd className="font-medium">{formatDate(statement.dueDate)}</dd>
            <dt className="text-muted">Period</dt><dd>{formatDate(statement.periodStart)} – {formatDate(statement.periodEnd)}</dd>
          </dl>
        </header>

        <section className="mb-6 text-sm">
          <p className="text-xs text-muted">Billed to</p>
          <p className="font-semibold">{client?.name}</p>
          {client?.address && <p>{client.address}</p>}
          {client?.tin && <p>TIN {client.tin}</p>}
          <p className="text-muted">Contract {contract?.reference}</p>
        </section>

        <table className="w-full text-sm">
          <tbody>
            <tr className="border-b border-border">
              <td className="py-2">Balance from previous statement</td>
              <td className="py-2 text-right tabular-nums">{formatPeso(statement.previousBalance)}</td>
            </tr>
            {groups.map((g) => (
              <GroupRows key={g.title} title={g.title} rows={g.rows} />
            ))}
            <tr className="border-b border-border">
              <td className="py-2 font-medium">New charges</td>
              <td className="py-2 text-right font-medium tabular-nums">{formatPeso(statement.newCharges)}</td>
            </tr>
            {payments.map((p) => (
              <tr key={p.id} className="border-b border-border text-muted">
                <td className="py-2">
                  {p.reversesId ? "Payment reversed" : `Payment received, ${PAYMENT_METHOD_LABELS[p.method]}`}, {formatDate(p.receivedOn)}
                  {p.reference && `, ref. ${p.reference}`}
                  {p.officialReceiptNo && `, OR ${p.officialReceiptNo}`}
                </td>
                <td className="py-2 text-right tabular-nums">−{formatPeso(p.amount)}</td>
              </tr>
            ))}
            <tr>
              <td className="pt-4 text-base font-bold">Balance due by {formatDate(statement.dueDate)}</td>
              <td className="pt-4 text-right text-base font-bold tabular-nums">{formatPeso(statement.balanceDue)}</td>
            </tr>
          </tbody>
        </table>

        {statement.notes && <p className="mt-6 whitespace-pre-wrap text-sm">{statement.notes}</p>}
        <p className="mt-8 border-t border-border pt-4 text-xs text-muted">
          This is a statement of account, not an official receipt. Official receipts are issued separately when payment is received.
        </p>
      </Card>
      <p className="no-print mt-4 text-center text-sm">
        <Link className="underline underline-offset-2" href={`/billing/contracts/${statement.contractId}`}>Back to the account</Link>
      </p>
    </>
  );
}

function GroupRows({ title, rows }: { title: string; rows: { charge: { id: string; description: string; amount: number }; room: string | null; person: string | null }[] }) {
  return (
    <>
      <tr>
        <td colSpan={2} className="pb-1 pt-4 text-xs font-semibold text-muted">{title}</td>
      </tr>
      {rows.map((r) => (
        <tr key={r.charge.id} className="border-b border-border">
          <td className="py-2 pr-3">
            {r.charge.description}
            {(r.room || r.person) && <span className="block text-xs text-muted">{[r.room && `Room ${r.room}`, r.person].filter(Boolean).join(", ")}</span>}
          </td>
          <td className="py-2 text-right tabular-nums">{formatPeso(r.charge.amount)}</td>
        </tr>
      ))}
    </>
  );
}
