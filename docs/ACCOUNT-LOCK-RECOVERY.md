# Verified account-operation lock recovery — 29 October 2026

## Confirmed cause and ownership findings

The configured `payroll_db.auth_management_locks` collection contained its unique
`_id: accounts` record, created at `2026-10-29T19:16:11.479Z`. Its only fields were
`_id`, a random `owner` UUID and `createdAt`. There was no hostname, PID, operation
name or heartbeat. The owner fingerprint was `ae38b6dcafc9f8fa` (truncated SHA-256).
The original process and the historical reason it failed to release the record
cannot be reconstructed from that metadata. Age was not treated as proof of expiry.

The retained record caused each new lock insertion to receive a MongoDB duplicate
key error, which `withAccountLock` correctly converts to a conflict. It is unrelated
to HTTP port binding, passwords or SESSION_SECRET. The lock deliberately has no
lease: a paused writer must not overlap a new one after an arbitrary timeout.

User indexes were complete: unique email, ordinary organizationId and primary-key
indexes, with no obsolete unique role index. Current `initializeUserIndexes` checks
readiness and does not acquire an account lock during normal initialized startup.
An actual index migration still uses the mutex. No new startup-lock bug was found.

Initial privileged process inspection found backend watchers 24720 and 7808, with
backend PID 33700 serving port 3000. MongoDB reported no active operation in the
configured database, but that alone could not exclude a paused writer. Therefore
the lock was initially classified as untraceable, not automatically stale.

## Exact recovery performed

1. Read the existing recovery requirements in `AUTHENTICATION.md`,
   `ACCOUNT-LOCK-STARTUP.md`, `SUPER-ADMIN.md`, account-storage source and CLI/tests.
2. The operator confirmed all backend/account writers were stopped. Independent
   inspection found port 3000 free but old watcher 24720 still running.
3. The operator explicitly authorized stopping **only** that remaining watcher.
   Its executable, repository path, command and creation time were checked before
   stopping it. Privileged inspection then found no matching backend/provisioning
   writers and no port 3000 listener. With all writers stopped, the retained lock
   could safely be treated as abandoned under the documented procedure.
4. Re-read the exact legacy record and checked its field set, timestamp and owner
   fingerprint. Calculated data/index digests for application collections, excluding
   the lock collection and TTL-managed session collection. No hashes or credentials
   were printed or stored in a report.
5. Removed **one** document using `_id`, its exact original `owner` and original
   `createdAt` in the deletion filter. The deletion count was exactly one. No
   account, index, session or business collection was deleted or reset.
6. Used the unchanged production `withAccountLock` function for a lock-only probe:
   acquired a fresh lock, confirmed a competing acquisition returned 409 without
   deleting/replacing the owner, and verified release on completion. No account
   mutation was performed by this probe. Application record/index digests matched
   before and after recovery.
7. A redundant sandbox process query encountered Windows Access Denied. It did not
   supply ownership evidence; the earlier privileged pre-recovery check had
   succeeded. Repeated the process check with the required permission immediately
   afterward and again found no backend/provisioning writers or port 3000 listener.
8. Started **one** normal `npm.cmd run start:dev` instance. Compilation reported
   zero errors; Nest started successfully as PID 16468 on port 3000. Startup did
   not recreate the lock. Repeated the lock-only probe with this backend running;
   it released normally and real account digests remained unchanged.
9. Ran the actual npm Super Admin command on a uniquely named disposable database
   while the restarted backend stayed on the same PID. A preload hook prohibited
   any HTTP listener in the CLI process. It passed; the disposable database was
   removed afterward. No real Super Admin was created. The final real lock query
   returned no record and real `super_admin` account count remained zero.

No locking, authentication, authorization, hashing, session, payroll or frontend
implementation changes were needed. Only this report and the obsolete blocker
notice in `SUPER-ADMIN.md` were changed. Existing Git work was preserved; nothing
was committed or pushed. Future locks still require the same controlled recovery.

## Actual checks in this recovery run

| Executed check | Result |
| --- | --- |
| `npm.cmd run build -- --path .tmp/publish-tsconfig.json` | Passed; ignored production output preserves the live build directory during validation |
| `npm.cmd test -- --runInBand` | 234 passed, 14 skipped, 4 known pre-existing BASIC/DA fixture failures |
| `npm.cmd run test:e2e -- --runInBand` | 46 passed across 6 suites, including account locking/startup, authentication, CLI setup/recovery, Super Admin concurrency, session invalidation and organization isolation |
| Actual `npm.cmd run create-super-admin -- -UseEnvironment`, disposable DB | Passed with the original backend PID 33700 unchanged; Argon2id verified for 8-character input; duplicate setup and 7-character input refused without changing accounts; test lock released; no HTTP listener allowed |
| Same actual npm command after recovery/restart, disposable DB | Passed with restarted backend PID 16468 unchanged; no CLI HTTP listener; real accounts unchanged |
| Real DB recovery-only digest comparison | Account/business records and indexes unchanged across lock deletion/probe |
| Real DB lock concurrency/release probes | Passed before and after normal backend restart; final lock absent |
| Normal `npm.cmd run start:dev` | Zero compilation errors, successful startup; no retained lock |
| Live unauthenticated `/auth/me` and `/employees` checks | Both returned 401, preserving authentication enforcement |

The four regression failures remain in
`src/salary-components/salary-calculation.service.spec.ts`; their fixtures conflict
with existing mandatory BASIC/DA percentage requirements. No calculation or test
was changed to hide them. Optional skipped tests are not counted as passes. The
platform test's deliberate audit failure logs a simulated error while its rollback
assertion passes. No frontend source changes were made, so frontend tests/build
were not rerun for this operational recovery.

## Commands to run next

The backend is already running on port 3000. Do **not** start a second copy. Open
a separate Command Prompt:

```bat
cd /d D:\Projects\payroll-backend
npm.cmd run create-super-admin
```

Enter your chosen email, password and confirmation using the masked prompts.
Passwords must be 8–128 characters. Keep the backend running: the provisioning
command uses MongoDB directly and does not start an HTTP server. Do not use the
test-only environment-credential invocation for ordinary interactive setup.

This recovery did not stop or modify the frontend. At final verification, however,
port 4200 had no listener. Start the frontend in a second Command Prompt:

```bat
cd /d D:\Projects\payroll-frontend
npm.cmd start
```

Then open `http://localhost:4200/login` and sign in with the newly provisioned
credentials. If it has already been started since this check, use that instance;
do not run two servers on port 4200.

To start the backend on a future occasion after it has been stopped:

```bat
cd /d D:\Projects\payroll-backend
npm.cmd run start:dev
```

Repeated provisioning refuses to overwrite a Super Admin. Use the dedicated
`npm.cmd run recover-super-admin` only for deliberate recovery of an existing
Super Admin. Never clear an active lock or remove a new lock based on the historical
timestamp in this report.
