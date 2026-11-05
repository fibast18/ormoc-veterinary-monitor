# Deploy OCVMS v1.0.1: GitHub + Cloudflare D1

This is a GitHub-connected **Cloudflare Worker**, not a GitHub Pages app. GitHub hosts the source files, Cloudflare hosts the secure API + the user interface, and Cloudflare D1 stores the data for all devices.

## Part A: Create the GitHub repository

1. Sign in at https://github.com.
2. Select **New repository** and name it `ormoc-veterinary-monitor` (suggested).
3. Set it to **Private** if you prefer, but you can still use public source as long as you never commit passwords/secrets/exports.
4. Create the repository with its `main` branch. Upload **the contents inside the ZIP folder**, including `.gitignore` (GitHub web upload may hide dotfiles if your file picker is configured to hide them), `wrangler.toml`, `src/`, `public/`, `migrations/`, `package.json`, reference CSV, and docs.
5. **Do not** commit `.dev.vars` or any secret tokens.

## Part B: Create Cloudflare D1 database

1. Sign in at https://dash.cloudflare.com with the Cloudflare account that will operate this app.
2. Find **D1 SQL Databases** in the Cloudflare dashboard (the menu label may vary).
3. Create a database **exactly** named `ormoc-vet-monitor`.
4. Copy its **Database ID (UUID)**.
5. In `wrangler.toml`, **confirm** the `database_id` matches the D1 Database ID shown in your Cloudflare dashboard. This v1.0.1 package includes the Database ID observed in your successful November 5 deployment. If you deploy into another Cloudflare account or database, replace it with that database’s actual UUID. Keep `binding = "DB"` and `database_name = "ormoc-vet-monitor"` unchanged.
6. Save the GitHub commit to `main`.

## Part C: Initialize the database tables

Use **either** method:

**Method 1 — Cloudflare dashboard (no terminal):**

1. Open `ormoc-vet-monitor` in Cloudflare's D1 console.
2. Open the **Console** / SQL editor.
3. Open `migrations/0001_schema.sql` from the repository, copy the entire file, and execute it in the D1 console.
4. Open `migrations/0002_barangays.sql`, copy the entire file and execute it. It inserts 85 barangays. Do not enter any invented animal counts.
5. Verify: run `SELECT COUNT(*) FROM barangays;` and confirm **85**.

**Method 2 — Mac terminal:**

After downloading/cloning the repository, open Terminal in its root folder:

```sh
npm install
npx wrangler login
npx wrangler d1 migrations apply ormoc-vet-monitor --remote
```

The `--remote` part is essential: without it, only the local simulation database is updated. The migration tool applies both SQL files in sequence.

## Part D: Connect GitHub to Cloudflare Workers

1. Cloudflare dashboard → **Workers & Pages** → **Create application** → select **GitHub** as the source.
2. Authorize the GitHub connection and select your `ormoc-veterinary-monitor` repository.
3. Set the Cloudflare **Worker name** to `ormoc-veterinary-monitor`, matching the `name` field in `wrangler.toml`.
4. Set **Production branch** = `main`. (`main` is a GitHub branch, not something to paste into your JavaScript.)
5. Set **Build command** = leave blank. No front-end build is needed.
6. Set **Deploy command** = `npx wrangler deploy`.
7. Set the repository root directory to `/` or leave the default root.
8. Save/Deploy. Cloudflare will assign a URL similar to:

   `https://ormoc-veterinary-monitor.YOUR-SUBDOMAIN.workers.dev`

   The actual URL appears in your Cloudflare Worker overview. **This is only an example URL.**

9. Every future commit to the connected `main` branch will trigger a new Cloudflare deployment.

**Troubleshooting builds:** If Cloudflare reports a Worker name mismatch, check the `name` in `wrangler.toml`. If D1 binding or UUID is missing, ensure your real ID is committed and SQL tables have been initialized. Do not paste the deploy command into D1 Console—it goes into the Worker deployment configuration.

## Part E: Secure the initial administrator setup

1. Open Cloudflare dashboard → Workers & Pages → `ormoc-veterinary-monitor` → **Settings** → **Variables and Secrets**.
2. Add a **Secret** with variable name `BOOTSTRAP_TOKEN` and a unique unpredictable value of 32+ characters (letters, digits and punctuation). Use a password manager to generate and save it.
3. Apply/deploy the change if Cloudflare prompts you to do so.
4. Open the real Worker website. The first visit will show **Initial administrator setup**.
5. Enter that same setup token, your administrator name, preferred username, and a different secure admin password (12+ characters).
6. Select **Create first administrator**. Once one user exists, first-time setup is blocked by the Worker code.
7. **Recommended:** remove the `BOOTSTRAP_TOKEN` secret after successful first setup to limit its exposure.
8. Keep your administrator account credentials private. **Never paste the secret in GitHub, screenshots, tickets or shared chats.**

## Part F: Add barangay encoders and start monitoring

