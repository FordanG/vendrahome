# Vendrahome

Custom app for running a 75-room long-stay hotel: rooms, companies, contracts with rent increases, tenants and room assignments. The planning notes are kept outside this repository.

## Run it

```bash
pnpm install
pnpm db:seed      # first time only: creates the admin account and 75 rooms
pnpm dev          # http://localhost:3000
```

`db:seed` prints the admin password. Set your own with `ADMIN_PASSWORD=... pnpm db:seed` on the first run, or change it under **My account** after signing in.

The database is an embedded Postgres (PGlite) stored in `.data/pglite`. Back up that folder to keep your data. Set `PGLITE_DIR` to put it somewhere else.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Start the app for local use |
| `pnpm db:seed` | Create the admin account and rooms if missing (safe to re-run) |
| `pnpm db:demo` | Add demo data to try the app (see **Test data and accounts** below). Stop `pnpm dev` first. |
| `pnpm db:demo:remove` | Delete everything `db:demo` added, and anything the demo people did while testing |
| `pnpm db:generate` | Create a migration after changing `src/db/schema.ts` |
| `pnpm typecheck` / `pnpm lint` | Checks |
| `pnpm test:e2e` | End-to-end browser test (see below) |

Migrations in `drizzle/` run automatically when the app starts.

## Test data and accounts

The database itself (`.data/`) is never committed, so real tenant data stays on the machine it was entered on. Test data comes from scripts in this repository instead, so any fresh copy can have the same data and accounts:

```bash
ADMIN_PASSWORD=choose-one pnpm db:seed   # admin account and the 75 rooms
pnpm db:demo                             # demo data and the accounts below
```

`pnpm db:demo` adds one company that leases every room on a two-year contract, 2 to 3 tenants in each room, room types (Twin, Triple, Loft), house rules, kitchen and laundry times, maintenance visits and tenant requests. It also adds billing (the deposit, two issued statements with the second partly unpaid and overdue, utility bills, tenant laundry charges) and a room inventory (a standard list per room type, items in every room, contract-start checks, and a move-out check with a missing key card). On a database where an older demo is already loaded, `pnpm db:demo` adds just the billing and inventory part. `pnpm db:demo:remove` takes out everything it added and leaves the rest alone.

| Sign in as | Role | Password |
|---|---|---|
| `admin` | Admin | the one set by `db:seed` |
| `demo.admin` | Admin | `demo1234` |
| `demo.desk` | Front desk & housekeeping | `demo1234` |
| `demo.fix` | Maintenance | `demo1234` |
| `demo.juan` (room 203), `demo.maria` (room 312), `demo.paolo` (room 507) | Tenant | `demo1234` |

These passwords are for local testing only. Run `pnpm db:demo:remove` before putting real data in.

The room assignments and counts above describe a fresh run of the current demo script. An existing demo database is not upgraded by running `db:demo` again: it keeps its original rooms, residents, dates and any testing changes. Check the live room board for that database's actual assignments. Do not remove or reseed it if you need to keep those records.

The end-to-end test uses its own separate accounts and database (`e2e/accounts.ts`, `.data/e2e`).

## End-to-end test

```bash
pnpm test:e2e
```

Drives the app in Chrome (the one installed on this machine; nothing to download) through the tenant portal story: admin creates a tenant login, sets house rules, the kitchen and laundry timetable and maintenance visits; the tenant sees them and sends requests; staff approve; and every role is kept to its own pages. It takes about 30 seconds.

It starts its own server on port 3456 with a fresh database in `.data/e2e` and builds into `.next/e2e`, so it never touches your data and works while `pnpm dev` is running. Test accounts are in `e2e/accounts.ts`. If a step fails, open the recording with `pnpm exec playwright show-trace test-results/*/trace.zip`.

## Layout

