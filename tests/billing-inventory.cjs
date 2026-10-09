/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS loader isolates Next request APIs in these integration tests. */
// Billing, utilities and room inventory: real server actions against a disposable PGlite
// database. Only request auth and navigation are stubbed, as in business-rules.cjs.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const Module = require('node:module');
const { AsyncLocalStorage } = require('node:async_hooks');
process.env.PGLITE_DIR = mkdtempSync('/private/tmp/vendra-billing-tests-');
const actors = new AsyncLocalStorage();
const originalLoad = Module._load;
let auth;
Module._load = function (id, parent, ...rest) {
  if (id === 'next/link') return function Link() {};
  if (id === 'next/cache') return { revalidatePath() {} };
  if (id === 'next/navigation') return { redirect(to) { throw Object.assign(new Error('redirect'), { to }); }, notFound() { throw new Error('forbidden'); } };
  if (id === 'next/headers') return { cookies: async () => ({ get: () => undefined, set() {}, delete() {} }) };
  if (auth && (id === '@/lib/auth' || /\/src\/lib\/auth(?:\.ts)?$/.test(id))) return {
    ...auth,
    requireStaff: async (roles = auth.STAFF_ROLES) => { const actor = actors.getStore(); if (!actor || !roles.includes(actor.role)) throw new Error('forbidden'); return actor; },
    requireUser: async () => actors.getStore(),
  };
  return originalLoad.call(this, id, parent, ...rest);
};
auth = require('../src/lib/auth.ts');
const { getDb, schema } = require('../src/db/index.ts');
const { and, eq } = require('drizzle-orm');
const { addDaysISO, todayISO } = require('../src/lib/format.ts');
const { rentChargeForMonth, rentSchedule, contractTotal, contractMonths } = require('../src/lib/rent.ts');
const billing = require('../src/lib/billing.ts');
const billingActions = require('../src/app/(app)/billing/actions.ts');
const utilities = require('../src/app/(app)/billing/utilities/actions.ts');
const inventory = require('../src/app/(app)/inventory/actions.ts');
const { checkDifferences } = require('../src/lib/inventory.ts');

const today = todayISO();
let db, admin, desk, fix, company, roomType, contractSerial = 0, roomSerial = 0;
const fd = (values) => { const form = new FormData(); for (const [k, v] of Object.entries(values)) for (const x of Array.isArray(v) ? v : [v]) form.append(k, String(x ?? '')); return form; };
const as = (actor, fn, ...args) => actors.run(actor, () => fn(...args));
/** Runs an action that redirects on success and returns where it went. */
async function redirected(actor, fn, ...args) {
  try { const result = await as(actor, fn, ...args); assert.fail(`expected a redirect, got ${JSON.stringify(result)}`); }
  catch (e) { if (!e.to) throw e; return e.to; }
}
const idFrom = (path) => path.split('/').pop();

async function newContract({ start = addDaysISO(today, -60), rent = 10000000, deposit = 0, rooms = 1, policy = 'full', end } = {}) {
  const [contract] = await db.insert(schema.contracts).values({
    clientId: company.id, reference: `C-${++contractSerial}`, startDate: start, endDate: end ?? addDaysISO(start, 729),
    monthlyRent: rent, deposit, partialMonthPolicy: policy, status: 'active',
  }).returning();
  const made = [];
  for (let i = 0; i < rooms; i++) {
    const [r] = await db.insert(schema.rooms).values({ number: `B${++roomSerial}`, floor: 1, capacity: 2, roomTypeId: roomType.id, qrToken: `bq${roomSerial}` }).returning();
    await db.insert(schema.contractRooms).values({ contractId: contract.id, roomId: r.id });
    made.push(r);
  }
  return { contract, rooms: made };
}
async function tenantIn(room, contract) {
  const [o] = await db.insert(schema.occupants).values({ fullName: `Tenant ${++roomSerial}`, clientId: company.id }).returning();
  const [a] = await db.insert(schema.roomAssignments).values({ occupantId: o.id, roomId: room.id, contractId: contract.id, checkIn: contract.startDate }).returning();
  return { occupant: o, stay: a };
}
const type = (code) => billing.chargeTypeByCode(code);

