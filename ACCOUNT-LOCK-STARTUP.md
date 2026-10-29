# Account-operation lock startup correction

## Confirmed cause

UsersService.onModuleInit previously acquired the same persistent MongoDB mutex
used for user account writes on every startup, even when no migration was needed.
The configured database already had the correct unique email index and no
obsolete unique role index, but it also contained an `accounts` lock created at
2026-10-29 19:16:11 UTC. Its record had no hostname or process ID. A duplicate-key
error acquiring that mutex became ConflictException and aborted Nest startup.

Before changes, port 3000 had no listener and an existing development watcher
was still running. No local administrator CLI was found during that initial
inspection. These observations do not prove the historical lock owner is dead:
its random owner ID cannot be reliably mapped to a process. No claim is made
about which prior operation left it behind, and no lock was deleted or reset.

## Fix

- Normal startup checks whether user indexes are already complete. A completed
  initialization returns without acquiring an account mutation lock.
- An actual legacy index migration still uses the existing MongoDB-wide mutex
  and rechecks readiness inside it. Concurrent initialization is handled by a
  bounded five-second retry/readiness check rather than immediate 409 failure.
- If initialization remains incomplete and ownership cannot be verified, startup
  fails with an actionable message. It does not skip required unique indexes,
  expire another writer's lock or silently continue an incomplete migration.
- Startup warns when a lock remains after completed initialization. Authentication,
  login, reads and logout are available; conflicting account writes remain blocked.
- Account writes, administrator creation and recovery retain their existing
  mutex, owner-specific try/finally release, role checks, hashing and session rules.
  A rejected contender never deletes the active writer's lock.

No lock schema, lease, distributed locking service, authorization policy, API
contract, password rule, user record or account recovery action was introduced.
Branding, organization configuration, payroll source and frontend files were not
changed. Existing uncommitted work was preserved.

## Actual verification

- Production build passed using
  `npm.cmd run build -- --path .tmp/publish-tsconfig.json`; compiled verification
  output stays in an ignored directory rather than replacing live server files.
- Backend unit/regression tests: **234 passed**, **4 known pre-existing BASIC/DA
  fixture failures**, **14 optional tests skipped**. The eight new lock tests pass.
- Backend end-to-end tests: **31 passed** across five suites. The new full-AppModule
  tests start twice with initialized indexes and an unverified legacy lock, verify
  login/account reads/logout, and prove account writes still return 409 while the
  original lock and test account are preserved. Existing bootstrap, concurrent
  setup, recovery, session and authorization tests also pass.
- Lock tests cover successful/failed operation cleanup, simultaneous writers,
  readiness without a lock, repeated initialization, protected legacy migration,
  waiting for a concurrent initializer, and refusing to expire an unverified lock.
- The existing development watcher rebuilt after the source edit and started the
  backend as PID 32356 on port 3000. Repeated checks after the test run found that
  same process listening. Live GET /employees, /users and /settings/organization
  all returned 401 without authentication. No process was killed or manually
  terminated and no second HTTP server was launched.
- The actual database's lock and user indexes were inspected read-only before
  and after; the legacy lock remained unchanged. Real login/user edits were not
  attempted because no real credentials were supplied. Those workflows were
  verified against disposable test databases with generated credentials instead.

No frontend tests/build were run for this backend-only correction. No existing
database was reset or dropped; test suites clean up only their uniquely named
disposable databases. Nothing was committed or pushed.

## Start command and remaining operator step

The existing watcher is already serving port 3000; do not start a second copy.
To start the backend later, from D:\Projects\payroll-backend:

```powershell
npm.cmd run start:dev
```

The retained legacy lock **still blocks account-changing operations**, including
creating users and administrator recovery. This is intentional fail-closed
behavior, not a claim that the lock has been repaired or safely expired.

If an operation is active, allow it to finish and release its own lock. For an
abandoned legacy lock, an operator must first verify all backend writers and
administrator setup/recovery commands using this database are stopped. Because
this old record has no verifiable process ownership, age alone is insufficient.
Only after that verification, use an authenticated MongoDB administration tool
to remove the one `auth_management_locks` record with `_id: 'accounts'`, then
restart normally. Do not delete user accounts, other lock records, indexes or
payroll collections. No such recovery was automatically performed in this task.

Files changed: `src/auth/account-storage.ts`, `src/auth/users.service.ts`,
`AUTHENTICATION.md`, `USER-MANAGEMENT.md`. Files added:
`src/auth/account-storage.spec.ts`, `test/startup-lock.e2e-spec.ts`, this guide.