- `src/db/schema.ts` — all tables. Money is stored in centavos.
- `src/lib/` — billing balances, statements and overdue (`billing.ts`), room inventory and check comparisons (`inventory.ts`), private photo storage (`photos.ts`), auth and roles (`auth.ts`), rent schedule math (`rent.ts`), room status (`rooms.ts`), room availability checks (`assignments.ts`), occupant fields (`occupants.ts`), CSV import helpers (`csv.ts`).
- `src/app/(app)/` — signed-in pages. Each area has an `actions.ts` with its server actions; every action checks the staff role.
- `src/app/me/` — the tenant portal. Tenant pages call `requireTenant()`; staff pages call `requireStaff()`, which sends tenants back to `/me`.
- `src/proxy.ts` — sends signed-out visitors to `/login`.
- `e2e/` — end-to-end test, its database setup and test accounts.

## Built so far (phase 1)

- Sign-in with roles: admin, front desk & housekeeping, maintenance, tenant
- Room board with derived status (occupied, contracted-empty, vacant, needs work, not available)
- Rooms and room types, capacity and condition
- Clients and contracts: rooms covered, one total rent or per-room rates, any number of rent increases, rent schedule, overlap checks
- Occupants with full details, room assignments with bed/slot, transfers, check-outs and history
- Assignment board, and CSV import of the client's list of people and rooms
- Audit log of every change
- Tenant portal: occupant logins; their room, maintenance visits, kitchen and laundry timetable, house rules; problem reports and maintenance or laundry requests that staff approve; their own charges and balance
- Billing (`/billing`): a ledger of charges and payments for each company contract and each tenant; monthly statements of account, frozen once issued and printable; charge types and who pays each, per contract; payments with method, reference, official receipt number and a photo of the proof; deposit received, deducted and refunded; overdue list; corrections only by reversing entries
- Utilities (`/billing/utilities`): one bill a period for the whole contract, from the provider's bill or a main-meter reading × rate, with a photo; flags bills far above the usual and rejects readings lower than the last
- Room inventory (`/inventory`): items per room with condition, tag, serial number, replacement cost and service cycle; a standard list per room type added to every room in one step; contract-start, move-in, move-out, spot and handover checks; differences become damage charges or deposit deductions; a damaged item can book a repair visit; storeroom, moves, retirements and item history

- Door codes: a QR code for each room, printable one at a time or as a sheet (`/rooms/door-codes`). Staff who scan sign in if needed and pick what they're there to do: clean the room, check in for a repair or maintenance visit (and mark it done), or start a move-in, move-out or spot check of the room's items. Every scan is recorded; the maintenance page, cleanings and item checks show whether the door code was scanned. Tenants who scan go to their requests. The admin can replace a room's code. Set `APP_URL` to the public address so printed codes point there.
- Shared-space codes: the admin adds places like the kitchen or laundry area on the door codes page. Tenants who scan one report a problem there; staff who scan one see what's open there.
- Housekeeping (`/housekeeping`): how often each room is cleaned (by room, floor, type or every room), rooms due and overdue by floor, cleanings in progress and the last week's, and the admin's cleaning checklist. A cleaning starts from the door code and is ticked off step by step. Room pages and the tenant's home page show the next cleaning.

Next: laundry loads and run sheets, recurring maintenance checklists, feedback. Moving to Supabase for shared hosting.


## Account profiles

Every account can edit its display name, optional contact email and mobile number under **My account** (staff) or **Account** (tenants). Profile saves are restricted to the signed-in account and recorded in Audit history. Username, role and access stay under account administration. Contact email is not a sign-in or password-recovery address.

Tenant account profiles are separate from official occupant records; front desk still manages resident information and room assignments. Migration `0006` adds optional profile contact fields and applies on app startup without changing existing account names or logins.

Every role can preview, upload, replace and remove its own profile photo on the same account page. Still JPG, PNG and WebP files up to 2 MB and 20 megapixels are accepted, cropped to 512 × 512, and re-encoded without embedded metadata. Photos are served only to their owner through an authenticated, non-cacheable endpoint. Migration `0007` stores photos separately in the database, so database backups include them. Initials appear when no photo is set.

## Operating rules and recovery

See [Operating rules and rollout](docs/operating-rules.md) for contract/stay rules, service ownership, backup and restore commands, migration precautions and verification limits. Run `pnpm test:rules` for isolated business-rule and backup/restore tests.