before(async () => {
  db = await getDb();
  [admin, desk, fix] = await db.insert(schema.staff).values([
    { name: 'Admin', username: 'b.admin', role: 'admin', passwordHash: 'x' },
    { name: 'Desk', username: 'b.desk', role: 'front_desk', passwordHash: 'x' },
    { name: 'Fix', username: 'b.fix', role: 'maintenance', passwordHash: 'x' },
  ]).returning();
  [company] = await db.insert(schema.clients).values({ name: 'Billing Co' }).returning();
  [roomType] = await db.insert(schema.roomTypes).values({ name: 'Twin test' }).returning();
});

test('the migration seeds the built-in charge types and utilities', async () => {
  for (const code of ['rent', 'utility', 'laundry', 'damage', 'cleaning', 'lost_key', 'other']) assert.ok(await type(code));
  const utilities = await db.select().from(schema.utilityTypes);
  assert.deepEqual(utilities.map((u) => u.name).sort(), ['Electricity', 'Water']);
});

test('monthly rent charges add up to the contract total, including a prorated final month', () => {
  const steps = [{ startMonth: 13, kind: 'percent', value: 500 }];
  for (const policy of ['full', 'prorated']) {
    const start = '2026-01-15', end = '2027-02-01';
    const months = contractMonths(start, end);
    let sum = 0;
    for (let m = 1; m <= months; m++) sum += rentChargeForMonth(1000000, steps, start, end, policy, m);
    assert.equal(sum, contractTotal(rentSchedule(1000000, steps, start, end, policy)));
  }
});

test('a statement adds the month\'s rent, takes in unbilled charges and payments, and is frozen', async () => {
  const { contract, rooms } = await newContract();
  const other = await type('other');
  assert.ok((await as(desk, billingActions.addCharge, {}, fd({ contractId: contract.id, chargeTypeId: other.id, description: 'Parking', amount: '500', roomId: rooms[0].id }))).ok);
  assert.ok((await as(desk, billingActions.recordPayment, {}, fd({ billTo: 'company', contractId: contract.id, amount: '20,000', method: 'cash' }))).ok);

  const first = idFrom(await redirected(admin, billingActions.issueStatement, contract.id, {}, fd({ month: 1, issuedOn: today, dueDate: addDaysISO(today, 7) })));
  const s1 = await db.query.statements.findFirst({ where: eq(schema.statements.id, first) });
  assert.equal(s1.rentMonth, 1);
  assert.equal(s1.previousBalance, 0);
  assert.equal(s1.newCharges, 10000000 + 50000);
  assert.equal(s1.paymentsReceived, 2000000);
  assert.equal(s1.balanceDue, 10050000 - 2000000);
  const lines = await db.select().from(schema.charges).where(eq(schema.charges.statementId, first));
  assert.equal(lines.length, 2);

  // Later charges wait for the next statement; the first one doesn't change.
  assert.ok((await as(desk, billingActions.addCharge, {}, fd({ contractId: contract.id, chargeTypeId: other.id, description: 'Extra key', amount: '100' }))).ok);
  assert.ok((await as(admin, billingActions.issueStatement, contract.id, {}, fd({ month: 1, issuedOn: today }))).error, 'month 1 cannot be issued twice');
  const second = idFrom(await redirected(admin, billingActions.issueStatement, contract.id, {}, fd({ month: 2, issuedOn: today, dueDate: addDaysISO(today, 7) })));
  const s2 = await db.query.statements.findFirst({ where: eq(schema.statements.id, second) });
  assert.equal(s2.previousBalance, s1.balanceDue);
  assert.equal(s2.newCharges, 10000000 + 10000);
  assert.equal((await db.query.statements.findFirst({ where: eq(schema.statements.id, first) })).balanceDue, s1.balanceDue);
  const account = await billing.companyAccount(contract.id, today);
  assert.equal(account.balance, s2.balanceDue);
});

