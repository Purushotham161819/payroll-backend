# Initial administrator setup and User Management

Implemented 29 October 2026. This extends the existing cookie/session
authentication; it adds no public setup, registration or recovery endpoints.
No real administrator account or permanent password was created by this change.

## First login

1. Start MongoDB and install dependencies in both repositories with `npm.cmd ci`.
2. In a private terminal in `D:\Projects\payroll-backend`, configure MONGODB_URI
   for the existing payroll database and a persistent random SESSION_SECRET of
   at least 32 characters. The default database is `payroll_db`. Do not change
   to a different database accidentally. The backend and administrator commands automatically load `.env` from
   the working directory; existing shell variables take precedence.
3. Run `npm.cmd run create-admin`. Enter your administrator email, password
   (8-128 characters) and confirmation at the masked prompts. This reuses the
   validated backend bootstrap command and refuses when any administrator
   already exists. It never overwrites accounts or provides default credentials.
4. Run `npm.cmd run start:dev` in payroll-backend and `npm.cmd start` in
   payroll-frontend. Open http://localhost:4200 and sign in with those credentials.
5. Open **User Management** in the sidebar. It appears only for administrators.

See [AUTHENTICATION.md](AUTHENTICATION.md) for SESSION_SECRET generation,
environment variables, compiled commands, HTTPS, cookies, CORS and proxy setup.
For non-Windows or secret-manager automation, supply BOOTSTRAP_ADMIN_EMAIL and
BOOTSTRAP_ADMIN_PASSWORD and run `npm run auth:bootstrap`; clear them afterward.
The interactive Windows command avoids putting passwords into shell history or
process arguments and restores any prior environment values when it finishes.

## Managing accounts

The directory displays email, role, active/inactive status, creation date and
actions. Accounts are retained rather than deleted.

- **Add User:** enter email, password, matching confirmation, role and active
  status. User is the default role. Admins can manage users and access payroll;
  Users can access payroll but cannot enumerate or manage accounts.
- **Edit:** change email or role. Role/email changes invalidate prior sessions.
  Your own administrator role is protected. Updating your own email requires
  you to sign in again.
- **Reset password:** enter and confirm a new password, select **Review reset**,
  then confirm. All existing sessions for that account become invalid. Stored
  passwords are never shown. Resetting your own password returns you to login.
- **Deactivate / Activate:** review and confirm. Deactivation immediately blocks
  login and all existing sessions; activation permits fresh login only. You
  cannot deactivate yourself. No API permits deleting an account.

Provide any temporary password to its intended user through a secure channel.
This version does not send password emails or implement invitation links.

## Recovering access

On the trusted backend host, configure the same MONGODB_URI and run
`npm.cmd run recover-admin`. Enter an **existing administrator's** email and
a new password twice. The controlled command resets the hash, reactivates that
account and invalidates all of its old sessions. It cannot create an account or
promote an ordinary User. Log in with the new password afterward.

For secret-manager automation, supply BOOTSTRAP_ADMIN_EMAIL /
BOOTSTRAP_ADMIN_PASSWORD to `npm run auth:recover`, then clear them. Production
builds also provide `node dist/auth/recover-admin.js`. No unauthenticated
password-reset API exists. Protect operator-shell and MongoDB privileges.

## APIs and security

| Endpoint | Authorization / behavior |
| --- | --- |
| GET /users | Admin; safe account directory |
| POST /users | Admin; email, password, role (`admin`/`user`), boolean active |
| PATCH /users/:id | Admin; email and role |
| PATCH /users/:id/password | Admin; new password; revokes existing sessions |
| PATCH /users/:id/status | Admin; boolean active; revokes existing sessions when changed |

The existing global authentication guard now checks session version and current
account status on every protected request. It requires the Admin role for the
UsersController before input validation, so unauthorized callers cannot
enumerate accounts or learn which IDs exist. The service checks authorization
again before writing. All five management endpoints remain under the existing
credentialed CORS and CSRF policy. No public endpoint was added; only
POST /auth/login is public. There are now 24 protected application routes.

Passwords use the existing Argon2id implementation (64 MiB, three iterations),
and email is consistently normalized and uniquely indexed. Response fields are
explicitly limited to id, email, role, active and timestamps; hashes and session
versions never appear. Invalid inputs/IDs return 400, missing accounts 404,
duplicate emails and account-safety conflicts 409, missing/invalid sessions 401,
and insufficient role permissions 403. Roles are checked from the database,
not trusted from frontend state or session-cached claims.

