/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS loader isolates Next request APIs in these integration tests. */
// Room availability: when each room is free to lease, and beds free inside leases,
// computed from real rows in a disposable PGlite database.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const Module = require('node:module');
process.env.PGLITE_DIR = mkdtempSync('/private/tmp/vendra-availability-tests-');
process.on('exit', () => rmSync(process.env.PGLITE_DIR, { recursive: true, force: true })); // don't leave a database per run behind
const originalLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'next/navigation') return { redirect() { throw new Error('redirect'); }, notFound() { throw new Error('forbidden'); } };
  if (id === 'next/headers') return { cookies: async () => ({ get: () => undefined, set() {}, delete() {} }) };
  return originalLoad.call(this, id, parent, ...rest);
};
const { getDb, schema } = require('../src/db/index.ts');
const { addDaysISO, todayISO } = require('../src/lib/format.ts');
const { getAvailability, roomOn, firstFreeDay, stayEnds } = require('../src/lib/availability.ts');

const T = todayISO();
const d = (n) => addDaysISO(T, n);
let rooms;

before(async () => {
  const db = await getDb();
  const [hotel] = await db.insert(schema.properties).values({ name: 'Availability test hotel' }).returning();
  const room = async (number, capacity, condition = 'ready') =>
    (await db.insert(schema.rooms).values({ propertyId: hotel.id, number, floor: 1, capacity, condition, qrToken: `avail-${number}` }).returning())[0];
  const [A, B, C, D, , F, G] = [await room('A', 2), await room('B', 2), await room('C', 1), await room('D', 1), await room('E', 1, 'not_available'), await room('F', 1), await room('G', 3)];
  const [client] = await db.insert(schema.clients).values({ name: 'Acme' }).returning();
  const lease = async (reference, start, end, roomIds, status = 'active') => {
    const [c] = await db.insert(schema.contracts).values({ clientId: client.id, propertyId: hotel.id, reference, startDate: start, endDate: end, status }).returning();
    await db.insert(schema.contractRooms).values(roomIds.map((roomId) => ({ contractId: c.id, roomId })));
  };
  await lease('L1', d(-100), d(40), [B.id, C.id, G.id]);
  await lease('L2', d(41), d(400), [C.id]);
  await lease('L3', d(20), d(200), [F.id]);
  await lease('Draft', d(-10), d(300), [A.id], 'draft'); // a draft is not a lease yet
  const stay = async (name, roomId, checkIn, expectedCheckOut = null) => {
    const [o] = await db.insert(schema.occupants).values({ fullName: name, propertyId: hotel.id }).returning();
    await db.insert(schema.roomAssignments).values({ occupantId: o.id, roomId, checkIn, expectedCheckOut });
  };
  await stay('Xavier', B.id, d(-30), d(10));
  await stay('Yolanda', B.id, d(-30));
  await stay('Zed', D.id, d(-5));
  await stay('Gina', G.id, d(-5));
  await stay('Hugo', G.id, d(5));
  rooms = Object.fromEntries((await getAvailability(T, hotel.id)).map((r) => [r.number, r]));
});

test('an empty room with no lease is free now and stays free', () => {
  assert.equal(rooms.A.freeFrom, T);
  assert.equal(rooms.A.freeUntil, null);
  assert.equal(rooms.A.lease, null, 'draft contracts are not leases');
});

test('a full leased room frees up when its lease ends; the next bed frees with the first move-out', () => {
  const B = rooms.B;
  assert.equal(B.lease.reference, 'L1');
  assert.equal(B.bedsFree, 0);
  assert.equal(B.nextBedFreeOn, d(10));
  assert.equal(B.freeFrom, d(41));
  assert.deepEqual(B.tenants.map((t) => [t.fullName, t.leavesOn]), [['Xavier', d(10)], ['Yolanda', d(41)]], 'no move-out date means until the lease ends');
});

test('back-to-back leases push the free date past both', () => {
  assert.equal(rooms.C.nextLease.reference, 'L2');
  assert.equal(rooms.C.freeFrom, d(401));
});

test('a tenant with no move-out date and no lease makes the date unknown', () => {
  assert.equal(rooms.D.freeFrom, null);
  assert.equal(rooms.D.unknownBecause, 'no_move_out');
});

test('an out-of-service room is never offered', () => {
  assert.equal(rooms.E.freeFrom, null);
  assert.equal(rooms.E.unknownBecause, 'out_of_service');
  assert.equal(roomOn(rooms.E, d(500), T).freeToLease, false);
});

test('a room free now but leased later shows until when', () => {
  assert.equal(rooms.F.freeFrom, T);
  assert.equal(rooms.F.freeUntil, d(19));
  assert.equal(roomOn(rooms.F, d(10), T).freeToLease, true);
  assert.equal(roomOn(rooms.F, d(25), T).freeToLease, false);
});

test('beds free inside a lease count bookings', () => {
  assert.equal(rooms.G.bedsFree, 1, '3 beds, 1 living there, 1 booked');
  assert.equal(rooms.G.booked[0].fullName, 'Hugo');
});

test('a later date shows who is still there', () => {
  assert.deepEqual(roomOn(rooms.B, d(5), T), { lease: rooms.B.lease, people: 2, freeToLease: false, bedsFree: 0 });
  assert.equal(roomOn(rooms.B, d(15), T).bedsFree, 1, 'Xavier moved out');
  assert.equal(roomOn(rooms.B, d(50), T).freeToLease, true, 'lease over, Yolanda gone with it');
});

test('the date helpers on their own', () => {
  assert.equal(stayEnds({ checkIn: d(-1), expectedCheckOut: null }, [], T), null);
  assert.equal(firstFreeDay([{ startDate: d(0), endDate: d(5) }], [{ checkIn: d(3), ends: d(9) }], T), d(9));
  assert.equal(firstFreeDay([], [{ checkIn: d(2), ends: d(4) }], T), T, 'a later booking does not block today');
});
