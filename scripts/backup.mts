import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

// Never open a second PGlite process against a running database.
// The explicit flag confirms the operator has stopped the app and other writers.
const [mode, sourceArg, targetArg, offline] = process.argv.slice(2);
if (!["backup", "restore"].includes(mode) || !sourceArg || !targetArg || offline !== "--offline") {
  throw new Error("Stop the app first. Usage: node --import tsx scripts/backup.mts backup|restore SOURCE TARGET --offline");
}
const source = resolve(sourceArg);
const target = resolve(targetArg);
if (!existsSync(source)) throw new Error("Source does not exist.");
if (existsSync(target)) throw new Error("Target already exists. Use a new path; existing data will not be overwritten.");
const db = mode === "backup"
  ? await PGlite.create(source)
  : await PGlite.create(target, { loadDataDir: new Blob([readFileSync(source)]) });
try {
  const counts = await db.query<{ rooms: number; occupants: number; assignments: number }>(`
    SELECT (SELECT count(*)::int FROM rooms) rooms,
           (SELECT count(*)::int FROM occupants) occupants,
           (SELECT count(*)::int FROM room_assignments) assignments`);
  if (mode === "backup") {
    const archive = await db.dumpDataDir("gzip");
    writeFileSync(target, Buffer.from(await archive.arrayBuffer()), { flag: "wx", mode: 0o600 });
  }
  console.log(`${mode === "backup" ? "Backup written" : "Restored to new directory"}: ${target}`);
  console.log("Record counts:", counts.rows[0]);
} finally {
  await db.close();
}
