import Link from "next/link";
import type { ReactNode } from "react";
import type { ChargeType } from "@/db/schema";
import { BILL_TO_LABELS, PAYMENT_METHOD_LABELS, type LedgerCharge, type LedgerPayment } from "@/lib/billing";
import { formatDate, formatPeso, todayISO } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Badge, Empty, Field, Input, Select, Table, Td, Th, Textarea, ViewTabs } from "@/components/ui";
import { addCharge, recordPayment, reverseCharge, reversePayment, switchPayer } from "./actions";

export function BillingTabs({ active, isAdmin }: { active: "accounts" | "utilities" | "settings"; isAdmin: boolean }) {
  return (
    <div className="mb-6">
      <ViewTabs
        items={[
          { href: "/billing", label: "Accounts", active: active === "accounts" },
          ...(isAdmin
            ? [
                { href: "/billing/utilities", label: "Utilities", active: active === "utilities" },
                { href: "/billing/settings", label: "Charge types", active: active === "settings" },
              ]
            : []),
        ]}
      />
    </div>
  );
}

/** "₱1,250.00" in red when someone owes, plain when settled, green when they paid ahead. */
export function Balance({ amount, className = "" }: { amount: number; className?: string }) {
  if (amount === 0) return <span className={className}>Settled</span>;
  if (amount < 0) return <span className={`text-emerald-700 dark:text-emerald-400 ${className}`}>{formatPeso(-amount)} paid ahead</span>;
  return <span className={className}>{formatPeso(amount)} owed</span>;
}

/** A small "Reverse" button that opens a reason field. Corrections never delete the original. */
export function ReverseButton({ action, label = "Reverse" }: { action: Parameters<typeof ActionForm>[0]["action"]; label?: string }) {
  return (
    <details className="group">
      <summary className="inline-flex min-h-9 cursor-pointer select-none items-center text-xs text-muted underline underline-offset-2 hover:text-foreground">
        {label}
      </summary>
      <div className="mt-2 w-64 max-w-full">
        <ActionForm action={action} submitLabel="Reverse it" submitVariant="danger" className="space-y-2">
          <Field label="Why">
            <Input name="reason" required placeholder="e.g. Entered twice" />
          </Field>
        </ActionForm>
      </div>
    </details>
  );
}

type Row =
  | { kind: "charge"; date: string; created: Date; item: LedgerCharge }
  | { kind: "payment"; date: string; created: Date; item: LedgerPayment };

/**
 * Charges and payments in date order with the running balance, like a passbook.
 * `showStatement` adds which statement each line went on (company accounts).
 */
export function Ledger({
  charges,
  payments,
  canRecord,
  canManage,
  showStatement,
  showPerson,
}: {
  charges: LedgerCharge[];
  payments: LedgerPayment[];
  canRecord: boolean;
  canManage: boolean;
  showStatement?: boolean;
  showPerson?: boolean;
}) {
  const rows: Row[] = [
    ...charges.map((item) => ({ kind: "charge" as const, date: item.charge.chargedOn, created: item.charge.createdAt, item })),
    ...payments.map((item) => ({ kind: "payment" as const, date: item.payment.receivedOn, created: item.payment.createdAt, item })),
  ].sort((a, b) => (a.date === b.date ? a.created.getTime() - b.created.getTime() : a.date < b.date ? -1 : 1));
  if (rows.length === 0) return <Empty>Nothing charged or paid yet.</Empty>;
  const amounts = rows.map((r) => (r.kind === "charge" ? r.item.charge.amount : -r.item.payment.amount));
  const withBalance = rows.map((r, i) => ({ ...r, balance: amounts.slice(0, i + 1).reduce((n, a) => n + a, 0) }));
  return (
    <Table>
      <thead>
        <tr>
          <Th>Date</Th>
          <Th>What</Th>
          <Th className="text-right">Charged</Th>
          <Th className="text-right">Paid</Th>
          <Th className="text-right">Balance</Th>
          <Th />
        </tr>
      </thead>
      <tbody>
        {withBalance.reverse().map((r) =>
          r.kind === "charge" ? (
            <tr key={r.item.charge.id}>
              <Td label="Date">{formatDate(r.date)}</Td>
              <Td primary wide>
                {r.item.charge.description}
                <span className="block text-xs text-muted">
                  {r.item.typeName}
                  {r.item.roomNumber && `, room ${r.item.roomNumber}`}
                  {showPerson && r.item.occupantName && `, ${r.item.occupantName}`}
                  {showStatement && (r.item.statementNumber ? `. On statement ${r.item.statementNumber}` : ". Not on a statement yet")}
                  {r.item.reversed && ". Reversed"}
                </span>
              </Td>
              <Td label="Charged" className="text-right tabular-nums">{formatPeso(r.item.charge.amount)}</Td>
              <Td className="text-right" />
              <Td label="Balance" className="text-right tabular-nums">{formatPeso(r.balance)}</Td>
              <Td className="no-print">
                <div className="flex flex-col items-start gap-1">
                  {canRecord && !r.item.charge.statementId && !r.item.reversed && !r.item.charge.reversesId && r.item.typeCode !== "rent" && r.item.typeCode !== "utility" && (r.item.charge.billTo === "company" ? r.item.charge.occupantId : r.item.charge.contractId) && (
                    <form action={async () => { "use server"; await switchPayer(r.item.charge.id); }}>
                      <button className="min-h-9 text-xs text-muted underline underline-offset-2 hover:text-foreground">
                        Bill the {r.item.charge.billTo === "company" ? "tenant" : "company"} instead
                      </button>
                    </form>
                  )}
                  {canManage && !r.item.reversed && !r.item.charge.reversesId && <ReverseButton action={reverseCharge.bind(null, r.item.charge.id)} />}
                </div>
              </Td>
            </tr>
          ) : (
            <tr key={r.item.payment.id}>
              <Td label="Date">{formatDate(r.date)}</Td>
              <Td primary wide>
                {r.item.payment.reversesId ? "Payment reversed" : `Payment, ${PAYMENT_METHOD_LABELS[r.item.payment.method]}`}
                <span className="block text-xs text-muted">
                  {[
                    r.item.payment.reference && `Ref. ${r.item.payment.reference}`,
                    r.item.payment.officialReceiptNo && `OR ${r.item.payment.officialReceiptNo}`,
                    r.item.payment.notes,
                    showStatement && (r.item.statementNumber ? `Counted on statement ${r.item.statementNumber}` : "Counted on the next statement"),
                    r.item.reversed && "Reversed",
                  ].filter(Boolean).join(". ")}
                  {r.item.payment.proofPhotoId && (
                    <>
                      {" "}
                      <Link className="underline" href={`/api/photos/${r.item.payment.proofPhotoId}`} target="_blank">Proof of payment</Link>
                    </>
                  )}
                </span>
              </Td>
              <Td className="text-right" />
              <Td label="Paid" className="text-right tabular-nums">{formatPeso(r.item.payment.amount)}</Td>
              <Td label="Balance" className="text-right tabular-nums">{formatPeso(r.balance)}</Td>
              <Td className="no-print">
                {canManage && !r.item.reversed && !r.item.payment.reversesId && (
                  <ReverseButton action={reversePayment.bind(null, r.item.payment.id)} label="Reverse (e.g. bounced check)" />
                )}
              </Td>
            </tr>
          ),
        )}
      </tbody>
    </Table>
  );
}

