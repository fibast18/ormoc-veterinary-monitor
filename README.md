> **IMPORTANT: UPDATE FROM v1.0.2 — READ THIS FIRST**
>
> Keep your existing D1 database and user accounts. Before pushing the v1.0.3 files to your GitHub `main` branch (which triggers automatic deployment), apply **only** the new migration to your existing remote D1 database:
>
> ```bash
> npx wrangler d1 migrations apply ormoc-vet-monitor --remote
> ```
>
> Run this command from the **extracted v1.0.3 project folder**. You should see `0003_offline_sync.sql` marked successful (0001 and 0002 should already be tracked as applied). No database reset is needed. Keep the existing `wrangler.toml` ID, which is included here.
>
> Once the migration succeeds, upload and commit the v1.0.3 source files to GitHub. Your connected Cloudflare Worker should deploy automatically.

# Ormoc City Veterinary Monitoring System (OCVMS) v1.0.3

**Animal/Livestock Census + Dog/Cat Vaccination Monitoring**  
Prepared for City Veterinary Office, Ormoc City, Leyte  
Developed by: Engr. Rico J. Pono

This is a completed **Cloudflare Workers + D1** application. The source code belongs in **GitHub**; Cloudflare automatically deploys the site. **Do not deploy this as a standalone GitHub Pages static website**: its `/api/*` endpoints require the Cloudflare Worker and D1 database.

## Included features

