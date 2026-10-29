# Administrator CLI without restarting the backend

Leave the existing backend running on port 3000. Open a **second terminal**:

```powershell
cd D:\Projects\payroll-backend
npm.cmd run create-admin
```

Enter the administrator email, password (8-128 characters), and matching password
confirmation at the masked prompts. Do not run start, start:dev or start:prod
again to create an account. No backend restart, frontend change or new port is
needed for this fix.

If an administrator already exists, setup stops without changing any account.
For lost credentials, explicitly run `npm.cmd run recover-admin` and enter an
existing administrator's email and a new password twice. Recovery resets that
account, reactivates it and invalidates its old sessions using the existing
workflow. Initial setup never invokes recovery automatically.

## Diagnosis and narrowly scoped correction

Inspection found that the existing bootstrap and recovery functions already use
Mongoose directly. Neither imports main.ts/AppModule nor starts a Nest HTTP
server. Only normal backend startup calls app.listen(). The reported EADDRINUSE
is consistent with a second normal server launch; an HTTP bind through the
inspected administrator implementation could not be reproduced. It would be
incorrect to claim the shared provisioning function contained an HTTP listener.

The previous PowerShell launcher invoked relative npm commands, depending on
the current working directory and additional npm script dispatch. It now anchors
itself to this repository and invokes an absolute standalone Node CLI entry point
directly. This removes those ambiguities and gives setup failures actionable
messages rather than prompting another server launch.

`scripts/admin-cli.cjs` loads the existing environment configuration from the
backend root, reuses the API's CreateUserDto validation, checks MongoDB connectivity
with a five-second server-selection timeout, and performs read-only diagnostics
for existing administrators. It delegates all writes, hashing, concurrency locks,
role rules and recovery behavior to the existing runAdminCommand function.
That function rechecks account existence under its existing MongoDB-wide lock.
Connections are closed on success and failure; failures return a nonzero exit
code. Errors never print passwords, raw MongoDB URLs or validation objects.

An existing administrator is detected before provisioning/index initialization,
so a repeated initial setup command makes no account or index changes. Any
initialization performed when creating a first account is the existing shared
provisioning behavior, unchanged by this fix.

The CLI has no main.ts/AppModule import, NestFactory.create(), app.listen(),
session configuration or HTTP endpoint. It does not require SESSION_SECRET;
normal backend startup retains its existing secret validation, CORS, cookie,
authentication, role and rate-limit settings.

## Environment and automation

MONGODB_URI retains its existing name and local default
`mongodb://127.0.0.1:27017/payroll_db`. Set it to the intended application database
in your environment or private backend .env. Shell values take precedence. The
launcher changes to the backend root before loading configuration. No .env file,
secret, database configuration, package script name or dependency was changed.

For trusted automation with credentials supplied through a secret manager, the
same npm commands support an explicit switch:

```powershell
npm.cmd run create-admin -- -UseEnvironment
npm.cmd run recover-admin -- -UseEnvironment
```

These read BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD. Clear the supplied
variables afterward; never put actual values into command arguments or Git.
The default, without this switch, still prompts and confirms the masked password.
Existing auth:bootstrap and auth:recover commands remain compatible standalone
operations. Only the explicit recovery command can reset an existing password.

If input is invalid, correct the email/password requirements. If MongoDB cannot
be reached, check MONGODB_URI, MongoDB availability and database permissions.
If another account operation is active, wait and retry. Never kill the backend
or clear an account lock as a workaround for a port conflict. For a genuinely
abandoned lock, follow the existing controlled operator procedure in
AUTHENTICATION.md; no lock was cleared as part of this fix.

## Scope and verification

Changed: scripts/admin.ps1. Added: scripts/admin-cli.cjs,
test/admin-cli.e2e-spec.ts, test/admin-cli-no-listen.cjs, and this guide.
No application source, frontend file, package script, dependency, secret file,
API, database setting or existing business data was changed. Existing unrelated
uncommitted changes were preserved. Nothing was committed or pushed.

Tests use random credentials and uniquely named disposable test databases, never
the application's real account collection. They execute the actual npm
create-admin launcher with explicit environment credentials while port 3000 is
occupied, check hashed passwords, repeated-setup immutability, concurrent setup,
invalid input, database failure, recovery, and matching/mismatching masked-prompt
responses (simulated Read-Host responses rather than a human entering secrets).
Subprocesses are instrumented to throw if net.Server.listen is called; none of
the CLI paths may start a listener. Successful process exit also verifies that
no HTTP listener or MongoDB connection keeps the CLI alive.

The live backend's port-3000 PID was recorded as 27908 before changes and checked
after each CLI test. The process was never killed or restarted, and protected
GET /employees continued to return 401 without authentication. Source files and
dist were left untouched so the development watcher would not reload.

Production source was checked with
`node node_modules/typescript/bin/tsc --noEmit --incremental false -p tsconfig.build.json`.
This passed without rebuilding dist or disturbing the running application.
The JavaScript runner also passed node --check.

Actual test results:

- `npm.cmd run test:e2e -- --runInBand`: 28 passed across four suites, including
  the new CLI tests and existing authentication/session/authorization/recovery
  tests. Concurrent initial setup created exactly one test administrator.
- `npm.cmd test -- --runInBand`: 224 passed, four pre-existing mandatory BASIC/DA
  fixture failures, 14 optional tests skipped. No payroll tests or rules were
  changed to hide those failures.
- The no-output TypeScript production-source check passed. No production build,
  live-server restart, frontend test run or frontend modification was needed for
  this script-only fix; rebuilding dist was deliberately avoided.
- Final port check still showed PID 27908 on port 3000, and the existing backend
  returned 401 for an unauthenticated employee request.
