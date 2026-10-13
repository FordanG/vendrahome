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
2. Open **Connect → Direct** and copy the **Session pooler** connection string (port 5432,
   host `aws-0-…pooler.supabase.com`). Put the database password into it. This is `DATABASE_URL`.
   Don't use the transaction pooler (port 6543): with this app's database driver, pages hang on it.
3. On your computer, bring the empty database up to date and create the admin account:

   ```bash
   DATABASE_URL='postgresql://postgres.xxxx:PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres' \
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
   | `DATABASE_URL` | the session pooler string from step 1 |
   | `APP_URL` | the site's public address, for example `https://vendrahome.netlify.app` |
   | `DATABASE_POOL_SIZE` | optional, default 3. Connections per app instance; idle ones close after 20 seconds. |

4. Deploy, open the address, sign in as `admin` and change the password under **My account**.

Set `APP_URL` **before** printing door codes. The QR codes point to that address.

## Or: Vercel instead of Netlify

`vercel.json` already sets the build command and runs the app in Singapore (`sin1`), next
to the database; left at Vercel's default US region, every query crosses the Pacific and
pages get slow. Import `FordanG/vendrahome` in Vercel, then add the same `DATABASE_URL`
and `APP_URL` (for example `https://vendrahome.vercel.app`) under Environment Variables.
Vercel's free Hobby plan is for non-commercial use; a business running on it day to day
needs Pro.

## 3. Backups

- Supabase Pro keeps daily backups for 7 days (**Database → Backups**). Turn on
  point-in-time recovery if you want to restore to any minute.
- Do one test restore before entering real data: restore a backup into a new
  project, point a local copy of the app at it (`DATABASE_URL=... pnpm dev`) and
  check that the rooms, tenants and bills are there.

## Running locally against Supabase

Keep the connection string in `.env.production.local` (git ignores it). Next.js reads that
file only for `pnpm build` and `pnpm start`, so `pnpm dev` and the tests keep using the
local database. For scripts, pass the file explicitly:

```bash
node --env-file=.env.production.local --import tsx scripts/migrate.ts   # after a schema change
node --env-file=.env.production.local --import tsx scripts/seed.ts
pnpm build && pnpm start                                                # the app on Supabase
```

The local database migrates itself when the app starts. A hosted one only migrates
with `pnpm db:migrate`, so many app instances never try to migrate at the same time.
