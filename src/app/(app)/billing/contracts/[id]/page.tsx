import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN, requireStaff } from "@/lib/auth";
import { contractInReach } from "@/lib/hotel";
import { BILL_TO_LABELS, companyAccount, statementDraft } from "@/lib/billing";
import { addDaysISO, formatDate, formatPeso, todayISO } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Card, Detail, Empty, Field, FormGrid, Input, LinkButton, PageHeader, SectionTitle, Select, Table, Td, Th } from "@/components/ui";
import { addDepositEntry, issueStatement, reverseDepositEntry, setChargeRule } from "../../actions";
import { Balance, ChargeForm, Ledger, PaymentForm, ReverseButton, StatusBadge } from "../../parts";

const DEPOSIT_LABELS = { received: "Received", deduction: "Deducted", refund: "Refunded" } as const;

export default async function CompanyAccountPage({ params }: PageProps<"/billing/contracts/[id]">) {
  const user = await requireStaff(CAN.viewBilling);
  const isAdmin = CAN.manageBilling.includes(user.role);
  const { id } = await params;
  const db = await getDb();
  const contract = await contractInReach(user, id);
  if (!contract || contract.status === "draft") notFound();
  const today = todayISO();
  const [client, account, draft, types, rules, rooms] = await Promise.all([
    db.query.clients.findFirst({ where: eq(schema.clients.id, contract.clientId) }),
    companyAccount(id, today),
    contract.status === "active" || isAdmin ? statementDraft(contract, today) : null,
    db.select().from(schema.chargeTypes).orderBy(asc(schema.chargeTypes.position), asc(schema.chargeTypes.name)),
    db.select().from(schema.contractChargeRules).where(eq(schema.contractChargeRules.contractId, id)),
    db
      .select({ id: schema.rooms.id, number: schema.rooms.number })
      .from(schema.contractRooms)
      .innerJoin(schema.rooms, eq(schema.contractRooms.roomId, schema.rooms.id))
      .where(eq(schema.contractRooms.contractId, id))
      .orderBy(asc(schema.rooms.floor), asc(schema.rooms.number)),
  ]);
  const ruleFor = new Map(rules.map((r) => [r.chargeTypeId, r.billTo]));
  const tooEarly = draft ? draft.period.start > addDaysISO(today, 31) : false;

  return (
    <>
      <PageHeader
        back={{ href: "/billing", label: "Billing" }}
        title={client?.name ?? "Company"}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge balance={account.balance} overdue={account.overdue} />
            <Link className="underline underline-offset-2" href={`/contracts/${contract.id}`}>Contract {contract.reference}</Link>
            <span>{formatDate(contract.startDate)} to {formatDate(contract.endDate)}</span>
          </span>
        }
        actions={
          <>
            <LinkButton href="#payment">Record a payment</LinkButton>
            <LinkButton variant="secondary" href="#charge">
              Add a charge
            </LinkButton>
          </>
        }
      />

      {account.overdue && (
        <Card className="mb-6 border-attention text-sm">
          {formatPeso(account.overdue.amount)} is overdue since {formatDate(account.overdue.since)} ({account.overdue.days}{" "}
          {account.overdue.days === 1 ? "day" : "days"}), starting with statement {account.overdue.statementNumber}.
        </Card>
      )}

      <Card className="mb-6">
        <dl className="grid gap-4 sm:grid-cols-4">
          <Detail label="Balance"><Balance amount={account.balance} className="text-base font-semibold" /></Detail>
          <Detail label="Not on a statement yet">{formatPeso(account.unbilledTotal)}</Detail>
          <Detail label="Payments since last statement">{formatPeso(account.unappliedTotal)}</Detail>
          <Detail label="Deposit held">{formatPeso(account.deposit.held)}</Detail>
        </dl>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {isAdmin && (
            <Card id="statement" className="scroll-mt-20">
              <SectionTitle>Next statement</SectionTitle>
              {!draft ? (
                <p className="text-sm text-muted">Every month of this contract has a statement.</p>
              ) : (
                <>
                  <p className="mb-3 text-sm text-muted">
                    Month {draft.month}: {formatDate(draft.period.start)} – {formatDate(draft.period.end)}. Issuing it adds the
                    month&apos;s rent and takes in everything below. Once issued it can&apos;t be changed; mistakes are corrected
                    on the next one.
                  </p>
                  <ul className="mb-4 divide-y divide-border border-y border-border text-sm">
                    <li className="flex justify-between gap-3 py-2"><span>Balance from last statement</span><span className="tabular-nums">{formatPeso(draft.previousBalance)}</span></li>
                    <li className="flex justify-between gap-3 py-2"><span>{draft.rentDescription}</span><span className="tabular-nums">{formatPeso(draft.rent)}</span></li>
                    {draft.charges.map((c) => (
                      <li key={c.charge.id} className="flex justify-between gap-3 py-2">
                        <span>{c.charge.description}{c.roomNumber && <span className="text-muted">, room {c.roomNumber}</span>}</span>
                        <span className="tabular-nums">{formatPeso(c.charge.amount)}</span>
                      </li>
                    ))}
                    {draft.payments.map((p) => (
                      <li key={p.payment.id} className="flex justify-between gap-3 py-2 text-muted">
                        <span>Payment received {formatDate(p.payment.receivedOn)}</span>
                        <span className="tabular-nums">−{formatPeso(p.payment.amount)}</span>
                      </li>
                    ))}
                    <li className="flex justify-between gap-3 py-2 font-semibold"><span>Balance due</span><span className="tabular-nums">{formatPeso(draft.balanceDue)}</span></li>
                  </ul>
                  {draft.missingRates > 0 ? (
                    <p className="text-sm text-attention">Some rooms have no rate yet. Set them on the contract before issuing.</p>
                  ) : tooEarly ? (
                    <p className="text-sm text-muted">You can issue this from {formatDate(addDaysISO(draft.period.start, -31))}.</p>
                  ) : (
                    <ActionForm action={issueStatement.bind(null, contract.id)} submitLabel={`Issue statement for month ${draft.month}`} pendingLabel="Issuing…">
                      <input type="hidden" name="month" value={draft.month} />
                      <FormGrid>
                        <Field label="Issue date">
                          <Input name="issuedOn" type="date" defaultValue={today} max={today} required />
                        </Field>
                        <Field label="Due date" hint={contract.paymentTerms ?? "Payment terms aren't set on the contract"}>
                          <Input name="dueDate" type="date" defaultValue={addDaysISO(today, 7)} required />
                        </Field>
                      </FormGrid>
                      <Field label="Note on the statement" hint="Optional, e.g. bank details for payment">
                        <Input name="notes" />
                      </Field>
                    </ActionForm>
                  )}
                </>
              )}
            </Card>
          )}

          <section>
            <SectionTitle>Statements</SectionTitle>
            {account.statements.length === 0 ? (
              <Empty>No statements issued yet.</Empty>
            ) : (
              <Table>
                <thead>
                  <tr><Th>Statement</Th><Th>Period</Th><Th>Due</Th><Th className="text-right">Balance due</Th></tr>
                </thead>
                <tbody>
                  {[...account.statements].reverse().map((s) => (
                    <tr key={s.id}>
                      <Td primary><Link className="font-medium underline underline-offset-2" href={`/billing/statements/${s.id}`}>{s.number}</Link></Td>
                      <Td label="Period">{formatDate(s.periodStart)} – {formatDate(s.periodEnd)}</Td>
                      <Td label="Due">{formatDate(s.dueDate)}</Td>
                      <Td label="Balance due" className="text-right tabular-nums">{formatPeso(s.balanceDue)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </section>

          <section>
            <SectionTitle>Charges and payments</SectionTitle>
            <Ledger charges={account.charges} payments={account.payments} canRecord canManage={isAdmin} showStatement showPerson />
          </section>
        </div>

        <div className="min-w-0 space-y-6">
          <Card id="payment" className="scroll-mt-20">
            <SectionTitle>Record a payment</SectionTitle>
            <PaymentForm billTo="company" contractId={contract.id} />
          </Card>
          <Card id="charge" className="scroll-mt-20">
            <SectionTitle>Add a charge</SectionTitle>
            <p className="mb-3 text-sm text-muted">For the company. For something one tenant should pay, add it on the tenant&apos;s page.</p>
            <ChargeForm types={types} contractId={contract.id} canCredit={isAdmin} fixedPayer="company">
              <Field label="Room" hint="Optional">
                <Select name="roomId" defaultValue="">
                  <option value="">Not for a room</option>
                  {rooms.map((r) => <option key={r.id} value={r.id}>{r.number}</option>)}
                </Select>
              </Field>
            </ChargeForm>
          </Card>

          <Card>
            <SectionTitle>Deposit</SectionTitle>
            <p className="mb-3 text-sm text-muted">
              The contract asks for {formatPeso(contract.deposit)}. Held now: <strong className="text-foreground">{formatPeso(account.deposit.held)}</strong>.
            </p>
            {account.deposit.entries.length > 0 && (
              <ul className="mb-4 divide-y divide-border text-sm">
                {account.deposit.entries.map((e) => (
                  <li key={e.id} className="py-2">
                    <div className="flex justify-between gap-3">
                      <span>{DEPOSIT_LABELS[e.kind]}{e.reversesId ? " (correction)" : ""}, {formatDate(e.entryOn)}</span>
                      <span className="tabular-nums">{formatPeso(e.amount)}</span>
                    </div>
                    <p className="text-xs text-muted">{e.description}</p>
                    {isAdmin && !e.reversesId && !account.deposit.entries.some((x) => x.reversesId === e.id) && (
                      <ReverseButton action={reverseDepositEntry.bind(null, e.id)} />
                    )}
                  </li>
                ))}
              </ul>
            )}
            {isAdmin && (
              <ActionForm action={addDepositEntry.bind(null, contract.id)} submitLabel="Save" resetOnSuccess>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
                  <Field label="What happened">
                    <Select name="kind" defaultValue="received">
                      <option value="received">Deposit received</option>
                      <option value="deduction">Deduction (damage, unpaid)</option>
                      <option value="refund">Refunded to the company</option>
                    </Select>
                  </Field>
                  <Field label="Amount (₱)">
                    <Input name="amount" inputMode="decimal" required />
                  </Field>
                  <Field label="Date">
                    <Input name="entryOn" type="date" defaultValue={today} max={today} required />
                  </Field>
                  <Field label="Note">
                    <Input name="description" required placeholder="e.g. Bank transfer ref. 1234" />
                  </Field>
                </div>
              </ActionForm>
            )}
          </Card>

          <Card>
            <SectionTitle>Who pays what</SectionTitle>
            <p className="mb-3 text-sm text-muted">Rent and utilities always go to the company. For everything else, choose who is charged under this contract.</p>
            <ul className="space-y-3">
              {types.filter((t) => t.active && t.code !== "rent" && t.code !== "utility").map((t) => {
                const rule = ruleFor.get(t.id);
                return (
                  <li key={t.id}>
                    {isAdmin ? (
                      <ActionForm action={setChargeRule.bind(null, contract.id)} submitLabel="Save" submitVariant="secondary" className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="chargeTypeId" value={t.id} />
                        <Field label={t.name} className="min-w-0 flex-1">
                          <Select name="billTo" defaultValue={rule ?? "default"}>
                            <option value="default">Usual: {BILL_TO_LABELS[t.defaultBillTo]}</option>
                            <option value="company">Company</option>
                            <option value="occupant">Tenant</option>
                          </Select>
                        </Field>
                      </ActionForm>
                    ) : (
                      <p className="flex justify-between gap-3 text-sm"><span>{t.name}</span><span>{BILL_TO_LABELS[rule ?? t.defaultBillTo]}</span></p>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
