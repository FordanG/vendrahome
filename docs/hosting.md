# Hosting: Supabase database, Netlify app

The app runs on one of two databases, chosen by one setting:

| `DATABASE_URL` | Database |
|---|---|
| not set | Embedded Postgres (PGlite) in `.data/pglite`. For local use and tests. |
| set | A hosted Postgres (Supabase). For the live app. |

Schema, migrations and queries are the same for both. Photos are stored in the
database too, so the app keeps nothing on the server's own disk. That matters on
Netlify, where every request may run on a fresh machine.

## 1. Supabase project

1. Create a project. Pick region **Southeast Asia (Singapore)**, the closest to the Philippines.
   Save the database password somewhere safe.
2. Open **Connect** and copy the **Transaction pooler** connection string (port 6543).
   Put the database password into it. This is `DATABASE_URL`.
3. On your computer, bring the empty database up to date and create the admin account:

   ```bash
   DATABASE_URL='postgresql://postgres.xxxx:PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres' \
   HOTEL_NAME='Your hotel name' ADMIN_PASSWORD='a long password' pnpm db:seed
   ```

   Don't run `pnpm db:demo` against the live database.

### Supabase's web API is shut off

Supabase also serves every table to the internet through its own web API, to anyone
holding the project's public key. vendrahome never uses that API. So every migration
run (`pnpm db:migrate`, `pnpm db:seed`) turns on row level security on every table,
with no rules. The API then sees nothing, while the app's own database login works as
normal. Supabase's **Advisors** page will list "RLS enabled, no policy" on each table.
That is expected; don't add policies.

## 2. Netlify site

1. **Add new site → Import from GitHub**, then pick `FordanG/vendrahome`.
   Netlify detects Next.js by itself.
2. Build command: `pnpm db:migrate && pnpm build`. Each deploy first brings the
   database up to date, once, before the new version goes live.
3. Environment variables:

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | the transaction pooler string from step 1 |
   | `APP_URL` | the site's public address, for example `https://vendrahome.netlify.app` |
   | `DATABASE_POOL_SIZE` | optional, default 5. Connections per app instance. |

4. Deploy, open the address, sign in as `admin` and change the password under **My account**.

Set `APP_URL` **before** printing door codes. The QR codes point to that address.

## 3. Backups

- Supabase Pro keeps daily backups for 7 days (**Database → Backups**). Turn on
  point-in-time recovery if you want to restore to any minute.
- Do one test restore before entering real data: restore a backup into a new
  project, point a local copy of the app at it (`DATABASE_URL=... pnpm dev`) and
  check that the rooms, tenants and bills are there.

## Running locally against Supabase

```bash
DATABASE_URL='...' pnpm db:migrate   # after pulling new code with a schema change
DATABASE_URL='...' pnpm dev
```

The local database migrates itself when the app starts. A hosted one only migrates
with `pnpm db:migrate`, so many app instances never try to migrate at the same time.