test('front desk and maintenance cannot issue statements or make corrections', async () => {
  const { contract } = await newContract();
  await assert.rejects(as(desk, billingActions.issueStatement, contract.id, {}, fd({ month: 1, issuedOn: today })));
  await assert.rejects(as(fix, billingActions.recordPayment, {}, fd({ billTo: 'company', contractId: contract.id, amount: '1', method: 'cash' })));
  const other = await type('other');
  assert.ok((await as(desk, billingActions.addCharge, {}, fd({ contractId: contract.id, chargeTypeId: other.id, description: 'x', amount: '5', credit: 'on' }))).error, 'only the admin gives credits');
  const charge = await db.query.charges.findFirst({ where: eq(schema.charges.contractId, contract.id) });
  assert.equal(charge, undefined);
});

test('statements issue in order and not long before their month starts', async () => {
  const { contract } = await newContract({ start: addDaysISO(today, 90) });
  assert.ok((await as(admin, billingActions.issueStatement, contract.id, {}, fd({ month: 1, issuedOn: today }))).error);
  const { contract: c2 } = await newContract();
  assert.ok((await as(admin, billingActions.issueStatement, c2.id, {}, fd({ month: 2, issuedOn: today }))).error, 'month 2 before month 1');
});

test('charge rules decide who pays; a charge can switch payer only until it is on a statement', async () => {
  const { contract, rooms } = await newContract();
  const { occupant } = await tenantIn(rooms[0], contract);
  const damage = await type('damage');
  assert.ok((await as(desk, billingActions.addCharge, {}, fd({ occupantId: occupant.id, chargeTypeId: damage.id, description: 'Broken chair', amount: '800' }))).ok);
  let charge = await db.query.charges.findFirst({ where: and(eq(schema.charges.occupantId, occupant.id), eq(schema.charges.description, 'Broken chair')) });
  assert.equal(charge.billTo, 'company', 'damage goes to the company by default');
  assert.equal(charge.contractId, contract.id);

  assert.ok((await as(admin, billingActions.setChargeRule, contract.id, {}, fd({ chargeTypeId: damage.id, billTo: 'occupant' }))).ok);
  assert.ok((await as(desk, billingActions.addCharge, {}, fd({ occupantId: occupant.id, chargeTypeId: damage.id, description: 'Torn curtain', amount: '300' }))).ok);
  const torn = await db.query.charges.findFirst({ where: eq(schema.charges.description, 'Torn curtain') });
  assert.equal(torn.billTo, 'occupant');
  assert.equal((await billing.occupantAccount(occupant.id)).balance, 30000);

  assert.ok((await as(desk, billingActions.switchPayer, charge.id)).ok);
  charge = await db.query.charges.findFirst({ where: eq(schema.charges.id, charge.id) });
  assert.equal(charge.billTo, 'occupant');
  assert.ok((await as(desk, billingActions.switchPayer, charge.id)).ok);
  await redirected(admin, billingActions.issueStatement, contract.id, {}, fd({ month: 1, issuedOn: today }));
  assert.ok((await as(desk, billingActions.switchPayer, charge.id)).error, 'on a statement now');
  assert.ok((await as(admin, billingActions.setChargeRule, contract.id, {}, fd({ chargeTypeId: (await type('rent')).id, billTo: 'occupant' }))).error, 'rent is always the company');
});

test('reversals undo charges and payments once, keeping the originals', async () => {
  const { contract } = await newContract();
  const other = await type('other');
  await as(desk, billingActions.addCharge, {}, fd({ contractId: contract.id, chargeTypeId: other.id, description: 'Typo charge', amount: '999' }));
  const charge = await db.query.charges.findFirst({ where: eq(schema.charges.description, 'Typo charge') });
  await assert.rejects(as(desk, billingActions.reverseCharge, charge.id, {}, fd({ reason: 'mistake' })));
  assert.ok((await as(admin, billingActions.reverseCharge, charge.id, {}, fd({ reason: '' }))).error, 'a reason is required');
  assert.ok((await as(admin, billingActions.reverseCharge, charge.id, {}, fd({ reason: 'Entered by mistake' }))).ok);
  assert.ok((await as(admin, billingActions.reverseCharge, charge.id, {}, fd({ reason: 'again' }))).error);
  assert.ok(await db.query.charges.findFirst({ where: eq(schema.charges.id, charge.id) }), 'the original stays');
  assert.equal((await billing.companyAccount(contract.id, today)).balance, 0);

  await as(desk, billingActions.recordPayment, {}, fd({ billTo: 'company', contractId: contract.id, amount: '5000', method: 'check', reference: 'CHK-1' }));
  assert.ok((await as(desk, billingActions.recordPayment, {}, fd({ billTo: 'company', contractId: contract.id, amount: '5000', method: 'check' }))).error, 'checks need a number');
  const payment = await db.query.payments.findFirst({ where: and(eq(schema.payments.contractId, contract.id), eq(schema.payments.reference, 'CHK-1')) });
  assert.ok((await as(admin, billingActions.reversePayment, payment.id, {}, fd({ reason: 'Check bounced' }))).ok);
  assert.equal((await billing.companyAccount(contract.id, today)).balance, 0);
});

