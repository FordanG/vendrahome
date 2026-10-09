import Link from "next/link";
import { CAN, requireStaff } from "@/lib/auth";
import { billingOverview } from "@/lib/billing";
import { formatDate, formatPeso, todayISO } from "@/lib/format";
import { Card, Empty, PageHeader, SectionTitle, Table, Td, Th } from "@/components/ui";
import { Row, RowList } from "@/components/list";
import { Balance, BillingTabs, StatusBadge } from "./parts";

export default async function BillingPage() {
  const user = await requireStaff(CAN.viewBilling);
  const isAdmin = CAN.manageBilling.includes(user.role);
  const today = todayISO();
  const { accounts, tenants } = await billingOverview(today);
  const owed = accounts.reduce((n, a) => n + Math.max(a.balance, 0), 0) + tenants.reduce((n, t) => n + Math.max(t.balance, 0), 0);
  const overdue = accounts.filter((a) => a.overdue);
  const due = accounts.filter((a) => a.statementDue);

  return (
    <>
      <PageHeader title="Billing" subtitle={`${formatPeso(owed)} owed in total. Statements, payments and charges for each company and tenant.`} />
      <BillingTabs active="accounts" isAdmin={isAdmin} />

      {(overdue.length > 0 || (isAdmin && due.length > 0)) && (
        <ul className="mb-6 divide-y divide-border overflow-hidden border border-border bg-surface text-sm">
          {overdue.map((a) => (
            <li key={a.contract.id} className="border-l-4 border-l-attention px-4 py-3 sm:py-2.5">
              <Link className="font-medium underline underline-offset-2" href={`/billing/contracts/${a.contract.id}`}>{a.clientName}</Link>{" "}
              is {a.overdue!.days} {a.overdue!.days === 1 ? "day" : "days"} late paying {formatPeso(a.overdue!.amount)}, due {formatDate(a.overdue!.since)}.
            </li>
          ))}
          {isAdmin && due.map((a) => (
            <li key={`due-${a.contract.id}`} className="border-l-4 border-l-brand px-4 py-3 sm:py-2.5">
              Statement for month {a.statementDue!.month} of{" "}
              <Link className="font-medium underline underline-offset-2" href={`/billing/contracts/${a.contract.id}#statement`}>{a.contract.reference}</Link>{" "}
              is ready to issue (the month starts {formatDate(a.statementDue!.start)}).
            </li>
          ))}
        </ul>
      )}

      <section className="mb-8">
        <SectionTitle>Companies</SectionTitle>
        {accounts.length === 0 ? (
          <Empty>No active contracts yet. A company account opens when its contract is activated.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Company and contract</Th>
                <Th>Status</Th>
                <Th className="text-right">Balance</Th>
                <Th>Last statement</Th>
                <Th className="text-right">Not billed yet</Th>
                <Th className="text-right">Deposit held</Th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.contract.id}>
                  <Td primary>
                    <Link className="font-medium underline underline-offset-2" href={`/billing/contracts/${a.contract.id}`}>{a.clientName}</Link>
                    <span className="block text-xs text-muted">{a.contract.reference}</span>
                  </Td>
                  <Td label="Status"><StatusBadge balance={a.balance} overdue={a.overdue} /></Td>
                  <Td label="Balance" className="text-right tabular-nums"><Balance amount={a.balance} /></Td>
                  <Td label="Last statement">
                    {a.lastStatement ? (
                      <Link className="underline underline-offset-2" href={`/billing/statements/${a.lastStatement.id}`}>
                        {a.lastStatement.number}
                      </Link>
                    ) : "None yet"}
                    {a.lastStatement && <span className="block text-xs text-muted">Due {formatDate(a.lastStatement.dueDate)}</span>}
                  </Td>
                  <Td label="Not billed yet" className="text-right tabular-nums">{formatPeso(a.unbilledTotal)}</Td>
                  <Td label="Deposit held" className="text-right tabular-nums">{formatPeso(a.depositHeld)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section>
        <SectionTitle>Tenants with a balance</SectionTitle>
        {tenants.length === 0 ? (
          <Card className="text-sm text-muted">No tenant owes anything. Charges billed to a tenant (laundry, a lost key) show up here until paid. Add one from the tenant&apos;s page.</Card>
        ) : (
          <RowList>
            {tenants.map((t) => (
              <Row key={t.occupantId} href={`/billing/tenants/${t.occupantId}`} title={t.name}>
                <Balance amount={t.balance} />
              </Row>
            ))}
          </RowList>
        )}
      </section>
    </>
  );
}