1. Sign in as City Admin → **Users** → enter full name, unique username and a temporary password.
2. Choose **Barangay Encoder**, then select one of the 85 barangays. Repeat for participating barangays.
3. If appropriate, create **City Viewer** accounts for supervisors; they can read but cannot edit data.
4. Give staff the Worker website URL, username and temporary password **privately**.
5. Encoders open the app using any modern browser on their phones or computers. **They do not need Cloudflare or GitHub accounts.**
6. Encoders submit monthly animal headcounts and daily dog/cat vaccination activities. These start **pending**.
7. City Admin signs in and **approves** or rejects records. Approved values appear in the Dashboard.

## Part G: Optional link from mysomis.com

If you manage the `mysomis.com` domain in the same Cloudflare account, you can assign a Worker custom domain like `vet.mysomis.com` through the Worker's **Settings → Domains & Routes → Add custom domain** (labels may vary). You may also add a navigation link from your MYSOMIS portal. This does **not** require the app to run on GitHub Pages, and site users still sign in through the Veterinary Monitoring System.

## Import and export

**Census CSV template fields:**

```csv
month,barangay_psgc,species_code,head_count,households,notes
```

**Vaccination CSV template fields:**

```csv
date,barangay_psgc,species_code,vaccine,doses,site,notes
```

In the app, use **Download CSV template**, open it with Excel or Apple Numbers, populate rows, then **Save as CSV UTF-8**, and import it. `barangay_psgc` is the official 10-digit code (see `barangays-reference.csv`, or download from PSA). The importer also pads a 9-digit Excel-converted PSGC with a leading zero if necessary; ideally format the column as Text in Excel before editing. Do not treat a CSV spreadsheet's zero as "no report."

**Allowed species codes:** `carabao`, `cattle`, `swine`, `goat`, `sheep`, `horse`, `chicken`, `duck`, `turkey`, `quail`, `dog`, `cat`, `rabbit`, `other`.

**Vaccination species:** `dog` or `cat`. **Vaccine:** `Anti-rabies` or `Other`, with exact capitalization shown. **Date:** `YYYY-MM-DD`. **Month:** `YYYY-MM`.

- Census imports update the record for the matching **month + barangay + species** and return it to pending review. Check for duplicates across CSV batches.
- Vaccination imports add new records; importing twice can double-count doses.
- Raw census and vaccination CSV exports include status columns and may include pending/rejected records; filter on **approved** if preparing a formal report. The **Dashboard / Barangays → Export CSV** creates an approved-only citywide barangay summary.

## Database backup

From the project root in your Mac terminal:

```sh
npx wrangler d1 export ormoc-vet-monitor --remote --output=./ormoc-vet-backup.sql
```

Retain regular database backups securely outside GitHub and Google-indexable websites. D1 backups and Time Travel are not a substitute for regular tested recovery procedures.

## Security / privacy / limitations

- This initial version records aggregate per-species counts and aggregate doses, **not** pet owner data or uniquely identified animals. Do not add personal names, residential addresses, phone numbers, or medical details in notes. Obtain the City Government's IT/DPO signoff prior to official production use.
- Passwords are hashed; only the app administrator can create/reset user credentials. There is no self-service password reset or multifactor authentication in v1.0.1.
- The system requires an internet connection to read/write D1. The UI is mobile-friendly but there is no offline editing.
- Cloudflare Workers Free and D1 Free have daily/storage limits; verify before broad rollout.
- For regular government data processing, establish access reviews, retention policies, approvals, incident response, backups, and a policy specifying who can certify official numbers.

## References

- Official barangays: https://psa.gov.ph/classification/psgc/barangays/0803738000
- Cloudflare GitHub integration: https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/
- Cloudflare D1 migrations: https://developers.cloudflare.com/d1/reference/migrations/
- Static asset Worker bindings: https://developers.cloudflare.com/workers/static-assets/binding/
- Cloudflare D1 free-tier limits: https://developers.cloudflare.com/d1/platform/pricing/
- Cloudflare D1 export: https://developers.cloudflare.com/d1/best-practices/import-export-data/

## v1.0.1 fix for first-administrator error

The original v1.0.0 Worker used PBKDF2-SHA-256 with 210,000 iterations, which fails on Cloudflare Workers production (`NotSupportedError`: max 100,000 iterations). Version 1.0.1 changes the call to 100,000 iterations. No SQL migration is needed and existing D1 data must not be deleted. In the case of a failed initial bootstrap with zero users, simply deploy the updated Worker and submit the setup form again. The `BOOTSTRAP_TOKEN` secret stays in the Worker settings.

For the user’s current deployment, edit `src/worker.js` on the GitHub `main` branch or replace the repository files with this release. GitHub-triggered deployments keep the repository and live Worker synchronized. A manual `npx wrangler deploy` from this folder also works, but should be followed by the same source update on GitHub to prevent a later auto-deployment from restoring v1.0.0.

**Security consideration:** 100,000 PBKDF2-SHA-256 iterations satisfies the Worker execution limit but is below contemporary password-storage strength recommendations. This is a compatibility hotfix, not a security audit. Before collecting official operational data, arrange a security review and migrate to a modern password hashing approach such as Argon2id with a suitable runtime/library, while versioning password hash parameters. Continue requiring long passwords, lockouts, and private credential distribution.
