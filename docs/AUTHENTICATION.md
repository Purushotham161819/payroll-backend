# Authentication and deployment

The application uses express-session with MongoDB-backed server-side sessions,
Argon2id password hashes, and an HttpOnly, SameSite=Lax cookie. No access or
refresh tokens are stored in browser storage. Cookies are Secure in production.
Sessions have an absolute eight-hour lifetime, rotate on login, and are deleted
on logout. Every protected request checks the account still exists and is active.

Only `POST /auth/login` is public. `GET /auth/me`, `POST /auth/logout`, the root
endpoint, and every business controller require authentication through an
APP_GUARD provider. No registration or public bootstrap endpoint exists.
Admins can manage accounts and use payroll; Users can use payroll but cannot
manage accounts. `/users` and its APIs require the Admin role. See
[USER-MANAGEMENT.md](USER-MANAGEMENT.md) for setup, daily use and recovery.

## Local setup

1. Install dependencies with `npm.cmd ci` in both repositories and start MongoDB.
2. Use the **existing application's database** in MONGODB_URI. AppModule's
   actual default is `mongodb://127.0.0.1:27017/payroll_db`; an older local guide
   incorrectly named `payroll`. Authentication does not migrate employee data.
3. Supply SESSION_SECRET using a secret manager or generate it in PowerShell:

   ```powershell
   $env:SESSION_SECRET = node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('base64url'))"
   $env:FRONTEND_ORIGIN = 'http://localhost:4200'
   ```

   Keep this secret stable across restarts and instances; changing it invalidates
   existing cookies. `.env.example` contains names only. Backend startup and administrator commands automatically load `.env` from
   the working directory, without overriding existing shell variables. With a supported Node
   version, `node --env-file=.env dist/main.js` explicitly loads a local file.
4. Create the initial administrator using the controlled command below.
5. Backend: `npm.cmd run start:dev`. Frontend, in payroll-frontend:
   `npm.cmd start`. Open http://localhost:4200, sign in, and use **Sign out**
   in the workspace header to destroy the server session.

## Initial administrator

In a private PowerShell terminal in payroll-backend, confirm MONGODB_URI points
to the existing application database and run:

```powershell
npm.cmd run create-admin
```

The command prompts for your email, a password of 8-128 characters, and password
confirmation. Password input is masked, kept out of command-line arguments and
shell history, and cleared from the temporary environment after the child exits.
The backend validates the credentials and stores an Argon2id hash (64 MiB, three
iterations). There is no shipped account or default password.

The command succeeds only when no administrator account exists, including
disabled administrators. Repeating it cannot overwrite an existing account.
Concurrent setup attempts are serialized through MongoDB. Additional admins
must be created through the authenticated User Management page.

For automation or non-Windows environments, supply BOOTSTRAP_ADMIN_EMAIL and
BOOTSTRAP_ADMIN_PASSWORD through a secret manager and run
`npm run auth:bootstrap`. Remove the variables afterward. Production runtime
without ts-node can run `node dist/auth/bootstrap-admin.js` after building.
Backend startup and administrator commands load `.env` from the working
directory; existing shell variables take precedence. Do not put credentials into source or shell history.

## User Management

Start the backend with `npm.cmd run start:dev` and Angular, in payroll-frontend,
with `npm.cmd start`. Open http://localhost:4200 and log in using the account you
just created. Administrators see **User Management** in the sidebar.

- **Add User:** enter email, password and confirmation, choose User or Admin,
  select active status, then save. User is the default role.
- **Edit:** change email or role. Your own administrator role cannot be removed.
  Role/email changes invalidate existing sessions; changing your own email
  returns you to login.
- **Reset password:** enter and confirm a new password, choose Review reset,
  then confirm the reset. All of that account's previous sessions stop working.
  Resetting your own password returns you to login. Communicate new passwords
  through a secure channel; no password is emailed, logged or displayed later.
- **Deactivate / Activate:** confirm the action. Deactivation immediately blocks
  login and invalidates old sessions. Reactivation permits a fresh login and
  never revives previous sessions.

Users can access the existing payroll features but cannot open this page or
enumerate/change accounts through its APIs. Administrators cannot deactivate
themselves or demote themselves. The last active administrator is preserved.
Accounts are retained; there is no account-delete API or UI.

## Recovering administrator access

On the trusted backend host, in a private terminal configured for the same
MONGODB_URI, run:

```powershell
npm.cmd run recover-admin
```

Supply the email of an existing administrator and a new password twice. Recovery
does not create accounts or promote Users. It resets that administrator's
password, reactivates the account, and invalidates all previous sessions. Then
log in with the new password. No unauthenticated recovery endpoint exists.

For secret-manager automation, use the same BOOTSTRAP_ADMIN_EMAIL /
BOOTSTRAP_ADMIN_PASSWORD variables with `npm run auth:recover`, or the compiled
`node dist/auth/recover-admin.js`. These operator commands require trusted host
and database access; protect those privileges independently of application login.

## Account write serialization and upgrades

