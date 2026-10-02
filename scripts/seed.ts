// Creates the first admin account and the 75 rooms.
// Usage: pnpm db:seed   (safe to re-run; it skips what already exists)
import path from "node:path";
import { mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import bcrypt from "bcryptjs";
import * as schema from "../src/db/schema";

const FLOORS = 5;
const ROOMS_PER_FLOOR = 15;

async function main() {
  const dataDir = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
  mkdirSync(path.dirname(dataDir), { recursive: true });
  const client = await PGlite.create(dataDir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });

  const existingAdmin = await db.query.staff.findFirst();
  if (!existingAdmin) {
    const password = process.env.ADMIN_PASSWORD ?? randomBytes(6).toString("base64url");
    await db.insert(schema.staff).values({
      name: "Administrator",
      username: "admin",
      passwordHash: await bcrypt.hash(password, 10),
      role: "admin",
    });
    console.log(`Admin account created. Username: admin  Password: ${password}`);
    console.log("Change this password after your first sign-in.");
  } else {
    console.log("Staff accounts already exist; skipped admin.");
  }

  let [standard] = await db.select().from(schema.roomTypes).limit(1);
  if (!standard) {
    [standard] = await db
      .insert(schema.roomTypes)
      .values({ name: "Standard", defaultCapacity: 1 })
      .returning();
  }

  const roomCount = (await db.select({ id: schema.rooms.id }).from(schema.rooms)).length;
  if (roomCount === 0) {
    const values = [];
    for (let floor = 1; floor <= FLOORS; floor++) {
      for (let n = 1; n <= ROOMS_PER_FLOOR; n++) {
        values.push({
          number: `${floor}${String(n).padStart(2, "0")}`,
          floor,
          roomTypeId: standard.id,
          capacity: standard.defaultCapacity,
          qrToken: randomBytes(12).toString("base64url"),
        });
      }
    }
    await db.insert(schema.rooms).values(values);
    console.log(`Created ${values.length} rooms (${FLOORS} floors × ${ROOMS_PER_FLOOR}). Edit numbers in the app.`);
  } else {
    console.log(`${roomCount} rooms already exist; skipped rooms.`);
  }

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
