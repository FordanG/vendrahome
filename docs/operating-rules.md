# Operating rules and rollout

These corrections address the 3 October 2026 platform review. Billing and room inventory were added afterwards (see their sections below); door codes and housekeeping were added after that; full laundry is still to come.

## Rooms and stays

- A new stay needs exactly one active contract for the occupant's company covering the room and move-in date. Manual entry, transfers and CSV imports share this check.
- Expected move-out cannot go beyond the contract's inclusive end date plus the checkout day. A missing expected departure does not grant an indefinite contract extension; expired coverage remains a staff exception.
- A stay occupies the interval from check-in up to, but excluding, actual checkout. Same-day transfers free the old bed on the move date. Expected checkout is a forecast and does not release capacity.
- Future arrivals reserve capacity but are not current portal stays. Cancel a future move-in from the occupant page to release its reservation; its details remain in audit history.
- Actual transfers and actual checkout cannot be recorded in advance. Record those events when they happen and use expected checkout for planning.
- A room manually marked Needs attention or Out of service cannot accept a new stay. Resolve the work and mark it Ready first. Open requests remain separate attention flags; they do not automatically decide whether the room is habitable.
- Board availability means ready, unreserved beds under today's active contracts, not all physically empty beds. Contract expiry warnings persist until resolved.
- Assignments, capacity changes, contract mutations and service updates serialize their checks and writes in one transaction. Audit events commit with the business change. Failed actions and failed imports roll back.

## Contracts and money

- Activate only after selecting rooms and setting positive base rent, including a rate for every room on a per-room contract.
- Contract coverage, dates, company, financial terms and rent steps become immutable on activation. They cannot be reverted to draft to bypass this protection. Set agreed increases while drafting; use a new contract for a new term.
- This version prevents historical rewriting by locking activated terms. It does **not** implement effective-dated amendments or automatic transfer of continuing stays to renewal contracts. Staff must resolve the old stay coverage before closing the old contract. Do not record a fictional physical departure to work around this limitation.
- A contract with current/reserved stays cannot be ended. Expired contracts remain visible until resolved.
- Rent follows start-date anniversary months, with an inclusive contract end date. Choose full-month charging or daily proration of the partial final contract month. Existing contracts default to their previous full-month behavior.
- Proration uses days in that anniversary month and rounds each month's charge to centavos. Deposits and advance rent remain recorded terms, not ledger balances.
- Date validation rejects impossible dates. Rent steps reject reductions greater than 100%, unsafe amounts and dates outside the term. Duplicate step months and open occupant/bed assignments have database uniqueness constraints.

## Requests and visits

- Staff can log an in-person/phone request for a current resident. Requests have an assignee and due date.
- Maintenance sees unassigned repairs and its own work, not laundry or other technicians' assigned requests. Acting on unassigned work claims it. Admin/front desk can assign work and handle all requests.
- Approving a repair/problem report with an appointment date creates or updates its current maintenance visit. Rescheduling that visit updates the request's appointment.
- Completing a request completes its scheduled visit; completing a visit completes its request. A missed/cancelled appointment returns the unresolved request to pending and clears the approved appointment. Reopening uses the current visit rather than creating duplicate appointments.
- Withdrawal retains the tenant request with a Withdrawn label. A withdrawn request cannot be reopened by staff; create a new request when needed.
- The queue is paginated, with urgent work first, then due date and oldest creation date. Work beyond the former 200-row limit remains reachable.
- The admin-only Audit history page shows recorded changes. Older audit records may not contain before/after details; this update cannot reconstruct data that was never logged.
- Replies remain in-app. There is no SMS/email notification system in this release.

## Accounts

- A password change preserves the current session and revokes other sessions. Admin password resets continue to revoke all sessions.
- Eight unsuccessful attempts for the same normalized username block sign-in until that 15-minute window expires. This is account-based throttling; deployment-level traffic limits remain a hosting responsibility.

## Backup and restore

The application and seed/demo tools must be stopped before running these commands: the embedded database directory must never be opened by two processes. `--offline` explicitly confirms the operator has done this.

From `app/`, use a new destination filename:

```sh
node --import tsx scripts/backup.mts backup .data/pglite /path/to/private-backups/hotel-2026-10-03.tar.gz --offline
```

The archive is created with owner-only permissions. Keep it in private storage outside the application machine as part of your backup routine. It contains the complete database, including personal data and login records. The script does not overwrite an existing file.

Restore into a **new** directory:

```sh
node --import tsx scripts/backup.mts restore /path/to/private-backups/hotel-2026-10-03.tar.gz .data/restored-check --offline
PGLITE_DIR=.data/restored-check pnpm dev
```

Check room, occupant and assignment counts and representative records before selecting the restored database for normal use. The original directory is not replaced automatically. The test suite exercises archive creation, restoration and overwrite refusal using disposable data. Automatic backup scheduling/off-machine replication is not configured by this change.