Startup and provisioning migrate only the obsolete unique role index in
`authusers`; the unique email index stays in place. Existing accounts, hashes
and roles are preserved. No payroll collections are migrated or deleted.
Legacy sessions with no version use version zero until account access changes.

Account writes and provisioning use a database-wide mutex in
`auth_management_locks`, compatible with standalone MongoDB and multiple API
processes. An administrator is checked again inside this lock. Competing writes
can return 409 and should be retried. This prevents concurrent administrator
deactivations/demotions from removing all administrator access.

The lock deliberately has no automatic lease expiry: an expired lease must not
allow a paused writer to continue alongside another writer. A crashed writer can
leave account writes blocked. Normal startup now checks completed user indexes
without acquiring the account write lock, so login and reads remain available.
Only a pending index migration requires that lock; startup briefly waits for a
concurrent initializer and fails clearly if indexes remain incomplete. Startup
never removes an existing lock. To recover a verified abandoned lock:

1. Stop **all** backend instances and provisioning/recovery commands.
2. In an authenticated MongoDB administration tool, select the application's
   existing database and inspect `auth_management_locks`.
3. Only after confirming there are no running writers, remove its one record
   with `_id: 'accounts'`. Do not remove accounts or any payroll collections.
4. Restart the backend and rerun the interrupted command if needed. Initial
   setup will still refuse to overwrite an administrator it already created.

Never clear the lock while a writer might still be running. No replica-set
transactions, payroll schema changes, or public setup endpoints are required.


## Production

- Set NODE_ENV=production, a persistent random SESSION_SECRET, the existing
  MONGODB_URI, PORT, and an exact HTTPS FRONTEND_ORIGIN (no trailing slash).
- Build the backend with `npm.cmd run build`; output is `dist/main.js`.
  Build Angular with `npm.cmd run build` in payroll-frontend.
- Configure Angular's `src/environments/environment.ts` apiUrl before building.
  Prefer `/api` with a reverse proxy forwarding `/api/*` to backend `/*`, or an
  HTTPS API origin on the same site. Never put secrets into Angular environment
  files. The example environment file documents a same-origin deployment.
- Serve frontend and API over HTTPS on the same site. SameSite=Lax intentionally
  does not support unrelated cross-site frontend/API deployments. A same-origin
  proxy avoids third-party-cookie restrictions.
- If TLS terminates at a proxy, set TRUST_PROXY_HOPS to the exact trusted hop
  count and restrict direct backend access. The proxy must overwrite forwarded
  headers and preserve Origin and X-Payroll-Request. Do not blindly trust arbitrary
  forwarded client addresses. Leave this variable unset for direct development.
- CORS permits only FRONTEND_ORIGIN with credentials. For every state-changing
  request, including login, clients must send that exact Origin and
  `X-Payroll-Request: 1`. Angular adds the header and credentials only to API URLs.
  Cross-origin scripts cannot supply this custom header without CORS permission;
  exact Origin validation also rejects ordinary forged forms and disallowed
  origins. Read-only GET endpoints must remain side-effect-free.
- Helmet supplies security headers; API responses have Cache-Control: no-store.
  Configure frontend security headers and SPA history fallback at its host.
- Login permits ten attempts per IP per fifteen minutes. Its limiter is local
  to the process. Multi-instance deployments need a shared limiter or equivalent
  rate limiting at the trusted ingress. Sessions themselves are shared in MongoDB.
- Use a least-privilege authenticated MongoDB connection and protect backups,
  session records, environment configuration, and operator access. Do not log
  request bodies, cookies, or authentication headers at the proxy or APM layer.
- `.env` files must remain ignored. No production account or secret is created
  by this change; provisioning and real deployment configuration remain operator
  steps.

## Verification

`npm.cmd test -- --runInBand` runs backend unit/regression tests.
`npm.cmd run test:e2e -- --runInBand` runs real-session and discovered-route
security checks against a uniquely named disposable local MongoDB database; it
never uses the payroll database for these writes. MongoDB must be running locally.
The suite removes only its own generated test database.

Frontend: `npm.cmd test -- --watch=false`, then start Angular and run
`npm.cmd run test:browser`. Browser business fixtures simulate authenticated
sessions alongside their existing mocked business APIs. The independent login
browser test exercises login errors, destination routing, expiry and logout.
Live API browser tests require TEST_AUTH_EMAIL and TEST_AUTH_PASSWORD for an
already provisioned account; without them they explicitly skip. Never use
production credentials for tests. The existing optional read-only MongoDB
integration test likewise requires those credentials when RUN_MONGO_TESTS=1.

PDFs are generated entirely in Angular from authenticated API data. There is no
backend PDF download route to exempt or protect. Browser PDF regression tests
verify report rendering; session enforcement on payroll data is tested on both
GET and POST /payroll/annual.

Implementation follows [Express session cookie and regeneration guidance](https://expressjs.com/en/resources/middleware/session/),
[OWASP custom-header CSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html),
and [OWASP password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