Password, role, email and status changes increment a private session version.
Pre-existing sessions with no version are treated as version zero. Old sessions
cannot be revived by reactivating an account. Existing logout, absolute expiry,
secure-cookie settings, rate limiting and payroll guards remain intact.

Account writes and CLI provisioning use a MongoDB-wide mutex. The actor is
checked again inside it, and self-demotion/deactivation are prohibited. These
checks preserve an active administrator even when two administrators attempt to
disable or demote one another simultaneously. No replica set is required.

**Operator limitation:** a crashed writer can leave a lock in
`auth_management_locks`, blocking account writes or startup. There is deliberately
no expiring lease that could let two writers proceed concurrently. Stop **all**
backend instances and provisioning commands, inspect the correct database, then
remove only the lock record `_id: 'accounts'` with an authenticated database tool.
Restart and retry. Never clear it while any writer may still be running. Full
recovery instructions are in [AUTHENTICATION.md](AUTHENTICATION.md).

Startup/bootstrap remove only the obsolete unique role index from `authusers`
and preserve the unique email index. Existing administrator records, passwords,
roles and IDs remain intact. Other users default to the User role. No employee,
payroll, formula or statutory collection is changed by this migration.

## Actual verification results

| Check | Result |
| --- | --- |
| Backend security/end-to-end tests | 19 passed across 3 suites |
| Backend unit/regression tests | 218 passed; 4 pre-existing failures; 14 optional tests skipped |
| Frontend unit/regression tests | 71 passed across 17 files |
| Full browser suite | 42 passed, including live administrator/user workflows and payroll PDFs |
| Backend production build | Passed |
| Frontend production build | Passed; existing bundle-budget/CommonJS warning categories remain |
| Interactive PowerShell wrapper | Syntax parsed successfully; operator supplies real credentials interactively |

The four backend failures are the previously reported mandatory BASIC/DA fixture
mismatches in `salary-components/salary-calculation.service.spec.ts`; that source,
its tests and payroll formulas remain unchanged. The prior authentication task
independently reproduced those failures from original HEAD source. Security
checks use randomly named disposable MongoDB databases; browser tests used a
temporary backend with random credentials and disposable employee fixtures.
No real administrator or payroll data was provisioned or removed.

Coverage includes bootstrap/repeat refusal, unique-email enforcement, safe hash
storage and responses, user login, every management endpoint's role restriction,
self-promotion rejection, disabled-account login/access, session revocation,
multiple administrators, last-admin/self-access protections, concurrent admin
changes, legacy index migration, controlled recovery and the existing complete
route audit. Browser checks include confirmations, role-aware navigation,
ordinary-user route rejection, user creation/editing/password reset/status, and
all existing payroll/report/navigation regressions.

## Files added or modified in this extension

Backend added:

- `scripts/admin.ps1`
- `src/auth/account-storage.ts`, `admin-provisioning.ts`, `recover-admin.ts`
- `src/auth/users.dto.ts`, `users.service.ts`, `users.controller.ts`
- `test/users.e2e-spec.ts`, `USER-MANAGEMENT.md`

Backend modified:

- `package.json` (create-admin, recover-admin and auth:recover commands)
- `src/auth/auth.schema.ts`, `auth.service.ts`, `auth.controller.ts`,
  `auth.guard.ts`, `auth.module.ts`, `bootstrap-admin.ts`
- `test/auth.e2e-spec.ts` (role-bearing login responses and all 24 routes)
- `AUTHENTICATION.md`, `AUTHENTICATION-REPORT.md`, `LOCAL-DEVELOPMENT.md`, `.env.example`

Frontend added:

- `src/app/users/users.ts`, `users.html`, `users.css`, `users.spec.ts`
- `e2e/user-management.spec.ts`

Frontend modified:

- `src/app/auth/auth.ts` (role state and administrator guard)
- `src/app/app.config.ts`, `src/app/app.html`, `src/app/app.css` (route/navigation)
- `AUTHENTICATION.md`

No payroll source was modified, no dependencies were added, no repository files
were deleted and no branch/history/commit/push operation was performed. Existing
uncommitted changes, including the delete-confirmation helper, were preserved.
