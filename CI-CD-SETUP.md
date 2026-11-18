# OCVMS — Git-based CI/CD (GitHub Actions)

**Repository:** `fibast18/ormoc-veterinary-monitor`  
**Production Cloudflare Worker:** `ormoc-veterinary-monitor`  
**Database:** Existing Cloudflare D1 `ormoc-vet-monitor`  
**Public website:** https://cvo.mysomis.com (separate Cloudflare gateway Worker)

The workflow is stored in `.github/workflows/cvo-ci-cd.yml` and deploys to the ORIGINAL CVO Worker. **It does not deploy or change the `cvo-domain-gateway` Worker.**

## First-time setup — two GitHub Actions secrets

The workflow cannot deploy until the following two repository secrets exist.

1. Sign in to the **Cloudflare account where the original `ormoc-veterinary-monitor` Worker and `ormoc-vet-monitor` D1 database live**. This was your **ormocslaughter** account, NOT the separate `mysomis.com` domain / gateway account.
2. Cloudflare Dashboard > **Profile / My Profile > API Tokens > Create Token**. Use the **Edit Cloudflare Workers** template (or minimum equivalent permissions for Worker script deployment), restricted to the correct Cloudflare account. Name it `GitHub CVO CI-CD`. Copy the token once and keep it private.
3. In the same Cloudflare account, find your **Account ID** in the account overview. Do not use the account ID of the gateway/domain account.
4. In GitHub, open https://github.com/fibast18/ormoc-veterinary-monitor/settings/secrets/actions > **New repository secret**. Create:
   - `CLOUDFLARE_API_TOKEN`: the private API token from step 2.
   - `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account ID from step 3.
5. **Do not** add these values to `wrangler.toml`, your source files, the README, or this document. No need to share either secret in a chat or screenshot.

If GitHub says the workflow is disabled, enable it under the repository's **Actions** tab. GitHub Actions also needs to be permitted in repository Settings > Actions > General.

## CI: what is tested before deployment

On each pull request targeting `main`, GitHub runs checks without production credentials and **does not deploy**.

On each commit/push to `main` (or manual **Run workflow**), GitHub:
1. Checks JavaScript syntax, password-hash iteration limit and citywide role UI.
2. Validates the 85-barangay schema using the local SQLite test.
3. Runs authenticated API, role and offline sync integration tests in an in-memory SQLite database.
4. Validates the Wrangler Worker bundle using `wrangler deploy --dry-run`. No production database is touched.
5. Only if all checks pass, uses `cloudflare/wrangler-action@v4` with the repository secrets to deploy to the EXISTING `ormoc-veterinary-monitor` Worker.

Database contents, sessions, roles, and already saved census/vaccination data are not reinitialized by a normal code deployment. The public `cvo.mysomis.com` gateway keeps forwarding to the existing production Worker.

## Verify the first automatic deployment

1. After adding secrets, open https://github.com/fibast18/ormoc-veterinary-monitor/actions
2. Select **CVO - Test and Deploy to Cloudflare**.
3. Choose **Run workflow**, branch **main**, then **Run workflow**.
4. Open the run. Both **Validate CVO application** and **Publish existing CVO Worker** must be green.
5. Check Cloudflare Dashboard > original Worker > **Deployments** for a new production deployment.
6. Visit https://cvo.mysomis.com and confirm online login plus dashboard and records work for City Admin, Encoder, and City Viewer. Check existing records without altering production data.

A green GitHub build establishes that the action succeeded; verify actual user flows separately.

## Future updates — no ZIP uploading / no manual Wrangler commands

- Make changes to source files in your Git checkout, or edit files directly in GitHub.
- Commit and push the changes to **main**. This automatically starts CI checks followed by deployment.
- If tests fail, no new application version is deployed by this GitHub Actions workflow.
- If deploy fails, check the failed step under GitHub **Actions**. Verify both secrets belong to the original Cloudflare account.
- Use a pull request for larger changes, review successful tests, then merge to `main` for production deployment.
- An edit on your MacBook that has NOT been committed/pushed does **not** deploy.

## Important: avoid duplicate deployment systems

Your original Worker previously had **Cloudflare Workers Builds** Git integration configured. If the new GitHub Actions workflow succeeds, open Cloudflare Dashboard > original Worker > Settings > Builds and set **Disable builds** to ON, or otherwise disable that Worker's native Git-triggered builds. Keep the Worker itself active. Do not delete the Worker, database, or custom-domain gateway. Only one deployment service should publish to the same Worker on each push.

If you choose to keep Cloudflare Builds instead, disable this GitHub Actions deployment workflow; don't run both continuously.

## Production database migrations are intentionally separate

Routine code deployment **does not automatically run schema-changing SQL migrations**. This is intentional to protect the CVO's live records. If an update contains a new migration:

1. Back up the remote production D1 database securely, outside the public GitHub repository.
2. Review and apply the new migration against `ormoc-vet-monitor` under the ORIGINAL Cloudflare account, using `npx wrangler d1 migrations apply ormoc-vet-monitor --remote` from an updated Git checkout or a separately authorized migration workflow.
3. Only after a successful migration, merge or push the matching application code to `main`.

Do not put raw D1 exports, personal data, Cloudflare API tokens, or usernames/passwords into GitHub.

## Offline users and existing sessions

The app remains an offline-capable PWA. The CI/CD workflow does not reset the database or remote logins; however, an app update can replace its cached shell when refreshed or reopened. Users should synchronize all pending offline outbox records before a rollout. Do not delete Safari/Chrome website data to force an update: this can erase local unsynchronized drafts.

## Troubleshooting

- **No Actions run on commit:** Check GitHub > Actions and verify that the commit went to `main` or was merged from a PR.
- **Missing Cloudflare secrets:** Add both repository secrets in GitHub Settings > Secrets and variables > Actions.
- **Cloudflare authorization error:** Token must belong to the account containing the original Worker; its account scope must allow Workers script deployment.
- **Tests pass but Worker not updated:** Check the **Publish existing CVO Worker** job and the original Worker's production deployments.
- **cvo.mysomis.com shows old page:** Check service-worker cache and ensure the original Worker deployed. Do not wipe offline device storage unless all unsynced drafts are safely synchronized.