- Official list of **85 Ormoc City barangays with 10-digit PSGC codes**, with Urban/Rural classifications (source: Philippine Statistics Authority, https://psa.gov.ph/classification/psgc/barangays/0803738000, accessed November 2026).
- **14 preconfigured species** in livestock, poultry, companion and other groups (custom species/animal-level tracking can be added in future versions).
- **Monthly animal census snapshots**, by barangay and species, including heads and optional number of households raising the species. An inventory is **a count at a point in time**; do not add together inventories from different months.
- **Dog/cat vaccination activity records** with date, vaccine category (anti-rabies or other), administered doses, site, notes.
- Citywide dashboards, barangay reporting completeness, species summaries, approved counts, and barangay comparisons.
- Pending / approved / rejected workflow. Only **approved** records contribute to citywide dashboard figures; changing census/vaccination records returns them to **pending**.
- **CSV export** of census, vaccinations, and approved citywide barangay summaries, UTF-8 and compatible with Excel/Apple Numbers; **CSV import** using bundled templates (imports split into 30-row batches to respect Cloudflare Free D1 query limits).
- Login with `admin`, `encoder` (all 85 barangays; CVO-assigned staff), and `viewer` (citywide read-only) roles. Users do **not** need Cloudflare accounts.
- Secure, HTTP-only SameSite session cookies, PBKDF2 password hashes, application-scoped authorization, login-attempt lockouts, SQL parameter binding, a server-side audit trail, strict-origin writes, and CSP headers.
- Mobile-friendly interface; no paid front-end frameworks or external JavaScript libraries.

## Critical statistical definitions

1. **Monthly census = snapshot** of live animals reported in a specific month. The same animal may appear in consecutive months; do not total those months together.
2. **Vaccinations = doses administered** on a date. Repeated doses or repeated reporting can include the same animal. The system **does not** identify individual cats or dogs, so vaccination **coverage percentage or unique vaccinated animals cannot be calculated reliably** from these totals.
3. Reporting completeness counts barangays with **at least one approved census row** in the selected month. It is not proof that every species was surveyed.
4. A recorded zero (`0`) is distinct from **no entry**. Do not fabricate zeroes for unvisited barangays.
5. Imported/edited entries require City Veterinary administrator review. CSV files are **not** permanent database backups; see the D1 export command below.

## Quick deployment

Read **DEPLOYMENT-GUIDE.md** before deployment. In brief:

1. Create a GitHub repository and upload **all** these project files to its `main` branch.
2. In Cloudflare D1, create a database named `ormoc-vet-monitor`.
3. Replace `REPLACE_WITH_YOUR_D1_DATABASE_UUID` in `wrangler.toml` with your actual D1 database ID, and commit the change.
4. For a **fresh installation**, apply `0001_schema.sql`, `0002_barangays.sql`, and `0003_offline_sync.sql` in ascending order. For an **existing v1.0.2 database**, apply only the new `0003_offline_sync.sql` migration using the Wrangler migration command.
5. Cloudflare Workers & Pages → Create application → GitHub → your repo. Worker name must be **`ormoc-veterinary-monitor`** (same as `wrangler.toml`); `main` branch; build command **blank**; deploy command **`npx wrangler deploy`**.
6. In the deployed Worker's **Settings → Variables and Secrets**, add a **Secret** named `BOOTSTRAP_TOKEN`. Use an unpredictable random string of at least 32 characters, **not** a simple shared password. Never commit it to GitHub.
7. Open your Worker site. On the setup page, enter the token once and create the first city administrator. **Remove the bootstrap secret after setup** if you no longer need it.
8. As administrator, create city viewers and citywide Encoder accounts. No barangay assignment is required. Share the app's URL and their login credentials privately; no GitHub or Cloudflare accounts are required for them.

### Example Wrangler commands (Mac terminal, optional alternative)

```sh
npm install
npx wrangler login
npx wrangler d1 migrations apply ormoc-vet-monitor --remote
npx wrangler secret put BOOTSTRAP_TOKEN
npx wrangler deploy
```

The D1 database name and ID must already exist in `wrangler.toml`. If you use the Console to run the SQL, do not also needlessly re-run it using migration commands. For **local** experimentation use `npm run migrate:local` and `npm run dev` with an uncommitted `.dev.vars` file.

### Database backup

```sh
npx wrangler d1 export ormoc-vet-monitor --remote --output=./ormoc-vet-backup.sql
```

Store SQL backups securely **outside the public GitHub repository**. D1 Time Travel can provide additional limited restoration windows on supported plans but does not replace independent backups.

### Local validation

```sh
npm run check
python3 tests/test_schema.py
node --experimental-sqlite tests/integration.mjs
```

## Source files

- `wrangler.toml` — Cloudflare Worker + D1 binding and static assets.
- `src/worker.js` — server APIs, authentication, authorization, reporting and database access.
- `public/index.html`, `public/app.js`, `public/styles.css`, `public/favicon.svg` — web app UI.
- `migrations/0001_schema.sql` — base tables; `0002_barangays.sql` — 85 PSGC barangays; `0003_offline_sync.sql` — non-destructive offline sync revisions and delete requests.
- `barangays-reference.csv` — reference for importing records (not animal counts).
- `scripts/generate_seed.py` — seed generator; `tests/test_schema.py` — SQLite integrity checks.
- `DEPLOYMENT-GUIDE.md` — complete beginner-friendly steps.

## Scope, operational requirements, limitations

- **Offline use in v1.0.3:** After one successful online login and opening the current month, the service worker caches the app and IndexedDB stores per-user read copies. Encoders can stage census/vaccination saves, edits, deletion requests, and CSV imports offline in the device outbox. A verified online session is required to sync these. Admin approvals, user account changes, auditing and cloud CSV exports remain online-only. Browser storage is not a guaranteed backup. The offline login allowance is 12 hours since last verified login.
- **This release has not been independently security audited.** Before collecting personally identifiable animal owner information, extend the security/privacy design and seek LGU privacy/DPO review. In v1.0.3, enter aggregate counts only; do **not** put names, addresses, phone numbers, or other personal data in free-text notes.
- Vaccination entry errors can be edited (which makes the record pending), or a City Admin can **reject** previously approved data to exclude it from official totals. There is no bulk deletion button.
- The `Other` vaccine category is broad. Use notes for a non-rabies vaccine product; specific vaccine catalogs can be added later.
- CSV vaccination imports are additive; importing the exact same file twice will **double-count doses** if both copies are approved. Review before approval.
- Per-month list views and CSV exports cap at 3,000 and 10,000 records respectively. For larger data volumes, add pagination.
- Current passwords are shared by the City Admin directly; there is no self-service password recovery or MFA in v1.0.3.
- A public source repository is acceptable if no secrets or database exports are committed, but access to the live data is **not public**. Only authenticated app users can access records.
- The city should validate species classifications, survey frequency, and data approval policy before treating the dashboard as an official reporting system.

## Free tier

Cloudflare Free plan currently offers a Workers request allowance and D1 quotas; see pricing/limits for authoritative figures and updates:
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/d1/platform/limits/

As of November 2026, published limits include **100,000 Workers requests/day**, **5 million D1 rows read/day**, **100,000 rows written/day**, and **500 MB max per database** on Free. A small 85-barangay pilot can often fit within these limits, but actual cost/availability depends on usage and account quotas. Daily usage overages on Free may cause failures until quota resets.

**Version 1.0.2 · Cloudflare password hashing fix · November 5, 2026**

## v1.0.2 Cloudflare compatibility fix

- Fixed initial administrator creation/login failure on Cloudflare Workers caused by the v1.0.0 PBKDF2 iteration count exceeding the production runtime limit (210,000 requested, 100,000 supported). The code now uses 100,000.
- Added an automated PBKDF2-limit check to prevent this release-blocking regression.
- Existing D1 schema, 85-barangay roster, saved data, admin secret and all system modules remain unchanged; **do not rerun or wipe database migrations**.
- The included `wrangler.toml` uses the D1 Database ID observed in the user’s Cloudflare deployment. Confirm it matches the intended database before deploying elsewhere.
- For government production deployment, implement stronger password hashing via supported Argon2id or equivalent following IT/DPO security review; 100,000 PBKDF2-SHA-256 rounds is only a Workers-compatible hotfix.

## v1.0.2 — Citywide CVO Encoder workflow (November 5, 2026)

- Role label changed from **Barangay Encoder** to **Encoder**. CVO creates accounts for office-appointed Encoders; no barangay assignment is requested.
- Each Encoder can select, review, input, update and CSV-import records for **any of the 85 barangays**. The same applies to previously created `encoder` accounts after deployment.
- Records entered or imported by Encoders remain **pending** until a City Admin reviews/approves them. Encoders cannot approve records, manage users or view the admin-only audit page.
- Census import accepts records spanning many barangays using their individual `barangay_psgc` codes; vaccination CSV import works the same way. Files must be **CSV UTF-8**, exported from Excel/Numbers, not native `.xlsx` files.
- **No new database migration is needed for this release**. The original v1.0.1 users table enforces a non-null `barangay_id` for `encoder` rows. For new Encoders, the application stores a valid internal compatibility reference without using it as a barangay assignment or as an access restriction. The API and UI report the role scope as All barangays. A future schema maintenance migration can remove this obsolete column requirement.
- All saved users, authentication records, animals, vaccination data, approvals, passwords, and the Cloudflare D1 binding are retained. **Do not recreate or reset the D1 database, and do not reapply old migrations.**
- **Security note:** Previously barangay-restricted Encoder accounts gain citywide access immediately on v1.0.2. CVO should check existing accounts under Users and disable any accounts that should not have this broader access.

**Safe update:** Upload the complete v1.0.2 files to the same GitHub repository branch `main`, preserve the working `wrangler.toml` Database ID, confirm the Cloudflare Worker publishes v1.0.2, and refresh the website. No SQL action needed.