test('overdue counts what is still owed on statements past their due date, oldest first', async () => {
  const { contract } = await newContract();
  await redirected(admin, billingActions.issueStatement, contract.id, {}, fd({ month: 1, issuedOn: addDaysISO(today, -20), dueDate: addDaysISO(today, -10) }));
  await as(desk, billingActions.recordPayment, {}, fd({ billTo: 'company', contractId: contract.id, amount: '40000', method: 'cash' }));
  const account = await billing.companyAccount(contract.id, today);
  assert.equal(account.overdue.amount, 10000000 - 4000000);
  assert.equal(account.overdue.days, 10);
  await as(desk, billingActions.recordPayment, {}, fd({ billTo: 'company', contractId: contract.id, amount: '60000', method: 'cash' }));
  assert.equal((await billing.companyAccount(contract.id, today)).overdue, null);
});

test('utility bills: meter readings × rate, no lower readings, no double periods until reversed', async () => {
  const { contract } = await newContract();
  const electricity = await db.query.utilityTypes.findFirst({ where: eq(schema.utilityTypes.name, 'Electricity') });
  const base = { utilityTypeId: electricity.id, contractId: contract.id, periodStart: addDaysISO(today, -40), periodEnd: addDaysISO(today, -10) };
  assert.ok((await as(admin, utilities.addUtilityBill, {}, fd({ ...base, method: 'meter', previousReading: '1000', currentReading: '900', rate: '12.5' }))).error);
  assert.ok((await as(admin, utilities.addUtilityBill, {}, fd({ ...base, method: 'meter', previousReading: '1000', currentReading: '1123.4', rate: '12.5432' }))).ok);
  const bill = await db.query.utilityBills.findFirst({ where: eq(schema.utilityBills.contractId, contract.id) });
  assert.equal(bill.amount, Math.round(123.4 * 12.5432 * 100));
  const charge = await db.query.charges.findFirst({ where: eq(schema.charges.id, bill.chargeId) });
  assert.equal(charge.billTo, 'company');
  assert.equal(charge.amount, bill.amount);
  assert.ok((await as(admin, utilities.addUtilityBill, {}, fd({ ...base, method: 'bill', amount: '1000' }))).error, 'same period twice');
  await as(admin, billingActions.reverseCharge, bill.chargeId, {}, fd({ reason: 'Wrong reading' }));
  assert.ok((await as(admin, utilities.addUtilityBill, {}, fd({ ...base, method: 'bill', amount: '1500.25' }))).ok, 'allowed again after reversal');
  await assert.rejects(as(desk, utilities.addUtilityBill, {}, fd({ ...base, method: 'bill', amount: '1' })));
  assert.equal(billing.meterAmount(0, 1, 1), 0);
});

test('the deposit cannot pay out more than is held', async () => {
  const { contract } = await newContract({ deposit: 2000000 });
  assert.ok((await as(admin, billingActions.addDepositEntry, contract.id, {}, fd({ kind: 'deduction', amount: '1', description: 'x' }))).error);
  assert.ok((await as(admin, billingActions.addDepositEntry, contract.id, {}, fd({ kind: 'received', amount: '20000', description: 'Bank ref 1' }))).ok);
  assert.ok((await as(admin, billingActions.addDepositEntry, contract.id, {}, fd({ kind: 'refund', amount: '20000.01', description: 'too much' }))).error);
  assert.ok((await as(admin, billingActions.addDepositEntry, contract.id, {}, fd({ kind: 'deduction', amount: '5000', description: 'Broken TV' }))).ok);
  assert.equal((await billing.companyAccount(contract.id, today)).deposit.held, 1500000);
});

