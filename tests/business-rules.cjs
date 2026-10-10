/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS loader isolates Next request APIs in these integration tests. */
// Exercise real server actions and PGlite transactions; stub only request auth/navigation.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const Module = require('node:module');
const { AsyncLocalStorage } = require('node:async_hooks');
process.env.PGLITE_DIR = mkdtempSync('/private/tmp/vendra-tests-');
const actors = new AsyncLocalStorage();
const cookieJar = new Map();
const originalLoad = Module._load;
let auth;
Module._load = function (id, parent, ...rest) {
  if (id === 'next/link') return function Link() {};
  if (id === 'next/cache') return { revalidatePath() {} };
  if (id === 'next/navigation') return { redirect(to) { throw Object.assign(new Error('redirect'), { to }); }, notFound() { throw new Error('forbidden'); } };
  if (id === 'next/headers') return { cookies: async () => ({ get: key => cookieJar.has(key) ? { value: cookieJar.get(key) } : undefined, set: (key,value) => cookieJar.set(key,value), delete: key => cookieJar.delete(key) }) };
  if (auth && (id === '@/lib/auth' || /\/src\/lib\/auth(?:\.ts)?$/.test(id))) return {
    ...auth,
    requireStaff: async (roles = auth.STAFF_ROLES) => { const actor = actors.getStore(); if (!actor || !roles.includes(actor.role)) throw new Error('forbidden'); return actor; },
    requireUser: async () => actors.getStore(),
    requireTenant: async () => ({ user: actors.getStore(), occupant: await (await getDb()).query.occupants.findFirst({ where: eq(schema.occupants.id, actors.getStore().occupantId) }) }),
    currentSessionId: async () => 'keep-session',
  };
  return originalLoad.call(this, id, parent, ...rest);
};
auth = require('../src/lib/auth.ts');
const { getDb, schema } = require('../src/db/index.ts');
const { eq, sql } = require('drizzle-orm');
const { addDaysISO, todayISO, isISODate, parsePeso } = require('../src/lib/format.ts');
const { rentSchedule, contractTotal, rentForMonth } = require('../src/lib/rent.ts');
const { getRoomBoard } = require('../src/lib/rooms.ts');
const { getCurrentStay } = require('../src/lib/portal.ts');
const occupancy = require('../src/app/(app)/occupants/actions.ts');
const contracts = require('../src/app/(app)/contracts/actions.ts');
const requests = require('../src/app/(app)/requests/actions.ts');
const visits = require('../src/app/(app)/maintenance/actions.ts');
const doorCode = require('../src/app/r/[token]/actions.ts');
const roomActions = require('../src/app/(app)/rooms/actions.ts');
const housekeeping = require('../src/app/(app)/housekeeping/actions.ts');
const areaActions = require('../src/app/(app)/rooms/door-codes/actions.ts');
const { cleaningsDue } = require('../src/lib/housekeeping.ts');
const laundry = require('../src/app/(app)/laundry/actions.ts');
const checklists = require('../src/app/(app)/maintenance/checklists/actions.ts');
const { checklistsDue } = require('../src/lib/checklists.ts');
const { reportLaundryClaim } = require('../src/app/me/actions.ts');
const { importOccupants } = require('../src/app/(app)/assignments/import/actions.ts');
const { cancelRequest, createRequest } = require('../src/app/me/actions.ts');
const { changeOwnPassword } = require('../src/app/(app)/staff/actions.ts');
const today = todayISO();
let db, admin, fix, otherFix, company, otherCompany, contract;
const fd = values => { const form = new FormData(); for (const [key,value] of Object.entries(values)) for (const v of Array.isArray(value) ? value : [value]) form.append(key, String(v ?? '')); return form; };
const run = (fn, ...args) => actors.run(admin, () => fn(...args));
let serial = 0;
async function room(capacity = 1, covered = true) {
  const [r] = await db.insert(schema.rooms).values({ number: `T${++serial}`, floor: 1, capacity, qrToken: `q${serial}` }).returning();
  if (covered) await db.insert(schema.contractRooms).values({ contractId: contract.id, roomId: r.id });
  return r;
}
async function person(clientId = company.id) {
  return (await db.insert(schema.occupants).values({ fullName: `Person ${++serial}`, clientId }).returning())[0];
}
async function assign(p,r,extra={}) {
  return run(occupancy.assignRoom, p.id, {}, fd({ roomId:r.id,checkIn:today,slot:'A',...extra }));
}
async function openStay(p) { return db.query.roomAssignments.findFirst({ where:eq(schema.roomAssignments.occupantId,p.id),orderBy:(a,{desc})=>[desc(a.createdAt)] }); }
before(async () => {
  db = await getDb();
  [admin,fix,otherFix] = await db.insert(schema.staff).values([
    { name:'Admin',username:'test.admin',role:'admin',passwordHash:await auth.hashPassword('password123') },
    { name:'Fix',username:'test.fix',role:'maintenance',passwordHash:'unused' },
    { name:'Other',username:'test.other',role:'maintenance',passwordHash:'unused' },
  ]).returning();
  [company,otherCompany] = await db.insert(schema.clients).values([{name:'Company A'},{name:'Company B'}]).returning();
  [contract] = await db.insert(schema.contracts).values({clientId:company.id,reference:'ACTIVE',startDate:addDaysISO(today,-60),endDate:addDaysISO(today,400),monthlyRent:1000000,status:'active'}).returning();
});
test('calendar dates, safe money and explicit partial-month policy', () => {
  assert.equal(isISODate('2026-02-31'),false);
  assert.equal(isISODate('2024-02-29'),true);
  const {normalizeDate}=require('../src/lib/csv.ts');
  assert.equal(normalizeDate('31-Feb-2026'),null);
  assert.equal(normalizeDate('29-Feb-2024'),'2024-02-29');
  assert.equal(normalizeDate('1/15/2027'),'2027-01-15');
  assert.equal(parsePeso('9007199254740992'),null);
  assert.throws(()=>rentForMonth(1000000,[{startMonth:2,kind:'percent',value:-15000}],2));
  assert.equal(contractTotal(rentSchedule(1000000,[],'2026-01-01','2026-02-01','full')),2000000);
  assert.equal(contractTotal(rentSchedule(1000000,[],'2026-01-01','2026-02-01','prorated')),1035714);
});
test('assignment requires company contract, coverage and a ready room', async () => {
  const p = await person(); const wrong = await person(otherCompany.id); const r = await room(); const bare = await room(1,false);
  assert.ok((await assign(wrong,r)).error);
  assert.ok((await assign(p,bare)).error);
  assert.ok((await assign(p,r,{expectedCheckOut:addDaysISO(contract.endDate,2)})).error);
  await db.update(schema.rooms).set({condition:'needs_work'}).where(eq(schema.rooms.id,r.id));
  assert.ok((await assign(p,r)).error);
  assert.equal(await openStay(p),undefined);
});
test('concurrent staff cannot take the same final bed', async () => {
  const r=await room(); const people=await Promise.all([person(),person()]);
  const results=await Promise.all(people.map(p=>assign(p,r)));
  assert.equal(results.filter(x=>x.ok).length,1);
  assert.equal(results.filter(x=>x.error).length,1);
  const rows=await db.query.roomAssignments.findMany({where:eq(schema.roomAssignments.roomId,r.id)});
  assert.equal(rows.length,1);
});
test('future arrivals reserve beds but do not become current portal stays', async () => {
  const r=await room(); const p=await person();
  assert.ok((await assign(p,r,{checkIn:addDaysISO(today,10)})).ok);
  assert.equal(await getCurrentStay(p.id),null);
  const board=(await getRoomBoard(today)).find(x=>x.id===r.id);
  assert.equal(board.occupants.length,0);assert.equal(board.upcoming.length,1);assert.equal(board.assignableBeds,0);
});
test('future actual moves and departures do not alter current occupancy', async () => {
  const r=await room(); const to=await room();const p=await person();await assign(p,r);const stay=await openStay(p);
  assert.ok((await run(occupancy.transferRoom,stay.id,{},fd({roomId:to.id,date:addDaysISO(today,7)}))).error);
  assert.ok((await run(occupancy.checkOut,stay.id,{},fd({date:addDaysISO(today,7)}))).error);
  assert.equal((await getCurrentStay(p.id)).room.id,r.id);
});
test('a failed transfer rolls back the old stay, new stay and audit together', async () => {
  const r=await room();const to=await room();const p=await person();await assign(p,r);const stay=await openStay(p);
  await db.execute(sql`CREATE FUNCTION reject_transfer_audit() RETURNS trigger AS $$ BEGIN IF NEW.action = 'transfer' THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
  await db.execute(sql`CREATE TRIGGER reject_transfer BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_transfer_audit()`);
  try { await assert.rejects(run(occupancy.transferRoom,stay.id,{},fd({roomId:to.id,date:today}))); }
  finally { await db.execute(sql`DROP TRIGGER reject_transfer ON audit_log`); }
  assert.equal((await getCurrentStay(p.id)).room.id,r.id);
  assert.equal((await db.query.roomAssignments.findMany({where:eq(schema.roomAssignments.occupantId,p.id)})).length,1);
  assert.ok((await run(occupancy.transferRoom,stay.id,{},fd({roomId:to.id,date:today}))).ok);
  assert.equal((await getCurrentStay(p.id)).room.id,to.id);
});
test('assignment edits revalidate dates and company changes cannot invalidate open stays', async () => {
  const r=await room();const p=await person();await assign(p,r);const stay=await openStay(p);
  assert.ok((await run(occupancy.updateOccupant,p.id,{},fd({fullName:p.fullName,clientId:otherCompany.id}))).error);
  await run(occupancy.checkOut,stay.id,{},fd({date:today}));
  assert.ok((await run(occupancy.editAssignment,stay.id,{},fd({checkIn:addDaysISO(today,1)}))).error);
});
test('CSV failure leaves no partial rows and uses company coverage rules', async () => {
  const r=await room(2);const wrong=await room(2,false);const before=(await db.query.occupants.findMany()).length;
  const result=await run(importOccupants,{},fd({clientId:company.id,pasted:`full_name,room,check_in\nImport One,${r.number},${today}\nImport Two,${wrong.number},${today}`}));
  assert.ok(result.error);assert.equal((await db.query.occupants.findMany()).length,before);
});
test('activated contracts preserve rates, rooms and terms; drafts require valid rent', async () => {
  const r=await room();
  assert.ok((await run(contracts.updateContractRooms,contract.id,{},fd({contractRoomIds:['anything'],intent:'remove'}))).error);
  assert.ok((await run(contracts.addRentStep,contract.id,{},fd({startMonth:2,kind:'percent',value:'5'}))).error);
  assert.ok((await run(contracts.updateContract,contract.id,{},fd({...contract,monthlyRent:'1',deposit:'0',advance:'0',billingDay:1}))).error);
  const [draft]=await db.insert(schema.contracts).values({clientId:company.id,reference:'DRAFT',startDate:today,endDate:addDaysISO(today,90),rentType:'per_room'}).returning();
  await db.insert(schema.contractRooms).values({contractId:draft.id,roomId:r.id});
  assert.ok((await run(contracts.setContractStatus,draft.id,{},fd({status:'active'}))).error);
  assert.ok((await run(contracts.addRentStep,draft.id,{},fd({startMonth:2,kind:'percent',value:'-150'}))).error);
  assert.ok((await run(contracts.addRentStep,draft.id,{},fd({startMonth:99,kind:'amount',value:'1000'}))).error);
});
test('request and visit dates, completion, reopening and cancellation stay consistent', async () => {
  const r=await room();const p=await person();await assign(p,r);
  const [request]=await db.insert(schema.tenantRequests).values({occupantId:p.id,roomId:r.id,kind:'issue',details:'Repair this'}).returning();
  assert.ok((await run(requests.updateRequest,request.id,{},fd({status:'approved',scheduledDate:today,assigneeId:fix.id}))).ok);
  const visit=await db.query.maintenanceVisits.findFirst({where:eq(schema.maintenanceVisits.requestId,request.id)});assert.ok(visit);
  const tomorrow=addDaysISO(today,1);
  assert.ok((await actors.run(fix,()=>visits.updateVisit(visit.id,{},fd({status:'scheduled',date:tomorrow,timeFrom:'10:00',timeTo:'11:00'})))).ok);
  let q=await db.query.tenantRequests.findFirst({where:eq(schema.tenantRequests.id,request.id)});assert.equal(q.scheduledDate,tomorrow);assert.equal(q.scheduledFrom,'10:00');
  await run(requests.updateRequest,request.id,{},fd({status:'done',scheduledDate:tomorrow}));
  assert.equal((await db.query.maintenanceVisits.findFirst({where:eq(schema.maintenanceVisits.id,visit.id)})).status,'done');
  await run(requests.updateRequest,request.id,{},fd({status:'approved',scheduledDate:tomorrow}));
  assert.equal((await db.query.maintenanceVisits.findMany({where:eq(schema.maintenanceVisits.requestId,request.id)})).length,1);
  await run(visits.updateVisit,visit.id,{},fd({status:'cancelled',date:tomorrow}));
  q=await db.query.tenantRequests.findFirst({where:eq(schema.tenantRequests.id,request.id)});assert.equal(q.status,'pending');assert.equal(q.scheduledDate,null);
});
test('maintenance cannot handle laundry or another technician request, including visit updates', async () => {
  const r=await room();const p=await person();
  const [laundry,repair]=await db.insert(schema.tenantRequests).values([
    {occupantId:p.id,roomId:r.id,kind:'laundry',details:'Laundry'},
    {occupantId:p.id,roomId:r.id,kind:'maintenance',details:'Fix',assigneeId:otherFix.id},
  ]).returning();
  for(const q of [laundry,repair])assert.ok((await actors.run(fix,()=>requests.updateRequest(q.id,{},fd({status:'done'})))).error);
  await run(requests.updateRequest,repair.id,{},fd({status:'approved',scheduledDate:today}));
  const v=await db.query.maintenanceVisits.findFirst({where:eq(schema.maintenanceVisits.requestId,repair.id)});
  assert.ok((await actors.run(fix,()=>visits.updateVisit(v.id,{},fd({status:'done',date:today})))).error);
});
test('withdrawal retains request history and cannot be reopened by staff', async () => {
  const p=await person();const r=await room();const [q]=await db.insert(schema.tenantRequests).values({occupantId:p.id,roomId:r.id,kind:'issue',details:'Withdraw me'}).returning();
  const [tenant]=await db.insert(schema.staff).values({name:p.fullName,username:`tenant${serial}`,role:'tenant',occupantId:p.id,passwordHash:'unused'}).returning();
  assert.ok((await actors.run(tenant,()=>cancelRequest(q.id))).ok);
  const saved=await db.query.tenantRequests.findFirst({where:eq(schema.tenantRequests.id,q.id)});assert.ok(saved.cancelledAt);
  assert.ok((await run(requests.updateRequest,q.id,{},fd({status:'approved'}))).error);
});
test('own-password changes revoke other sessions; repeated login failures are throttled', async () => {
  await db.insert(schema.sessions).values(['keep-session','other-session'].map(id=>({id,staffId:admin.id,expiresAt:new Date(Date.now()+3600000)})));
  assert.ok((await run(changeOwnPassword,{},fd({current:'password123',next:'newpassword123',confirm:'newpassword123'}))).ok);
  assert.deepEqual((await db.query.sessions.findMany({where:eq(schema.sessions.staffId,admin.id)})).map(s=>s.id),['keep-session']);
  for(let i=0;i<8;i++)assert.equal(await auth.signIn(admin.username,'bad-password'),false);
  assert.equal(await auth.signIn(admin.username,'newpassword123'),false);
  await db.update(schema.loginAttempts).set({windowStart:new Date(Date.now()-16*60000)});
  assert.equal(await auth.signIn(admin.username,'newpassword123'),true);
});
test('error results roll back all changes, even after writes', async () => {
  const {mutate}=require('../src/lib/mutations.ts');
  const name='Must roll back';
  assert.ok((await mutate(async()=>{await (await getDb()).insert(schema.clients).values({name});return {error:'cancel'};})).error);
  assert.equal(await db.query.clients.findFirst({where:eq(schema.clients.name,name)}),undefined);
});
test('future reservation cancellation releases the bed and retains audit evidence', async () => {
  const r=await room(); const p=await person();
  await assign(p,r,{checkIn:addDaysISO(today,5)});const stay=await openStay(p);
  assert.ok((await run(occupancy.cancelReservation,stay.id)).ok);
  assert.equal(await openStay(p),undefined);
  const event=await db.query.auditLog.findFirst({where:eq(schema.auditLog.entityId,stay.id),orderBy:(a,{desc})=>[desc(a.at)]});
  assert.equal(event.action,'cancel_reservation');assert.equal(event.detail.before.checkIn,addDaysISO(today,5));
  assert.ok((await assign(p,r)).ok);
  assert.ok((await run(occupancy.cancelReservation,(await openStay(p)).id)).error);
});
test('database uniqueness protects open stays and rent-step months from direct duplicate inserts', async () => {
  const r=await room(2);const p=await person();await assign(p,r);
  await assert.rejects(db.insert(schema.roomAssignments).values({occupantId:p.id,roomId:r.id,checkIn:today}));
  const [draft]=await db.insert(schema.contracts).values({clientId:company.id,reference:'Unique steps',startDate:today,endDate:addDaysISO(today,400)}).returning();
  const step={contractId:draft.id,startMonth:2,kind:'percent',value:100};
  await db.insert(schema.rentSteps).values(step);
  await assert.rejects(db.insert(schema.rentSteps).values(step));
});
test('unassigned visits can be claimed; another technician cannot change them', async () => {
  const r=await room();
  const [visit]=await db.insert(schema.maintenanceVisits).values({roomId:r.id,title:'Routine work',date:today,createdBy:admin.id}).returning();
  assert.ok((await actors.run(fix,()=>visits.updateVisit(visit.id,{},fd({status:'done',date:today})))).ok);
  assert.equal((await db.query.maintenanceVisits.findFirst({where:eq(schema.maintenanceVisits.id,visit.id)})).assigneeId,fix.id);
  assert.ok((await actors.run(otherFix,()=>visits.updateVisit(visit.id,{},fd({status:'scheduled',date:today})))).error);
});
test('staff can log an in-person report only for a current resident', async () => {
  const r=await room();const p=await person();
  assert.ok((await run(requests.createStaffRequest,{},fd({occupantId:p.id,kind:'issue',details:'Phone report'}))).error);
  await assign(p,r);
  assert.ok((await run(requests.createStaffRequest,{},fd({occupantId:p.id,kind:'issue',details:'Phone report'}))).ok);
});
test('request pagination keeps old work reachable beyond 200 rows', async () => {
  const r=await room();const p=await person();
  await db.insert(schema.tenantRequests).values(Array.from({length:205},(_,i)=>({occupantId:p.id,roomId:r.id,kind:'issue',details:`Queue ${String(i).padStart(3,'0')}`,createdAt:new Date(Date.UTC(2020,0,1,0,i))})));
  const Page=require('../src/app/(app)/requests/page.tsx').default;
  const first=JSON.stringify(await actors.run(admin,()=>Page({searchParams:Promise.resolve({})})));
  assert.ok(first.includes('Queue 000'));assert.ok(!first.includes('Queue 204'));assert.ok(first.includes('/requests?view=open&page=2'));
  const fifth=JSON.stringify(await actors.run(admin,()=>Page({searchParams:Promise.resolve({page:'5'})})));
  assert.ok(fifth.includes('Queue 204'));
});

test('tenant, front desk, maintenance and admin complete one service lifecycle', async () => {
  const r=await room();const p=await person();await assign(p,r);
  const [tenant,desk]=await db.insert(schema.staff).values([
    {name:p.fullName,username:`lifecycle.tenant${serial}`,role:'tenant',occupantId:p.id,passwordHash:'unused'},
    {name:'Desk',username:`lifecycle.desk${serial}`,role:'front_desk',passwordHash:'unused'},
  ]).returning();
  const details='WALKTHROUGH TEST — no physical service needed';
  assert.ok((await actors.run(tenant,()=>createRequest({},fd({kind:'maintenance',details,preferredDate:today})))).ok);
  const request=await db.query.tenantRequests.findFirst({where:eq(schema.tenantRequests.occupantId,p.id)});
  assert.equal(request.status,'pending');assert.equal(request.roomId,r.id);
  assert.ok((await actors.run(desk,()=>requests.updateRequest(request.id,{},fd({status:'approved',scheduledDate:today,timeFrom:'10:00',timeTo:'11:00',assigneeId:fix.id,response:'Test appointment only.'})))).ok);
  const visit=await db.query.maintenanceVisits.findFirst({where:eq(schema.maintenanceVisits.requestId,request.id)});
  assert.equal(visit.assigneeId,fix.id);assert.equal(visit.status,'scheduled');
  assert.ok((await actors.run(fix,()=>visits.updateVisit(visit.id,{},fd({status:'done',date:today,timeFrom:'10:00',timeTo:'11:00',notes:'Test completed; no physical work.'})))).ok);
  const saved=await db.query.tenantRequests.findFirst({where:eq(schema.tenantRequests.id,request.id)});
  assert.equal(saved.status,'done');assert.equal(saved.response,'Test appointment only.');
  const TenantPage=require('../src/app/me/requests/page.tsx').default;
  const screen=JSON.stringify(await actors.run(tenant,()=>TenantPage({searchParams:Promise.resolve({})})));
  assert.ok(screen.includes(details));assert.ok(screen.includes('Appointment date'));assert.ok(screen.includes('Staff reply: Test appointment only.'));assert.ok(!screen.includes('Booked for'));
  const audit=await db.query.auditLog.findMany();
  assert.ok(audit.some(e=>e.entityId===request.id&&e.action==='create'));
  assert.ok(audit.some(e=>e.entityId===request.id&&e.action==='update'));
  assert.ok(audit.some(e=>e.entityId===visit.id&&e.action==='update'));
  const AdminAudit=require('../src/app/(app)/audit/page.tsx').default;
  const auditScreen=JSON.stringify(await actors.run(admin,()=>AdminAudit({searchParams:Promise.resolve({})})));
  assert.ok(auditScreen.includes(request.id));assert.ok(auditScreen.includes(visit.id));
});

test('tenant history exposes older requests without exposing another tenant records', async () => {
  const p=await person();const other=await person();
  const [tenant]=await db.insert(schema.staff).values({name:p.fullName,username:`history.tenant${serial}`,role:'tenant',occupantId:p.id,passwordHash:'unused'}).returning();
  await db.insert(schema.tenantRequests).values(Array.from({length:51},(_,i)=>({occupantId:p.id,kind:'issue',details:`History ${String(i).padStart(3,'0')}`,createdAt:new Date(Date.UTC(2021,0,1,0,i))})));
  await db.insert(schema.tenantRequests).values({occupantId:other.id,kind:'issue',details:'PRIVATE OTHER TENANT'});
  const Page=require('../src/app/me/requests/page.tsx').default;
  const render=async page=>JSON.stringify(await actors.run(tenant,()=>Page({searchParams:Promise.resolve({page})})));
  const first=await render('1');const last=await render('2');
  assert.ok(first.includes('History 050'));assert.ok(!first.includes('History 000'));assert.ok(first.includes('/me/requests?page=2'));
  assert.ok(last.includes('History 000'));assert.ok(last.includes('/me/requests?page=1'));
  assert.ok(!first.includes('PRIVATE OTHER TENANT'));assert.ok(!last.includes('PRIVATE OTHER TENANT'));
  assert.ok((await render('999')).includes('History 000'));
});

test('every account role can edit only its own profile, without changing access or resident records', async () => {
  const {updateOwnProfile}=require('../src/app/profile-actions.ts');
  const p=await person();
  for (const role of ['admin','front_desk','maintenance','tenant']) {
    const [account]=await db.insert(schema.staff).values({name:`Profile ${role}`,username:`profile.${role}`,role,passwordHash:'unchanged',...(role==='tenant'?{occupantId:p.id}:{})}).returning();
    const result=await actors.run(account,()=>updateOwnProfile({},fd({name:'  My display name  ',email:'  profile@example.com  ',phone:'+63 917 123 4567',id:admin.id,role:'admin',username:'hijack',occupantId:'fake',active:'false'})));
    assert.ok(result.ok);
    const saved=await db.query.staff.findFirst({where:eq(schema.staff.id,account.id)});
    assert.equal(saved.name,'My display name');assert.equal(saved.email,'profile@example.com');assert.equal(saved.phone,'+63 917 123 4567');
    assert.equal(saved.role,role);assert.equal(saved.username,account.username);assert.equal(saved.active,true);assert.equal(saved.passwordHash,'unchanged');assert.equal(saved.occupantId,account.occupantId);
    const event=await db.query.auditLog.findFirst({where:eq(schema.auditLog.entityId,account.id)});
    assert.equal(event.action,'update_profile');assert.equal(event.detail.before.name,account.name);assert.equal(event.detail.after.email,'profile@example.com');assert.ok(!JSON.stringify(event.detail).includes('passwordHash'));
    for(const invalid of [{name:' '},{name:'x'.repeat(101)},{email:'not-an-email'},{phone:'abc123'}]) {
      assert.ok((await actors.run(account,()=>updateOwnProfile({},fd({name:'Changed',email:'',phone:'',...invalid})))).error);
      assert.equal((await db.query.staff.findFirst({where:eq(schema.staff.id,account.id)})).name,'My display name');
    }
    assert.ok((await actors.run(account,()=>updateOwnProfile({},fd({name:'My display name',email:'',phone:''})))).ok);
    const cleared=await db.query.staff.findFirst({where:eq(schema.staff.id,account.id)});assert.equal(cleared.email,null);assert.equal(cleared.phone,null);
  }
  assert.equal((await db.query.occupants.findFirst({where:eq(schema.occupants.id,p.id)})).fullName,p.fullName);
  assert.equal((await db.query.staff.findFirst({where:eq(schema.staff.id,admin.id)})).name,admin.name);
  await assert.rejects(updateOwnProfile({},fd({name:'Anonymous'})));
});

test('every role can save, replace, read and remove only its own profile photo', async () => {
  const sharp = require('sharp');
  const { uploadOwnPhoto, removeOwnPhoto } = require('../src/app/profile-actions.ts');
  const { GET } = require('../src/app/api/profile/photo/route.ts');
  const bytes = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#228877' } }).png().toBuffer();
  const form = (data=bytes, type='image/png') => { const f=new FormData(); f.append('photo',new File([data],'photo.png',{type})); f.append('staffId',admin.id); return f; };
  for (const role of ['admin','front_desk','maintenance','tenant']) {
    const [account] = await db.insert(schema.staff).values({name:'Photo test',username:`photo.${role}`,role,passwordHash:'unused'}).returning();
    await actors.run(account, async () => {
      assert.ok((await uploadOwnPhoto({},form())).ok);
      const first=await db.query.accountPhotos.findFirst({where:eq(schema.accountPhotos.staffId,account.id)});
      assert.ok(first);
      const response=await GET(); assert.equal(response.status,200); assert.equal(response.headers.get('cache-control'),'private, no-store');
      const meta=await sharp(Buffer.from(await response.arrayBuffer())).metadata();
      assert.equal(meta.width,512); assert.equal(meta.height,512); assert.equal(meta.format,'webp'); assert.equal(meta.exif,undefined);
      assert.ok((await uploadOwnPhoto({},form(Buffer.from('not an image')))).error);
      assert.ok((await uploadOwnPhoto({},form(Buffer.alloc(2*1024*1024+1)))).error);
      assert.ok((await uploadOwnPhoto({},form(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')))).error);
      assert.equal((await db.query.accountPhotos.findFirst({where:eq(schema.accountPhotos.staffId,account.id)})).version,first.version);
      assert.ok((await uploadOwnPhoto({},form())).ok);
      assert.notEqual((await db.query.accountPhotos.findFirst({where:eq(schema.accountPhotos.staffId,account.id)})).version,first.version);
      assert.equal(await db.query.accountPhotos.findFirst({where:eq(schema.accountPhotos.staffId,admin.id)}),undefined);
      assert.ok((await removeOwnPhoto()).ok);
      assert.equal((await GET()).status,404);
    });
  }
});
test('door-code check-ins: right room, own visits, no duplicates, replaced codes stop working', async () => {
  const r=await room(); const other=await room();
  const [visit,elsewhere,theirs]=await db.insert(schema.maintenanceVisits).values([
    {roomId:r.id,title:'Aircon cleaning',date:today,createdBy:admin.id},
    {roomId:other.id,title:'Other room',date:today,createdBy:admin.id},
    {roomId:r.id,title:'Assigned to someone else',date:today,assigneeId:otherFix.id,createdBy:admin.id},
  ]).returning();
  const checkIn=(actor,token,visitId)=>actors.run(actor,()=>doorCode.checkIn(token,{},fd({visitId:visitId??''})));
  const count=async()=>(await db.query.roomCheckIns.findMany({where:eq(schema.roomCheckIns.roomId,r.id)})).length;
  assert.ok((await checkIn(fix,r.qrToken,elsewhere.id)).error);
  assert.ok((await checkIn(fix,r.qrToken,theirs.id)).error);
  assert.equal(await count(),0);
  assert.ok((await checkIn(fix,r.qrToken,visit.id)).ok);
  assert.ok((await checkIn(fix,r.qrToken,visit.id)).ok);
  assert.equal(await count(),1);
  assert.ok((await checkIn(fix,r.qrToken)).ok);
  assert.equal(await count(),2);
  assert.ok((await actors.run(otherFix,()=>doorCode.finishVisit(r.qrToken,visit.id))).ok);
  assert.ok((await actors.run(fix,()=>doorCode.finishVisit(r.qrToken,theirs.id))).error);
  assert.equal((await db.query.maintenanceVisits.findFirst({where:eq(schema.maintenanceVisits.id,visit.id)})).status,'done');
  assert.ok((await run(roomActions.replaceDoorCode,r.id)).ok);
  assert.ok((await checkIn(fix,r.qrToken)).error);
  await assert.rejects(()=>actors.run(fix,()=>roomActions.replaceDoorCode(r.id)));
});
const redirectedTo = async (promise) => { try { await promise; } catch (e) { if (e.to) return e.to; throw e; } assert.fail('expected a redirect'); };
test('cleaning from the door: front desk only, one open cleaning per room, finishing resets the schedule', async () => {
  const r=await room();
  const [desk]=await db.insert(schema.staff).values({name:'Desk',username:`clean.desk${++serial}`,role:'front_desk',passwordHash:'unused'}).returning();
  assert.ok((await run(housekeeping.setCleaningSchedule,{},fd({which:`room:${r.id}`,every:'7'}))).ok);
  assert.ok((await run(housekeeping.setCleaningSchedule,{},fd({which:`room:${r.id}`,every:'0'}))).error);
  assert.equal((await cleaningsDue(today)).find((d)=>d.id===r.id).due,today);
  await assert.rejects(()=>actors.run(fix,()=>doorCode.startCleaning(r.qrToken)));
  const first=await redirectedTo(actors.run(desk,()=>doorCode.startCleaning(r.qrToken)));
  const again=await redirectedTo(actors.run(admin,()=>doorCode.startCleaning(r.qrToken)));
  assert.equal(first,again);
  const cleaning=await db.query.cleanings.findFirst({where:eq(schema.cleanings.roomId,r.id)});
  assert.ok(cleaning.checkInId && cleaning.steps.length>0);
  const checkIn=await db.query.roomCheckIns.findFirst({where:eq(schema.roomCheckIns.id,cleaning.checkInId)});
  assert.equal(checkIn.purpose,'cleaning');
  assert.ok((await actors.run(desk,()=>housekeeping.saveCleaning(cleaning.id,{},fd({step_0:'on'})))).ok);
  assert.equal(await redirectedTo(actors.run(desk,()=>housekeeping.saveCleaning(cleaning.id,{},fd({step_0:'on',finish:'1'})))),'/housekeeping');
  const done=await db.query.cleanings.findFirst({where:eq(schema.cleanings.id,cleaning.id)});
  assert.ok(done.finishedAt); assert.equal(done.steps[0].done,true); assert.equal(done.steps[1].done,false);
  assert.ok((await actors.run(desk,()=>housekeeping.saveCleaning(cleaning.id,{},fd({finish:'1'})))).error);
  assert.equal((await cleaningsDue(today)).find((d)=>d.id===r.id).due,addDaysISO(today,7));
  await assert.rejects(()=>actors.run(desk,()=>housekeeping.saveChecklist({},fd({steps:'Sweep'}))));
});
test('items check from the door records an inventory check-in and opens the right kind', async () => {
  const r=await room();
  assert.equal(await redirectedTo(actors.run(fix,()=>doorCode.startItemsCheck(r.qrToken,'move_out'))),`/inventory/rooms/${r.id}?kind=move_out#check`);
  const c=await db.query.roomCheckIns.findFirst({where:eq(schema.roomCheckIns.roomId,r.id)});
  assert.equal(c.purpose,'inventory');
  assert.ok((await actors.run(fix,()=>doorCode.startItemsCheck(r.qrToken,'handover'))).error);
});
test('shared-space reports: problems only, active places only, no room attached', async () => {
  const r=await room(); const p=await person(); await assign(p,r);
  const [tenant]=await db.insert(schema.staff).values({name:p.fullName,username:`area.tenant${++serial}`,role:'tenant',occupantId:p.id,passwordHash:'unused'}).returning();
  assert.ok((await run(areaActions.addArea,{},fd({name:`Kitchen ${serial}`,floor:'2'}))).ok);
  await assert.rejects(()=>actors.run(fix,()=>areaActions.addArea({},fd({name:'Nope'}))));
  const area=await db.query.areas.findFirst({where:eq(schema.areas.name,`Kitchen ${serial}`)});
  assert.ok((await actors.run(tenant,()=>createRequest({},fd({kind:'maintenance',details:'x',preferredDate:today,areaId:area.id})))).error);
  assert.ok((await actors.run(tenant,()=>createRequest({},fd({kind:'issue',details:'Stove broken',areaId:area.id})))).ok);
  const req=await db.query.tenantRequests.findFirst({where:eq(schema.tenantRequests.areaId,area.id)});
  assert.equal(req.roomId,null);
  assert.ok((await run(areaActions.updateArea,area.id,{},fd({name:area.name,floor:'2'}))).ok);
  assert.ok((await actors.run(tenant,()=>createRequest({},fd({kind:'issue',details:'Again',areaId:area.id})))).error);
});
test('laundry: desk to shop to tenant, priced by weight with a minimum, charged once, claims only by the owner', async () => {
  const r=await room(); const p=await person(); await assign(p,r); const other=await person();
  const [tenant]=await db.insert(schema.staff).values({name:p.fullName,username:`laundry.tenant${++serial}`,role:'tenant',occupantId:p.id,passwordHash:'unused'}).returning();
  const [stranger]=await db.insert(schema.staff).values({name:other.fullName,username:`laundry.other${++serial}`,role:'tenant',occupantId:other.id,passwordHash:'unused'}).returning();
  await assert.rejects(()=>actors.run(fix,()=>laundry.saveService(null,{},fd({name:'x',ratePerKilo:'50'}))));
  assert.ok((await run(laundry.saveService,null,{},fd({name:`Wash ${serial}`,ratePerKilo:'60',costPerKilo:'40',minimumCharge:'150',turnaroundDays:'2'}))).ok);
  const service=await db.query.laundryServices.findFirst({where:eq(schema.laundryServices.name,`Wash ${serial}`)});
  assert.ok((await run(laundry.receiveLoad,{},fd({occupantId:other.id,serviceId:service.id,bags:'1'}))).error, 'no stay, no load');
  assert.ok((await run(laundry.receiveLoad,{},fd({occupantId:p.id,serviceId:service.id,bags:'2'}))).ok);
  const [small]=await db.select().from(schema.laundryLoads).where(eq(schema.laundryLoads.occupantId,p.id));
  assert.equal(small.roomId,r.id);
  assert.ok((await run(laundry.receiveLoad,{},fd({occupantId:p.id,serviceId:service.id,bags:'1'}))).ok);
  const big=(await db.select().from(schema.laundryLoads).where(eq(schema.laundryLoads.occupantId,p.id))).find(l=>l.id!==small.id);
  assert.ok((await run(laundry.sendToShop,{},fd({loadId:[small.id,big.id]}))).ok);
  assert.ok((await run(laundry.sendToShop,{},fd({loadId:[small.id]}))).error, 'already sent');
  assert.ok((await actors.run(tenant,()=>reportLaundryClaim(small.id,{},fd({kind:'missing',details:'Shirt'})))).error, 'not back yet');
  assert.ok((await run(laundry.recordReturn,small.id,{},fd({kilos:'abc'}))).error);
  assert.ok((await run(laundry.recordReturn,small.id,{},fd({kilos:'1.5'}))).ok);
  assert.ok((await run(laundry.recordReturn,big.id,{},fd({kilos:'4.25'}))).ok);
  assert.ok((await run(laundry.recordReturn,big.id,{},fd({kilos:'4.25'}))).error, 'weighed once');
  const s1=await db.query.laundryLoads.findFirst({where:eq(schema.laundryLoads.id,small.id)});
  const b1=await db.query.laundryLoads.findFirst({where:eq(schema.laundryLoads.id,big.id)});
  assert.equal(s1.amount,15000); assert.equal(s1.cost,6000);
  assert.equal(b1.amount,25500); assert.equal(b1.cost,17000);
  const charge=await db.query.charges.findFirst({where:eq(schema.charges.id,b1.chargeId)});
  assert.equal(charge.amount,25500); assert.equal(charge.occupantId,p.id); assert.equal(charge.billTo,'occupant');
  assert.ok((await run(laundry.cancelLoad,big.id)).error, 'weighed loads stay');
  assert.ok((await run(laundry.markCollected,big.id)).ok);
  assert.ok((await run(laundry.markCollected,big.id)).error);
  assert.ok((await actors.run(stranger,()=>reportLaundryClaim(big.id,{},fd({kind:'missing',details:'Shirt'})))).error, 'not their load');
  assert.ok((await actors.run(tenant,()=>reportLaundryClaim(big.id,{},fd({kind:'missing',details:'One white shirt'})))).ok);
  const claim=await db.query.laundryClaims.findFirst({where:eq(schema.laundryClaims.loadId,big.id)});
  assert.equal(claim.status,'open');
  assert.ok((await run(laundry.resolveClaim,claim.id,{},fd({resolution:'Shop paid 300'}))).ok);
  assert.ok((await run(laundry.resolveClaim,claim.id,{},fd({resolution:'Again'}))).error);
});
test('staff report problems; repair costs charge the right payer once', async () => {
  const r=await room(); const p=await person(); await assign(p,r);
  const [desk]=await db.insert(schema.staff).values({name:'Desk',username:`repair.desk${++serial}`,role:'front_desk',passwordHash:'unused'}).returning();
  assert.ok((await actors.run(fix,()=>requests.reportProblem({},fd({roomId:r.id,details:'Leak under sink'})))).ok);
  const staffReport=await db.query.tenantRequests.findFirst({where:eq(schema.tenantRequests.details,'Leak under sink')});
  assert.equal(staffReport.occupantId,null); assert.equal(staffReport.reportedBy,fix.id); assert.equal(staffReport.assigneeId,fix.id);
  assert.ok((await actors.run(fix,()=>requests.recordRepairCost(staffReport.id,{},fd({cost:'500',paidBy:'company'})))).error, 'maintenance cannot bill');
  assert.ok((await actors.run(desk,()=>requests.recordRepairCost(staffReport.id,{},fd({cost:'500',paidBy:'occupant'})))).error, 'no tenant on a staff report');
  assert.ok((await actors.run(fix,()=>requests.recordRepairCost(staffReport.id,{},fd({cost:'350',paidBy:'hotel'})))).ok);
  let saved=await db.query.tenantRequests.findFirst({where:eq(schema.tenantRequests.id,staffReport.id)});
  assert.equal(saved.cost,35000); assert.equal(saved.chargeId,null);
  assert.ok((await actors.run(desk,()=>requests.recordRepairCost(staffReport.id,{},fd({cost:'350',paidBy:'company'})))).ok);
  saved=await db.query.tenantRequests.findFirst({where:eq(schema.tenantRequests.id,staffReport.id)});
  const charge=await db.query.charges.findFirst({where:eq(schema.charges.id,saved.chargeId)});
  assert.equal(charge.billTo,'company'); assert.equal(charge.contractId,contract.id); assert.equal(charge.amount,35000);
  assert.ok((await actors.run(desk,()=>requests.recordRepairCost(staffReport.id,{},fd({cost:'400',paidBy:'company'})))).error, 'charged once');
  const [tenantReport]=await db.insert(schema.tenantRequests).values({occupantId:p.id,roomId:r.id,kind:'issue',details:'Broken chair'}).returning();
  assert.ok((await actors.run(desk,()=>requests.recordRepairCost(tenantReport.id,{},fd({cost:'1200',paidBy:'occupant'})))).ok);
  const t=await db.query.tenantRequests.findFirst({where:eq(schema.tenantRequests.id,tenantReport.id)});
  const tc=await db.query.charges.findFirst({where:eq(schema.charges.id,t.chargeId)});
  assert.equal(tc.billTo,'occupant'); assert.equal(tc.occupantId,p.id);
});
test('maintenance checklists: start from the door, every item answered, problems become requests, cycle restarts', async () => {
  const r=await room();
  assert.ok((await run(checklists.saveChecklistTemplate,null,{},fd({name:`Check ${++serial}`,everyDays:'30',items:'Aircon filter\nLights\nSmoke detector'}))).ok);
  await assert.rejects(()=>actors.run(fix,()=>checklists.saveChecklistTemplate(null,{},fd({name:'x',everyDays:'30',items:'a'}))));
  const list=await db.query.maintenanceChecklists.findFirst({where:eq(schema.maintenanceChecklists.name,`Check ${serial}`)});
  const dueFor=async()=>(await checklistsDue(today)).find((d)=>d.checklist.id===list.id).rooms.find((x)=>x.roomId===r.id).due;
  assert.equal(await dueFor(),today);
  const to=await redirectedTo(actors.run(fix,()=>doorCode.startChecklist(r.qrToken,list.id)));
  assert.equal(to,await redirectedTo(actors.run(fix,()=>doorCode.startChecklist(r.qrToken,list.id))), 'continues the open one');
  const runRow=await db.query.checklistRuns.findFirst({where:eq(schema.checklistRuns.checklistId,list.id)});
  assert.ok(runRow.checkInId); assert.equal(runRow.results.length,3);
  assert.ok((await actors.run(fix,()=>checklists.saveRun(runRow.id,{},fd({result_0:'ok',finish:'1'})))).error, 'all items needed');
  assert.ok((await actors.run(fix,()=>checklists.saveRun(runRow.id,{},fd({result_0:'ok',result_1:'fail',result_2:'na',finish:'1'})))).error, 'a problem needs a note');
  assert.equal(await redirectedTo(actors.run(fix,()=>checklists.saveRun(runRow.id,{},fd({result_0:'ok',result_1:'fail',note_1:'Bulb out by the door',result_2:'na',finish:'1'})))),'/maintenance/checklists?done=1');
  const raised=await db.query.tenantRequests.findMany({where:eq(schema.tenantRequests.roomId,r.id)});
  assert.equal(raised.length,1); assert.match(raised[0].details,/Lights\. Bulb out by the door/); assert.equal(raised[0].assigneeId,fix.id);
  assert.equal(await dueFor(),addDaysISO(today,30));
  assert.ok((await actors.run(fix,()=>checklists.saveRun(runRow.id,{},fd({result_0:'ok'})))).error, 'finished runs are fixed');
});
