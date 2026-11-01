# Authentication implementation report

This is the original authentication report. The subsequent
[User Management report](USER-MANAGEMENT.md) supersedes its single-administrator
limitation, provisioning instructions, route count and verification totals.

Completed 29 October 2026 in payroll-backend and payroll-frontend. No commits,
pushes, branch changes, history changes, employee deletion, or payroll formula
changes were performed. The frontend's pre-existing change to
`src/app/shared/delete-confirmation.ts` was preserved.

## Flow and session strategy

The styled, responsive `/login` page includes email/password validation,
show/hide password, duplicate-submit prevention, progress and safe errors.
The Angular workspace is a guarded parent layout, preserving its sidebar,
navigation and routed pages. Login restores a safe internal destination;
expired sessions return to login; header logout destroys the server session.

express-session manages signed HttpOnly cookie identifiers; connect-mongo stores
session data in the existing MongoDB database. Production cookies are Secure,
SameSite=Lax and host-only. Sessions rotate on login and expire absolutely after
eight hours. Logout deletes the server record, and replay is rejected. Account
status is checked on every protected request. No tokens enter localStorage.
This fits the existing Angular-to-Nest architecture with same-site HTTPS hosting.

Persistent `authusers` contain normalized unique email, an Argon2id hash excluded
from default queries, active status, administrator role and timestamps. Login
returns only id/email and a session cookie. Bootstrap uses 64 MiB / three
Argon2id iterations, validates inputs, and refuses existing accounts. Unique
email and role indexes prevent duplicate accounts or concurrent duplicate
administrators. This release supports one administrator; no public registration,
password recovery or lower-privilege role is introduced.

## Public allowlist and complete route audit

**Only POST /auth/login is public**, because users need it to sign in. CORS
preflight OPTIONS is transport negotiation and returns no business data.
No health or root endpoint is exempted. APP_GUARD protects future controllers by
default; the public exception matches the specific AuthController login handler.

The real AppModule is loaded against an isolated database in the security suite.
The suite discovers controllers and their handler metadata automatically and
asserts 401 without authentication for every protected route:

| Controller | Protected routes |
| --- | --- |
| Root | GET / |
| Authentication | GET /auth/me; POST /auth/logout |
| Employees | GET /employees; POST /employees; PATCH /employees/:id; DELETE /employees/:id; PATCH /employees/:id/terminate; PATCH /employees/:id/rehire |
| Salary components | GET /salary-components; POST /salary-components; PATCH /salary-components/:id; DELETE /salary-components/:id; PATCH /salary-components/:id/status; GET /salary-components/formula-variables |
| Payroll | GET /payroll/annual; POST /payroll/annual |
| Statutory settings | GET /settings/statutory-deductions; PUT /settings/statutory-deductions |

There are **19 protected routes**: 16 business routes, the root route, and two
session routes. Authenticated audit requests reach the handlers; invalid business
inputs may still return their appropriate 400/404 responses. Successful reads,
live authenticated employee API calls, and browser workflows are also exercised.
All current accounts have administrator permissions. Missing/expired/invalid
authentication returns 401; authenticated requests failing CSRF checks return
403. A future permission system must add explicit permission checks.

PDFs are created in the browser, rather than served through a separate backend
download route. Both payroll source-data routes require authentication; browser
tests verify authenticated report generation and PDF content. Formula evaluation
remains part of the protected salary/payroll architecture; no alternate public
data endpoint was found.

## Hardening

- Argon2id hashing, normalized email, unique indexes, validation, generic invalid
  credential errors and dummy-hash verification for unknown accounts.
- Exact credentialed CORS origin; custom-header plus exact-Origin CSRF checks
  for every unsafe method, including login and logout.
- Ten login attempts per IP per fifteen minutes; safe 429 response.
- HttpOnly/Secure/SameSite cookies, session regeneration, absolute expiry,
  server-side revocation on logout and active-account validation.
- Helmet response headers and no-store API responses.
- Required random SESSION_SECRET, HTTPS production-origin validation and
  positive-integer trusted-proxy hop validation. Environment secret files ignored.
- Angular interceptor confines credentials/custom headers to configured API URLs,
  clears invalid state on 401 and avoids login redirect loops.
- Updated the existing Nest Express adapter within major version 12 to obtain
  the patched Multer dependency. `npm audit --omit=dev` reports **zero** production
  vulnerabilities. Full dependency audit still reports development-tool advisories;
  no broad or breaking dependency upgrade was attempted.

## Provisioning, environment and deployment

See [AUTHENTICATION.md](AUTHENTICATION.md) for secure PowerShell prompting,
`npm.cmd run auth:bootstrap`, build/start/login/logout instructions, disabling an
account, HTTPS, CORS, cookies, CSRF, reverse proxy and database configuration.
No actual application administrator or deployment secret was created. Test
accounts use random passwords and exist only in disposable test databases.

Required: SESSION_SECRET (at least 32 random characters). Existing MONGODB_URI
must identify the application's real database. FRONTEND_ORIGIN defaults to
http://localhost:4200; PORT defaults to 3000. Set NODE_ENV=production and an HTTPS
FRONTEND_ORIGIN for production. Set TRUST_PROXY_HOPS only behind the corresponding
trusted proxy topology. BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD are for
the controlled provisioning command only; remove them afterward.