test('inventory: standard list, move-in and move-out checks, and charging what changed', async () => {
  const { contract, rooms } = await newContract({ deposit: 1000000 });
  const room = rooms[0];
  assert.ok((await as(admin, inventory.saveTemplate, roomType.id, null, {}, fd({ name: 'Chair', category: 'furniture', quantity: 2, replacementCost: '1,500' }))).ok);
  assert.ok((await as(admin, inventory.saveTemplate, roomType.id, null, {}, fd({ name: 'Aircon', category: 'appliance', quantity: 1, replacementCost: '25000', serviceEveryMonths: 6 }))).ok);
  await assert.rejects(as(desk, inventory.applyTemplates, roomType.id), 'only the admin manages standard lists');
  assert.ok((await as(admin, inventory.applyTemplates, roomType.id)).ok);
  assert.match((await as(admin, inventory.applyTemplates, roomType.id)).ok, /already/, 'running it again adds nothing');
  const items = await db.select().from(schema.roomItems).where(eq(schema.roomItems.roomId, room.id));
  const chair = items.find((i) => i.name === 'Chair'), aircon = items.find((i) => i.name === 'Aircon');
  assert.ok(chair && aircon);

  const { occupant, stay } = await tenantIn(room, contract);
  const line = (found, condition) => ({ [`found_${chair.id}`]: found, [`condition_${chair.id}`]: condition });
  await redirected(fix, inventory.recordCheck, room.id, {}, fd({ kind: 'move_in', assignmentId: stay.id, checkedOn: today, ...line(2, 'good'), [`found_${aircon.id}`]: 1, [`condition_${aircon.id}`]: 'good' }));
  assert.ok((await as(fix, inventory.recordCheck, room.id, {}, fd({ kind: 'move_out', checkedOn: today, ...line(2, 'good'), [`found_${aircon.id}`]: 1, [`condition_${aircon.id}`]: 'good' }))).error, 'move-out needs the stay');
  assert.ok((await as(fix, inventory.recordCheck, room.id, {}, fd({ kind: 'spot', checkedOn: today, ...line(3, 'good'), [`found_${aircon.id}`]: 1, [`condition_${aircon.id}`]: 'good' }))).error, 'cannot find more than there should be');
  const outId = idFrom(await redirected(fix, inventory.recordCheck, room.id, {}, fd({ kind: 'move_out', assignmentId: stay.id, checkedOn: today, ...line(1, 'good'), [`found_${aircon.id}`]: 1, [`condition_${aircon.id}`]: 'damaged' })));

  const check = await db.query.inventoryChecks.findFirst({ where: eq(schema.inventoryChecks.id, outId) });
  const { baseline, differences } = await checkDifferences(check);
  assert.equal(baseline.kind, 'move_in');
  assert.equal(differences.length, 2);
  const missingChair = differences.find((d) => d.item.id === chair.id);
  assert.equal(missingChair.missing, 1);
  assert.equal(missingChair.suggested, 150000);
  assert.equal((await db.query.roomItems.findFirst({ where: eq(schema.roomItems.id, aircon.id) })).condition, 'damaged', 'the check updates the item');

  await assert.rejects(as(fix, inventory.chargeDifference, outId, missingChair.line.id, {}, fd({ amount: '1500' })), 'maintenance does not charge');
  assert.ok((await as(desk, inventory.chargeDifference, outId, missingChair.line.id, {}, fd({ amount: '1500', billTo: 'occupant' }))).ok);
  assert.ok((await as(desk, inventory.chargeDifference, outId, missingChair.line.id, {}, fd({ amount: '1500', billTo: 'occupant' }))).error, 'only once');
  assert.equal((await billing.occupantAccount(occupant.id)).balance, 150000);

  // Handover against the contract-start check, paid from the deposit.
  await as(admin, billingActions.addDepositEntry, contract.id, {}, fd({ kind: 'received', amount: '10000', description: 'Deposit' }));
  await db.update(schema.roomItems).set({ condition: 'good' }).where(eq(schema.roomItems.id, aircon.id));
  await redirected(admin, inventory.recordCheck, room.id, {}, fd({ kind: 'contract_start', checkedOn: contract.startDate, ...line(2, 'good'), [`found_${aircon.id}`]: 1, [`condition_${aircon.id}`]: 'good' }));
  const handId = idFrom(await redirected(admin, inventory.recordCheck, room.id, {}, fd({ kind: 'handover', checkedOn: today, ...line(2, 'good'), [`found_${aircon.id}`]: 0, [`condition_${aircon.id}`]: 'good' })));
  const hand = await db.query.inventoryChecks.findFirst({ where: eq(schema.inventoryChecks.id, handId) });
  const { baseline: start, differences: lost } = await checkDifferences(hand);
  assert.equal(start.kind, 'contract_start');
  assert.equal(lost.length, 1);
  assert.equal(lost[0].line.condition, 'missing', 'found 0 means missing');
  assert.ok((await as(admin, inventory.deductDifference, handId, lost[0].line.id, {}, fd({ amount: '25000' }))).error, 'more than the deposit held');
  assert.ok((await as(admin, inventory.deductDifference, handId, lost[0].line.id, {}, fd({ amount: '10000' }))).ok);
  assert.equal((await billing.companyAccount(contract.id, today)).deposit.held, 0);
});