## Applying this update

1. Stop the app and take an offline backup.
2. Restart the app normally. New Drizzle migrations apply automatically; they add partial-month policy, work ownership/due dates/withdrawal history, login-attempt records, and uniqueness indexes.
3. Existing duplicate open stays, duplicate open beds or duplicate rent-step months will cause index creation to stop rather than silently discard or rewrite records. Restore the previous version/data if needed and reconcile those records before retrying. This release does not automatically repair historical bad data.
4. Review the room board's expired/uncovered-stay notices and confirm operational roles and work assignments.

## Verification

- `pnpm test:rules` exercises real server actions and migrations against disposable PGlite databases. Only Next request context/navigation and authentication identity are stubbed; data checks, transaction behavior and writes are real. Backup tests create and restore separate disposable data.
- `pnpm typecheck` and `pnpm lint` check source correctness.
- `pnpm test:e2e` uses a separate database and a contract-backed fixture. Its startup uses Node's TSX loader to avoid the TSX CLI's IPC requirement.
- In the agent's restricted environment, browser tests could not bind port 3456. Production build was blocked fetching the pre-existing Google Fonts. Run those checks on the normal development/deployment host before release; a browser pass or production build pass is not claimed here.

## Billing

- Front desk and admin record payments and add charges. Only the admin issues statements, enters utility bills, gives credits, makes corrections and manages the deposit, charge types and charge rules. Maintenance has no billing access.
- Every amount owed is a charge and every amount received is a payment, on either a company account (through its contract) or a tenant's own account. A charge or payment is never edited or deleted once saved; a mistake is undone with a reversing entry that keeps the original and records why.
- A statement covers one contract month (the same anniversary months as the rent schedule). Issuing it adds that month's rent and takes in every company charge and payment not on a statement yet, dated up to the issue date. Statements issue in order, at most a month before their month starts, and are frozen once issued; anything added later, including corrections, goes on the next one.
- Rent and utilities are always billed to the company. For every other charge type, the contract's charge rule decides who pays, falling back to the type's default. A charge can move between the company and the tenant only until it is on a statement.
- Overdue: payments clear the oldest statements first; whatever is still owed on statements past their due date is overdue, counted from the oldest.
- Utility readings are stored in thousandths of a unit and rates in ten-thousandths of a peso, so the amount is rounded to centavos only once. One bill per utility, contract and period; a reversed bill frees its period for re-entry.
- Statements are titled "Statement of account" and say they are not official receipts. Official receipt numbers from the hotel's own system can be recorded on each payment. VAT and withholding are not handled yet.

## Room inventory

- Everyone who works on rooms can check items, update an item's condition, book a repair visit for it and record a service. Front desk and admin add, edit, move and retire items. Only the admin edits the standard lists per room type.
- A check records what was found for every item in the room and updates each item's condition. A move-out check is compared with the same stay's move-in check (or the last check before the move-in); a handover check with the contract-start check; any other check with the room's previous one.
- What got worse (fewer found, or a worse condition) can be charged once, at the suggested replacement cost or an amount staff set, to the company or tenant by the contract's damage rule. At handover the admin can deduct it from the deposit instead, up to the amount held.
- Retired items keep their history. Photos of items, bills and payment proofs are private: re-encoded without camera or location data and shown only to roles that can see the record.

## Door codes

- Each room has one code. Admin and front desk can print it; only the admin can replace it, which stops the printed one working.
- Scanning needs a signed-in account. Tenants go to their requests page; staff see the room and check in.
- A check-in records who was at the door and when, linked to a visit when one is picked. A printed code can be photographed, so a check-in shows presence; it does not prove it. Visits marked done without a check-in are flagged on the maintenance page.
- Scanning again within 10 minutes for the same thing doesn't add another check-in.
- Each check-in records what it was for: a visit, a cleaning, an items check, or just being there.
- An items check counts as scanned when the same person scanned the room for an items check in the 3 hours before saving it.

## Shared spaces

- The admin adds, renames, turns off or replaces the code of each shared space. Turning a code off stops new reports from it.
- A report from a shared space is a problem report only, with no room attached. Staff handle it on the Requests page like any other.

## Housekeeping

- Admin and front desk set how often rooms are cleaned and do the cleaning. Maintenance doesn't see housekeeping. Only the admin changes the checklist.
- A room is due its interval after its last finished cleaning, or today if it has never been cleaned in the app. Overdue rooms show in red.
- A room has at most one cleaning in progress; scanning again continues it. A cleaning started from the room page without scanning is recorded and flagged as not scanned.
- A finished cleaning keeps the steps that weren't ticked, and can't be changed. One started by mistake can be cancelled before it is finished.
- The first checklist comes with the database update; the admin edits it on the Housekeeping page.
