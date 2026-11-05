# OCVMS v1.0.3 — CVO Offline-Ready Edition

## Critical: upgrade order for your EXISTING website

1. **Back up the Cloudflare D1 database** (optional but strongly recommended): `npx wrangler d1 export ormoc-vet-monitor --remote --output=./ormoc-vet-backup.sql`. Store the backup outside GitHub.
2. **Extract the COMPLETE v1.0.3 ZIP**. Open Mac Terminal in that extracted directory (the same folder as `wrangler.toml`).
3. Check the `wrangler.toml` D1 Database ID matches your existing `ormoc-vet-monitor` database. This distribution retains the previously verified ID.
4. Run `npx wrangler d1 migrations list ormoc-vet-monitor --remote` (optional check), then run:

   ```sh
   npx wrangler d1 migrations apply ormoc-vet-monitor --remote
   ```

   Answer yes if prompted. **0003_offline_sync.sql** should show successful. Older 0001/0002 migrations must remain intact. D1 migrations are applied once; do not paste this command into D1 SQL Console.
5. Only AFTER the migration succeeds, upload the new project files to the SAME GitHub repository, preserving folders `public/`, `src/`, `migrations/`, and `wrangler.toml`. Commit to `main`.
6. Verify Cloudflare Deployments shows a successful build, open your existing URL and confirm the footer says **v1.0.3**.
7. On each encoder device, open and sign in ONLINE at least once. Open the Census, Vaccinations, Dashboard, and desired month(s) while online. The PWA service worker, roster, and cached records must first load over the internet. Optionally add the website to the phone home screen.
8. Disconnect Wi-Fi/mobile data, reopen the app and try saving a TEST record. You should see OFFLINE and a pending item in **Outbox**. The test record is NOT in Cloudflare yet.
9. Reconnect and select **Sync now**. Confirm the pending count goes to 0, then have a City Admin approve the test. Delete the test via the app and approve the deletion if applicable.

## Offline scope

- **Offline viewing**: previously downloaded monthly census, vaccination records and approved dashboards. The current month is preloaded on login; visit additional months online before field work. All 85 barangays are selectable.
- **Offline editing/encoding**: census head counts, vaccination activity and CSV UTF-8 imports; unsynced drafts are stored in IndexedDB on the device and labelled UNSYNCED. Census is per barangay/species/month. Vaccination offline inserts use client-generated IDs so sync retry cannot create duplicates.
- **Offline deletion**: Encoders stage a deletion request locally; when synced, a City Admin must approve deletion before the official record is hidden. City Admin deletions apply after sync. Deleted cloud records are soft-deleted, retaining audit history.
- **Automatic synchronization**: When online returns and the app is open, sync attempts resume after server session verification; use **Sync now** if needed. Offline operations are never counted as approved until uploaded and approved.
- **Conflict protection**: Server row revisions prevent stale offline updates from silently overwriting changes made on another device. Conflicts remain in **Outbox** with an error. Inspect the cloud record, re-enter a correction if needed, and only then discard the obsolete queued operation.
- **Online-only operations**: sign-in/renewal, staff accounts, approval/rejection, online CSV exports and audit trail. Device-side templates still download offline.

## Security and storage cautions

- The PWA cannot work on a device that has **never opened the app online**; the files and account must first be loaded. A cached offline login is permitted for **12 hours from the last verified online login**. You cannot extend server permissions offline.
- The local IndexedDB cache/outbox is device-specific. It does NOT instantly synchronize between phones. Browser cache clearing, uninstalling the PWA or iOS storage eviction may delete offline drafts. **Sync before clearing storage, changing devices, or signing out.**
- Sign out deletes the currently signed-in user's device cache/outbox after warning about pending drafts. Do not share unlocked phones. The app does not encrypt IndexedDB data itself; rely on organizational device controls.
- Cloudflare D1 remains the authoritative database. Never consider queued entries as approved reporting. CVO should formally approve and audit data before public reporting.
- The offline cache contains aggregate government data and free-text notes; do NOT enter identifiable animal owner names, addresses, contact details, veterinary medical records, or sensitive personal information into notes without an LGU privacy review.
- Never put `BOOTSTRAP_TOKEN`, real passwords, database exports or `.dev.vars` on GitHub.
- Offline data could be lost if storage is evicted or the browser is reset; until synchronized there is no remote backup.

## Files introduced by v1.0.3

- `public/sw.js` — PWA application shell cache (never caches `/api/*` responses).
- `public/offline.js` — IndexedDB per-user cache and outbound pending mutations.
- `public/manifest.webmanifest` — installable PWA metadata.
- `migrations/0003_offline_sync.sql` — `revision`, deletion request / soft-delete and last mutation ID fields; preserves all existing records.
- Updated `public/app.js`, `public/index.html`, `public/styles.css`, `src/worker.js`, tests and version metadata.

## Notes about 'Delete'

A citywide Encoder's delete is a **request to delete**. It does not immediately erase approved figures. The City Admin approves or rejects the request using the new controls next to the record. This avoids accidental loss of official municipal data. Cloud records use soft deletion for audit and recovery.