test('a damaged item can book a repair visit in one step; retired items keep their history', async () => {
  const { rooms } = await newContract();
  assert.ok((await as(desk, inventory.addItem, rooms[0].id, {}, fd({ name: 'Desk lamp', category: 'fixture', quantity: 1, replacementCost: '600', tagCode: 'lamp-1' }))).ok);
  assert.ok((await as(desk, inventory.addItem, rooms[0].id, {}, fd({ name: 'Other lamp', category: 'fixture', quantity: 1, tagCode: 'LAMP-1' }))).error, 'tag codes are unique');
  await assert.rejects(as(fix, inventory.addItem, rooms[0].id, {}, fd({ name: 'x', category: 'fixture', quantity: 1 })));
  const lamp = await db.query.roomItems.findFirst({ where: eq(schema.roomItems.tagCode, 'LAMP-1') });
  assert.ok((await as(fix, inventory.setItemCondition, lamp.id, {}, fd({ condition: 'damaged', note: 'Flickers', repair: 'on', repairDate: addDaysISO(today, 1) }))).ok);
  const visit = await db.query.maintenanceVisits.findFirst({ where: and(eq(schema.maintenanceVisits.roomId, rooms[0].id), eq(schema.maintenanceVisits.title, 'Repair: Desk lamp')) });
  assert.ok(visit);
  assert.ok((await as(admin, inventory.retireItem, lamp.id, {}, fd({ reason: '' }))).error, 'a reason is required');
  assert.equal(await redirected(admin, inventory.retireItem, lamp.id, {}, fd({ reason: 'Beyond repair' })), `/inventory/rooms/${rooms[0].id}`);
  const retired = await db.query.roomItems.findFirst({ where: eq(schema.roomItems.id, lamp.id) });
  assert.equal(retired.retiredOn, today);
  const events = await db.select().from(schema.itemEvents).where(eq(schema.itemEvents.itemId, lamp.id));
  assert.deepEqual(events.map((e) => e.kind).sort(), ['added', 'condition', 'retired']);
});

test('a tenant\'s own account shows only what they pay personally', async () => {
  const { contract, rooms } = await newContract();
  const { occupant } = await tenantIn(rooms[0], contract);
  const laundry = await type('laundry'), other = await type('other');
  await as(desk, billingActions.addCharge, {}, fd({ occupantId: occupant.id, chargeTypeId: laundry.id, description: 'Laundry 4 kg', amount: '240' }));
  await as(desk, billingActions.addCharge, {}, fd({ occupantId: occupant.id, chargeTypeId: other.id, description: 'Company pays this', amount: '1000' }));
  await as(desk, billingActions.recordPayment, {}, fd({ billTo: 'occupant', occupantId: occupant.id, amount: '100', method: 'cash' }));
  const account = await billing.occupantAccount(occupant.id);
  assert.deepEqual(account.charges.map((c) => c.charge.description), ['Laundry 4 kg']);
  assert.equal(account.balance, 14000);
});