Angular's existing environment.ts holds the public apiUrl. The added example
uses `/api` for a same-origin reverse proxy. Neither frontend configuration nor
source includes credentials or session secrets. Existing environment files were
not overwritten. The old local guide's default database name was corrected to
the actual AppModule default, payroll_db; existing database selection is preserved.

Limitations: one administrator, eight-hour reauthentication, no recovery UI,
same-site HTTPS deployment required, and per-process login limiting. Multiple
backend replicas need shared ingress rate limiting or a shared rate-limit store.
Provision the real account and configure secrets/HTTPS before deployment.

## Actual verification results

| Check | Result |
| --- | --- |
| Backend unit/regression suite | 218 passed, 4 pre-existing failures, 14 optional tests skipped; 25 suites passed, 1 failed, 7 skipped |
| Backend end-to-end security suite | 9 passed across 2 suites |
| Frontend unit/regression suite | 65 passed across 16 files |
| Browser suite with isolated backend/database | 41 passed, no skips |
| Backend production build | Passed |
| Frontend production build | Passed; initial bundle 591.68 kB exceeds the 500 kB warning budget; PDF dependency CommonJS warnings remain |
| Production dependency audit | Zero known vulnerabilities reported |

The four backend failures are in salary-components/salary-calculation.service.spec.ts.
Its older fixtures conflict with existing mandatory BASIC/DA percentage validation.
The identical four failures were independently reproduced from original HEAD
source copied to an isolated temporary baseline. Neither that calculation source,
its tests nor payroll rules were changed to mask the failures.

Security tests exercise real administrator bootstrap and duplicate refusal,
credential validation, disabled users, hash storage/non-disclosure, every route,
CSRF, cookie attributes, invalid cookies, absolute expiry, logout replay and
rate limiting. The real AppModule route discovery also picks up future imported
controllers. Browser tests cover login errors, return destination, logout,
expiration, employee CRUD UI, selection, lifecycle, settings, formula editing,
annual/monthly reports, ordering, statutory calculations and PDF contents.

Browser verification used a temporary local backend, two disposable employee
fixtures and randomly generated credentials. Only the uniquely named test
databases were removed afterward. Existing business browser tests gained an
authenticated mock fixture; live API consumers now log in with supplied test
credentials and send the CSRF header. The existing modal test was updated for
the Pay Frequency field's actual tab order, to wait for rendering, and to identify
the saving submit button without depending on a pre-existing misencoded ellipsis.

## Files changed

Backend added:

- .env.example; AUTHENTICATION.md; AUTHENTICATION-REPORT.md.
- src/auth/auth.schema.ts; auth.service.ts; auth.controller.ts; auth.guard.ts;
  auth.module.ts; http-security.ts; bootstrap-admin.ts.
- test/auth.e2e-spec.ts.

Backend modified:

- .gitignore; package.json; package-lock.json; LOCAL-DEVELOPMENT.md.
- src/app.module.ts; src/main.ts.
- test/app.e2e-spec.ts; src/employees/employees.integration.spec.ts.

Frontend added:

- AUTHENTICATION.md; src/environments/environment.example.ts.
- src/app/auth/auth.ts; login.ts; auth.spec.ts.
- e2e/authenticated-test.ts; e2e/authentication.spec.ts.

Frontend modified:

- .gitignore; src/app/app.ts; app.html; app.config.ts.
- e2e/annual-payroll-pdf.spec.ts; conditional-formulas.spec.ts;
  dynamic-components-pdf.spec.ts; employee-edit-pay-frequency.spec.ts;
  employee-lifecycle.spec.ts; employee-modal-selection.spec.ts; employees.spec.ts;
  formula-components.spec.ts; management-delete.spec.ts;
  mandatory-components.spec.ts; monthly-payroll-pdf.spec.ts;
  ordered-payroll-pdf.spec.ts; pdf-presentation.spec.ts; settings.spec.ts;
  statutory-deductions.spec.ts; statutory-payroll-pdf.spec.ts; ui-refinements.spec.ts.

Frontend `src/app/shared/delete-confirmation.ts` was already modified before
this task and was not edited. No source files were moved or deleted.

## Conservative cleanup review

Reviewed Git status in both repositories, generated-directory inventories and
references in build, test, runtime and browser configuration. Retained:

- Backend .tmp: numerous pre-existing work directories and scripts, whose
  ownership/retention requirements are uncertain. Task verification staging and
  the original-source baseline also remain ignored here for review.
- Backend dist: required by start:prod and reproducible from the production build.
- Both node_modules: installed dependencies required for local verification.
- Frontend .angular/cache and dist: rebuildable caches/build output; retained
  rather than deleting existing ignored work.
- Frontend artifacts and test-results: existing screenshots plus newly generated
  regression outputs; potentially useful review evidence.
- Documentation, configuration, tests, assets, hidden files, and all existing
  untracked/uncommitted work: preserved.

**No repository cleanup deletions were made.** Disposable test database cleanup
was confined to databases created by the verification harness. No user payroll
records or statutory settings were removed. Nothing was committed or pushed.
