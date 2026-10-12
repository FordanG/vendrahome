# Company accounts

Each company that leases rooms (a "Company" in the app, `clients` in the database)
gets its own sub-account inside vendrahome. The hotel stays one property with one
set of hotel staff; a company account only ever sees its own part of it.

## Who signs in

| Login | Belongs to | Sees and does |
|---|---|---|
| Admin, Front desk & housekeeping, Maintenance | The hotel | Everything, as before |
| Company admin | One company | Its rooms, people, requests, bills and contracts; manages its own team logins |
| Company staff | One company | Its rooms, people and requests; no bills, no team |
| Tenant | One person | Their own room, requests, laundry, as before |

- Company logins are `staff` rows with role `company_admin` or `company_staff`
  and a `client_id`. The hotel admin creates the first company admin on the
  company's page; after that the company admin adds the rest of their team.
- Company logins open `/company`. Every hotel page answers 404 to them, and
  every company page answers 404 to everyone else (the hidden-pages rule).
- Every company query and action is filtered by the login's own company, and
  every action re-checks that the person, room or request belongs to it.

## The agreement: what each company may do

Set by the hotel admin per company, because each contract is negotiated:

| Setting | Default | Effect |
|---|---|---|
| Company keeps its people's details | On | Company adds and edits its people and gives them tenant logins. Off: read-only. |
| Company approves its tenants' requests | Off | A tenant's request (except urgent problems) waits for the company's OK before the hotel sees it. |
| Company admins see bills | On | Statements, balance, payments and deposit on the Bills page. |

Who pays which charge stays on each contract's charge rules, as before.

## Company pages

- **Home**: active contracts, people living here, free beds, rooms with who is in them, things waiting for the company.
- **People**: the company's tenants. Add a person, edit details, give or reset a tenant login, ask for a move-in or move-out.
- **Requests**: requests waiting for the company's OK (approve or decline), open requests from its people and rooms, and a form to report a problem in one of its rooms.
- **Bills** (company admin): per contract balance, overdue amount, deposit held, statements, charges not billed yet, payments.
- **Team** (company admin): the company's own logins.
- **Account**: profile, password, appearance.

## Move-ins and move-outs

The front desk hands over keys and checks room items, so a company *asks* and
the hotel *does it*:

1. The company asks: move a person into a room of its contract on a date, or move a person out.
2. The ask appears on Room assignments under "Asked by companies", with a count in the menu.
3. The front desk confirms (same checks as a normal assignment: contract, capacity, room ready, dates) or declines with a reason.
4. The company sees the result on the person's page.

## Data changes (migration 0014)

- `staff_role`: adds `company_admin`, `company_staff`. `staff.client_id`.
- `clients`: `self_manage_people`, `approve_requests`, `show_billing`.
- `tenant_requests`: `awaiting_company`, `company_reviewed_by`, `company_reviewed_at`.
- New `stay_requests` (kind move_in/move_out, person, room, date, bed, status, who asked, who handled, reply, resulting stay).

## Out of scope for now

- (Several hotels came later; see [hotels.md](hotels.md).)
- Companies changing contract terms or rates. Contracts stay hotel-admin only.
- Company-side payments. Payments are still recorded by the hotel.
