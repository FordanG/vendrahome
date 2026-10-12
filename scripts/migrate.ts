// Brings the database up to the latest schema. Run once per deploy for a hosted database:
//   DATABASE_URL=... pnpm db:migrate
// (The local database migrates itself when the app starts.)
import { connect, usesHostedDb } from "../src/db/connect";

async function main() {
  const { close } = await connect({ migrate: true });
  await close();
  console.log(usesHostedDb() ? "Hosted database is up to date." : "Local database is up to date.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
