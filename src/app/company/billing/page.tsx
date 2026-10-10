import { notFound } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { COMPANY_CAN, requireCompany } from "@/lib/auth";
import { companyAccount, PAYMENT_METHOD_LABELS } from "@/lib/billing";
import { formatDate, formatPeso, todayISO } from "@/lib/format";
import { Badge, Card, Detail, Empty, PageHeader, SectionTitle, Table, Td, Th } from "@/components/ui";
import { CONTRACT_STATUS_LABELS, CONTRACT_STATUS_TONES } from "../../(app)/contracts/status";

/** The company's own account under each contract. Read-only: payments are recorded by the hotel. */
export default async function CompanyBillingPage() {
  const { client } = await requireCompany(COMPANY_CAN.viewBilling);
  if (!client.showBilling) notFound();
  const today = todayISO();
  const db = await getDb();
  const contracts = await db
    .select()
    .from(schema.contracts)
    .where(and(eq(schema.contracts.clientId, client.id), inArray(schema.contracts.status, ["active", "ended", "terminated"])))
    .orderBy(desc(schema.contracts.startDate));
  const accounts = await Promise.all(contracts.map(async (contract) => ({ contract, account: await companyAccount(contract.id, today) })));

  return (
    <>
      <PageHeader title="Bills" subtitle="Your statements, payments and deposit. Ask the front desk about anything that looks wrong." />
      {accounts.length === 0 && <Empty>No contracts with bills yet.</Empty>}
      <div className="space-y-10">
        {accounts.map(({ contract, account }) => (
          <section key={contract.id} className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="plate text-xl font-bold">{contract.reference}</h2>
              <Badge tone={CONTRACT_STATUS_TONES[contract.status]}>{CONTRACT_STATUS_LABELS[contract.status]}</Badge>
            </div>
            <Card>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Detail label="Balance">{formatPeso(account.balance)}</Detail>
                <Detail label="Overdue" empty="Nothing overdue">
                  {account.overdue && (
                    <span className="text-attention">
                      {formatPeso(account.overdue.amount)} since {formatDate(account.overdue.since)}
                    </span>
                  )}
                </Detail>
                <Detail label="Not on a statement yet">{formatPeso(account.unbilledTotal)}</Detail>
                <Detail label="Deposit held">{formatPeso(account.deposit.held)}</Detail>
              </dl>
            </Card>

            <div>
              <SectionTitle>Statements</SectionTitle>
              {account.statements.length === 0 ? (
                <Empty>No statements yet.</Empty>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>Statement</Th>
                      <Th>Period</Th>
                      <Th>Due</Th>
                      <Th className="text-right">New charges</Th>
                      <Th className="text-right">Balance due</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...account.statements].reverse().map((s) => (
                      <tr key={s.id}>
                        <Td primary>{s.number}</Td>
                        <Td label="Period">
                          {formatDate(s.periodStart)} to {formatDate(s.periodEnd)}
                        </Td>
                        <Td label="Due">{formatDate(s.dueDate)}</Td>
                        <Td label="New charges" className="sm:text-right">
                          {formatPeso(s.newCharges)}
                        </Td>
                        <Td label="Balance due" className="font-medium sm:text-right">
                          {formatPeso(s.balanceDue)}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </div>

            {account.unbilled.length > 0 && (
              <div>
                <SectionTitle>Charges for the next statement</SectionTitle>
                <Table>
                  <thead>
                    <tr>
                      <Th>Charge</Th>
                      <Th>Date</Th>
                      <Th className="text-right">Amount</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {account.unbilled.map(({ charge, typeName, roomNumber, occupantName }) => (
                      <tr key={charge.id}>
                        <Td primary wide>
                          {charge.description}
                          <span className="block text-xs text-muted">
                            {[typeName, roomNumber && `Room ${roomNumber}`, occupantName].filter(Boolean).join(", ")}
                          </span>
                        </Td>
                        <Td label="Date">{formatDate(charge.chargedOn)}</Td>
                        <Td label="Amount" className="sm:text-right">
                          {formatPeso(charge.amount)}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}

            <div>
              <SectionTitle>Payments received</SectionTitle>
              {account.payments.length === 0 ? (
                <Empty>No payments yet.</Empty>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>Received</Th>
                      <Th>How</Th>
                      <Th>Reference</Th>
                      <Th className="text-right">Amount</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...account.payments].reverse().slice(0, 24).map(({ payment, reversed }) => (
                      <tr key={payment.id}>
                        <Td primary>{formatDate(payment.receivedOn)}</Td>
                        <Td label="How">{PAYMENT_METHOD_LABELS[payment.method]}</Td>
                        <Td label="Reference">
                          {payment.officialReceiptNo ? `OR ${payment.officialReceiptNo}` : payment.reference ?? "None"}
                          {(reversed || payment.reversesId) && <span className="block text-xs text-muted">Corrected</span>}
                        </Td>
                        <Td label="Amount" className="sm:text-right">
                          {formatPeso(payment.amount)}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
