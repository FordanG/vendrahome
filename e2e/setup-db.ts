// Creates a fresh database for the end-to-end tests: the seed (admin + 75 rooms),
// one front desk and one maintenance account, and one occupant staying in a room.
// Run by playwright.config.ts before it starts the test server. Never touches .data/pglite.
import path from "node:path";
import { rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import bcrypt from "bcryptjs";
import { addDaysISO, todayISO } from "../src/lib/format";
import { ADMIN, COMPANY_ADMIN, E2E_DB, FRONT_DESK, MAINTENANCE, OTHER_COMPANY, RESIDENT, TENANT } from "./accounts";

async function main() {
  const dataDir = path.join(process.cwd(), E2E_DB);
  rmSync(dataDir, { recursive: true, force: true });
  execFileSync(process.execPath, ["--import", "tsx", "scripts/seed.ts"], {
    stdio: "inherit",
    env: { ...process.env, PGLITE_DIR: dataDir, ADMIN_PASSWORD: ADMIN.password },
  });

  const db = await PGlite.create(dataDir);
  for (const [name, account, role] of [
    ["Fe Desk", FRONT_DESK, "front_desk"],
    ["Max Fix", MAINTENANCE, "maintenance"],
  ] as const) {
    await db.query("insert into staff (name, username, password_hash, role, property_id) values ($1, $2, $3, $4, (select id from properties limit 1))", [
      name,
      account.username,
      await bcrypt.hash(account.password, 10),
      role,
    ]);
  }
  const {
    rows: [occupant],
  } = await db.query<{ id: string }>("insert into occupants (full_name, nickname) values ($1, $2) returning id", [
    TENANT.name,
    TENANT.nickname,
  ]);
  await db.query(
    "insert into room_assignments (occupant_id, room_id, check_in, keys_issued) select $1, id, $2, '1 key card' from rooms where number = $3",
    [occupant.id, addDaysISO(todayISO(), -30), TENANT.room],
  );
  const {
    rows: [resident],
  } = await db.query<{ id: string }>("insert into occupants (full_name, mobile, id_type, id_number) values ($1, '0917 555 0199', 'PhilSys', '9999-8888-7777') returning id", [
    RESIDENT.name,
  ]);
  await db.query(
    "insert into room_assignments (occupant_id, room_id, check_in) select $1, id, $2 from rooms where number = $3",
    [resident.id, addDaysISO(todayISO(), -10), RESIDENT.room],
  );
  await db.query("insert into staff (name, username, password_hash, role, occupant_id) values ($1, $2, $3, 'tenant', $4)", [
    RESIDENT.name,
    RESIDENT.username,
    await bcrypt.hash(RESIDENT.password, 10),
    resident.id,
  ]);
  const { rows: [client] } = await db.query<{ id: string }>("insert into clients (name) values ('E2E Company') returning id");
  const { rows: [contract] } = await db.query<{ id: string }>(
    "insert into contracts (client_id, property_id, reference, start_date, end_date, monthly_rent, status) values ($1, (select id from properties limit 1), 'E2E Contract', $2, $3, 1000000, 'active') returning id",
    [client.id, addDaysISO(todayISO(), -90), addDaysISO(todayISO(), 365)],
  );
  await db.query("insert into contract_rooms (contract_id, room_id) select $1, id from rooms", [contract.id]);
  await db.query("update occupants set client_id = $1, property_id = (select id from properties limit 1)", [client.id]);
  await db.query("update room_assignments set contract_id = $1", [contract.id]);
  await db.query("insert into staff (name, username, password_hash, role, client_id) values ('Hana Reyes', $1, $2, 'company_admin', $3)", [
    COMPANY_ADMIN.username,
    await bcrypt.hash(COMPANY_ADMIN.password, 10),
    client.id,
  ]);
  const { rows: [other] } = await db.query<{ id: string }>("insert into clients (name) values ($1) returning id", [OTHER_COMPANY.name]);
  await db.query("insert into occupants (full_name, client_id, status) values ($1, $2, 'inactive')", [OTHER_COMPANY.person, other.id]);
  await db.query("insert into staff (name, username, password_hash, role, client_id) values ('Otto Other', $1, $2, 'company_admin', $3)", [
    OTHER_COMPANY.username,
    await bcrypt.hash(OTHER_COMPANY.password, 10),
    other.id,
  ]);
  await db.close();
  console.log("E2E database ready.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