export function PaymentForm({ billTo, contractId, occupantId }: { billTo: "company" | "occupant"; contractId?: string; occupantId?: string }) {
  return (
    <ActionForm action={recordPayment} submitLabel="Record payment" resetOnSuccess>
      <input type="hidden" name="billTo" value={billTo} />
      {contractId && <input type="hidden" name="contractId" value={contractId} />}
      {occupantId && <input type="hidden" name="occupantId" value={occupantId} />}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
        <Field label="Amount received (₱)">
          <Input name="amount" inputMode="decimal" required />
        </Field>
        <Field label="Date received">
          <Input name="receivedOn" type="date" defaultValue={todayISO()} max={todayISO()} required />
        </Field>
        <Field label="Paid by">
          <Select name="method" defaultValue="bank_transfer">
            {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </Select>
        </Field>
        <Field label="Reference or check number" hint="Needed for bank, GCash, Maya and checks">
          <Input name="reference" />
        </Field>
        <Field label="Official receipt number" hint="Optional, from the hotel's own receipt book or system">
          <Input name="officialReceiptNo" />
        </Field>
        <Field label="Photo of the proof" hint="Optional, e.g. a deposit slip or screenshot">
          <Input name="proof" type="file" accept="image/*" />
        </Field>
      </div>
      <Field label="Notes">
        <Input name="notes" />
      </Field>
    </ActionForm>
  );
}

export function ChargeForm({
  types,
  contractId,
  occupantId,
  canCredit,
  fixedPayer,
  children,
}: {
  types: ChargeType[];
  contractId?: string;
  occupantId?: string;
  canCredit: boolean;
  fixedPayer?: "company" | "occupant";
  children?: ReactNode;
}) {
  const choices = types.filter((t) => t.active && t.code !== "rent" && t.code !== "utility");
  return (
    <ActionForm action={addCharge} submitLabel="Add charge" resetOnSuccess>
      {contractId && <input type="hidden" name="contractId" value={contractId} />}
      {occupantId && <input type="hidden" name="occupantId" value={occupantId} />}
      {fixedPayer && <input type="hidden" name="billTo" value={fixedPayer} />}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
        <Field label="For">
          <Select name="chargeTypeId" required>
            {choices.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Amount (₱)">
          <Input name="amount" inputMode="decimal" required />
        </Field>
        <Field label="Date">
          <Input name="chargedOn" type="date" defaultValue={todayISO()} max={todayISO()} required />
        </Field>
        {!fixedPayer && (
          <Field label="Who pays" hint="Normally set by the contract's charge rules">
            <Select name="billTo" defaultValue="rule">
              <option value="rule">As the contract&apos;s rules say</option>
              <option value="company">{BILL_TO_LABELS.company}</option>
              <option value="occupant">{BILL_TO_LABELS.occupant}</option>
            </Select>
          </Field>
        )}
        {children}
      </div>
      <Field label="Description" hint="Shown on the statement, e.g. Replacement key card">
        <Textarea name="description" rows={2} required />
      </Field>
      {canCredit && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="credit" /> This is a credit or discount (it lowers what they owe)
        </label>
      )}
    </ActionForm>
  );
}

export function StatusBadge({ balance, overdue }: { balance: number; overdue: { days: number } | null }) {
  if (overdue) return <Badge tone="red">Overdue {overdue.days} {overdue.days === 1 ? "day" : "days"}</Badge>;
  if (balance > 0) return <Badge tone="amber">Owes</Badge>;
  if (balance < 0) return <Badge tone="green">Paid ahead</Badge>;
  return <Badge tone="gray">Settled</Badge>;
}

