# Several hotels

One business running several hotels. Each hotel's day-to-day records are kept
apart; a few lists are shared because they are the same everywhere.

## Who sees what

| Login | Hotels |
|---|---|
| Admin with "Every hotel" (the owner) | All of them. A switcher under the logo picks which one the pages show. Only the owner adds hotels, manages company logins and sees the audit history. |
| Admin of one hotel | That hotel only: its rooms, staff, contracts, billing and settings. |
| Front desk & housekeeping, Maintenance | Their own hotel only. Pages and door codes from another hotel don't exist for them. |
| Company admin and staff | Every hotel where their company leases rooms, shown together. |
| Tenant | The hotel they live at. |

## Per hotel and shared

| Per hotel | Shared by all hotels |
|---|---|
| Rooms and room numbers (101 can exist in each hotel) | Companies |
| Shared spaces and their door codes | Room types and their standard item lists |
| Contracts (a contract covers rooms in one hotel), statements, utilities, deposits | Charge types and utility types |
| Tenants (set by the room they're given) | Cleaning checklist and maintenance checklists |
| House rules, kitchen and laundry times | |
| Laundry services, prices and the shop's cost | |
| Storeroom and room items | |
| Staff | |

## Rules

- A record's hotel comes from its room or contract, so loads, visits, cleanings,
  checks, requests, charges and payments follow automatically.
- Every action checks that what it changes is in a hotel the login can reach,
  not only that the page listed it.
- A tenant moved to a room at another hotel moves to that hotel.
- There is always at least one active admin who sees every hotel.

## Upgrading existing data (migration 0015)

Everything entered before this change becomes the first hotel, "Main hotel".
Rename it on the Hotels page. Existing admins become owners (every hotel);
existing front desk and maintenance logins work at the first hotel.
