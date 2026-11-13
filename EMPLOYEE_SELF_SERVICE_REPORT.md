# PayStream employee self-service implementation

Date: 10 November 2026. Changes are local and uncommitted. No staging, commits, pushes, branch switches, deployment, live email delivery, or production data migration was performed.

## Follow-up: existing pending user invitation conflict

A read-only diagnostic confirmed that EMP010 has an active employee record and an existing **unactivated regular-user** account in the same organization. The account records an invitation sent on 7 November 2026; this is not confirmation of inbox delivery. Employee Send Invite previously rejected that global login-email collision before attempting mail delivery.

The invitation API now returns `PENDING_USER_LINK_CONFIRMATION_REQUIRED` with a same-organization pending account ID when that account is eligible. The existing confirmation dialog then asks the administrator to **Convert and Send Invite**. Only the second explicit action sends `{ linkPendingUserId }`. The backend atomically verifies the exact account is still active, unactivated, a regular user, in the same organization, matching the employee email, and not already linked. It changes the role to read-only employee, binds the employee record, revokes old setup/reset tokens and sessions, and uses the existing invitation/email service for a new welcome link. No duplicate account is created. Active accounts, administrators, disabled accounts, other organizations and already-linked accounts cannot be converted this way.

Follow-up files: `src/auth/employee-accounts.controller.ts`, `src/auth/employee-accounts.service.ts`, `src/auth/employee-portal.integration.spec.ts`; frontend `src/app/employees/employee.service.ts`, `src/app/employees/employee-list.ts`, `src/app/employees/employee-list.html`, `src/app/employees/employee-portal.spec.ts`. No style/design-system changes. EMP010's live account was not modified and no real email was sent during diagnosis/testing; the administrator must retry Send Invite and explicitly confirm the conversion. This addition handles an unactivated account with an unchanged matching email, not active-account ownership transfer.

Targeted follow-up validation: **10 backend integration tests passed**, including conversion and protected-account cases; **11 frontend portal tests passed**, including the second-confirmation behavior. No project-wide regression suite or live mailbox delivery test was run. Application builds were not repeated for this follow-up; the selected backend and Angular tests compiled the affected code/templates.

## Scope and implementation status

Both existing PayStream repositories were verified before editing: `D:\projects\payroll-backend` and `D:\projects\payroll-frontend`. Both were on `main` with clean working trees. No Signum project files were accessed or changed.

| Area | Status | Result |
| --- | --- | --- |
| Employee login | Fully implemented | Existing email/password login, Argon2 hashing, server-side sessions, logout, password setup and recovery reused. |
| Employee dashboard | Fully implemented | Dedicated `/employee/dashboard`, browser-local morning/afternoon/evening greeting, optional first name, minute refresh, link to My Profile. No organization KPIs or sample data. |
| My Profile | Fully implemented | `/employee/my-profile` reuses EmployeeProfile, EmployeeTax and PayChecks. Own details, saved tax profiles/history and finalized paychecks/PDFs only. |
| Read-only restrictions | Fully implemented | Employee mutation APIs and administrator APIs rejected independently of Angular. Edit, calculate, save, change-tax-year and Mark as Paid actions unavailable to employees. |
| Send Invite | Fully implemented | Administrator-only action in existing employee kebab menu, confirmation dialog, email validation, account conflict detection, pending resend cooldown and centralized result modals. Existing actions preserved. |
| Welcome email and password setup | Fully implemented | Existing centralized Microsoft Graph integration and branded invitation template extended for employees; existing Set Password screen reused. |
| Lifecycle access controls | Implemented through administrator API | Enable/disable endpoint invalidates sessions and outstanding invitation/reset tokens. Termination/deletion/email mismatch/organization suspension immediately block access. Rehire requires explicit enablement. There is no new dedicated access-management UI. |
| Live delivery and browser acceptance | Requires configuration/manual validation | Actual Graph mailbox delivery and real browser desktop/mobile/PDF acceptance were not exercised. |
| Employee email ownership transfer | Not implemented | Email mismatch blocks access and invitation resend. No account is silently moved, renamed or linked to another employee. A verified administrator recovery process requires a separate authorized workflow. |
| Bank integration | Not implemented; intentionally excluded | Existing administrator Mark as Paid remains the payment mechanism. |

There is no partially implemented employee login, invitation, dashboard or My Profile flow. The lifecycle management API is complete; a dedicated management screen was not added.

## Backend files changed

New:

- `src/auth/employee-access.ts`: persisted account-to-employee validation and exact read endpoint allowlist.
- `src/auth/employee-accounts.controller.ts`: administrator invitation/status endpoints and employee own-profile endpoint.
- `src/auth/employee-accounts.service.ts`: provisioning, duplication checks, explicit lifecycle enable/disable and own-profile retrieval.
- `src/auth/employee-portal.integration.spec.ts`: eight isolated employee security/invitation/recovery tests.
- `EMPLOYEE_SELF_SERVICE_REPORT.md`: this report.

Modified:

- `src/auth/auth.schema.ts`: employee role, immutable employee reference, lifecycle version and unique partial index.
- `src/auth/auth.service.ts`: employee linkage/lifecycle check at login and every session validation; employee reference in identity response.
- `src/auth/auth.guard.ts`: reject employee requests outside the own-record GET allowlist and existing authentication operations.
- `src/auth/auth.module.ts`: register new controllers/service using existing providers.
- `src/auth/invitations.service.ts`: employee invitations, linkage validation at token inspection/activation, production loopback origin rejection.
- `src/auth/invitation-mail.ts`: employee welcome subject and portal description through existing EmailService.
- `src/auth/invitation-mail.spec.ts`: employee welcome content test.
- `src/auth/password-reset.service.ts`: employee record/lifecycle eligibility during existing recovery flow.
- `src/income-tax/tax.controller.ts`: permit employee-owned GETs after global authorization; preserve administrator-only tax writes/configuration.

## Frontend files changed

All paths below are relative to `D:\projects\payroll-frontend`.

New:

- `src/app/employees/employee-dashboard.ts`: focused dashboard using existing page header, card and button components.
- `src/app/employees/employee-portal.spec.ts`: ten focused employee dashboard, login/guard, navigation, profile, tax, paycheck and invitation tests.

Modified:

- `src/app/app.config.ts`: employee dashboard/My Profile routes in the authenticated shell.
- `src/app/app.html`: employee Dashboard then My Profile navigation; employee portal context.
- `src/app/auth/auth.ts`: employee identity role, safe employee return destination and role-aware route protection.
- `src/app/auth/login.ts`: employee login destination.
- `src/app/employees/employee.service.ts`: own-profile GET and administrator Send Invite request.
- `src/app/employees/employee-list.ts`: administrator invitation confirmation/loading/result handling.
- `src/app/employees/employee-list.html`: Send Invite kebab action and existing shared confirmation dialog.
- `src/app/employees/employee-profile.ts`: own-profile loading, employee tax tab and edit/save guards.
- `src/app/employees/employee-profile.html`: reuse approved details layout, hide editing/back-to-directory actions, pass read-only tax mode.
- `src/app/features/tax-management/employee-tax.ts`: read-only mode uses own saved financial years; skips organization tax configuration and salary-component API requests.
- `src/app/features/tax-management/employee-tax.html`: hide mutations in employee mode; show empty tax-profile explanation.
- `src/app/shared/notification-interceptor.ts`: let invitation action publish specific feedback without a duplicate generic modal.
- `src/app/shared/notification-interceptor.spec.ts`: pending-invitation notification test.
- `src/app/employees/employee-lifecycle.spec.ts`: provide existing authentication dependencies now required by the employee directory invitation action.

No design-system deviations, new fonts, icon libraries, style tokens, CSS overrides or dependencies were introduced. The approved profile, tax and paycheck presentation is reused. No administrator dashboard redesign was performed.

## Database model and indexing

Existing `AuthUser` now supports:

- `role: employee`.
- `employeeRecordId: string`, immutable, referring to the employee's MongoDB record ID, not the displayed EMP code.
- `employeeLifecycleVersion: number`, recording the employment lifecycle explicitly authorized for access.
- Unique partial index on `{ organizationId: 1, employeeRecordId: 1 }` for employee accounts with a string employee reference.

The existing globally unique login email remains unchanged. New invitations use the existing database-wide account-operation lock, including resend and status operations. Duplicate employee/email creation is also rejected on database unique conflicts. Existing Mongoose model initialization registers the new index; environments that disable automatic index creation must apply this schema index using their normal controlled index-management process before enabling provisioning.

No employee, payroll, salary, tax configuration, tax history or paycheck schema/data migration was introduced. Status changes retain employee and payroll history.

## New APIs

| Method and path | Access | Behavior |
| --- | --- | --- |
| `POST /employee-accounts/:id/invitation` | Active organization administrator | Select employee from the administrator's persisted organization, validate active employment/email, create securely linked pending employee account or resend existing pending invitation. Active account returns informative result. |
| `PATCH /employee-accounts/:id/status` | Active organization administrator | Body `{ "active": false }` disables access; `{ "active": true }` explicitly enables access after checking active employment, matching account email and organization. Invalidates sessions and outstanding setup/reset links; enable records current lifecycle version. Pending accounts then need Send Invite. |
| `GET /employee-portal/profile` | Active linked employee | Return only the employee selected by the authenticated account. No caller-provided employee/organization selector. |

The `:id` parameter on management endpoints is the employee MongoDB record ID. These endpoints retain existing origin/custom-header CSRF checks. They do not accept a client-selected organization or employee account role.

## Existing APIs and components reused

- `/auth/login`, `/auth/me`, `/auth/logout`, `/auth/change-password` and existing forgot/reset-password operations.
- `/auth/invitation/inspect`, `/auth/invitation/complete` and `/set-password` Angular screen.
- `GET /settings/organization`, returning only the current organization's display name.
- `GET /employees/:id/income-tax`, `GET /employees/:id/income-tax/:year` and `GET /employees/:id/income-tax/:year/history`, with employee ownership and tenant enforcement.
- `GET /payroll/employees/:id/checks` and `GET /payroll/runs/:period/checks/:id/pdf`, with employee ownership and tenant enforcement.
- Existing EmployeeProfile, EmployeeTax, PayChecks, tax summary/history services, finalized PDF service, centralized EmailService/InvitationMail and NotificationService/PsDialog.

Employee tax mode displays saved data and saved calculations; it does not create profiles or calculate annual TDS. The existing summary service remains unchanged. Existing payroll/tax formulas, salary/CTC/statutory calculations, PDF generation and payment persistence were not edited.

## Authentication, authorization and lifecycle security

Authentication stays within the existing session system. There is no public employee registration and no parallel password/JWT implementation. Admin/user provisioning DTOs still cannot select the employee role; employee accounts must come from the authorized employee invitation flow.

At login and every authenticated employee request the backend validates:

1. Active, nonpending account and current session version.
2. Employee role, valid organization identifier and immutable employee record reference.
3. Employee exists in that organization's tenant collection and is active.
4. Employee email matches the account login email.
5. Authorized lifecycle version matches the current employee lifecycle version.
6. Organization is active.

The global guard denies employee business requests by default, allowing only own-profile/own-tax/own-paycheck/PDF GETs and the organization display-name GET. Existing authentication operations retain their own guards/validation. Employees cannot read employee directories, organization-wide payroll submissions, reports, settings/configuration, other employee records or platform/customer administration. Tax controllers independently retain ownership-aware read checks and administrator-only mutations.

The tenant interceptor continues deriving tenant context from the persisted authenticated account. Account/email collisions do not grant existing administrators an employee identity and do not transfer ownership. Termination/deletion blocks existing sessions; subsequent rehire does not silently restore access. Email changes block access rather than changing account ownership. Explicit administrator disable/enable revokes prior sessions and tokens.

## Invitation and password setup workflow

Send Invite validates eligibility before provisioning. A new account receives a random unknown hashed credential, employee role and pending invitation; pending accounts cannot log in. Resend uses the existing one-minute cooldown and replaces earlier links. Disabled accounts require explicit administrator enablement.

The existing invitation service generates 32 random bytes, stores a SHA-256 token hash, applies `INVITATION_TTL_HOURS` (default 24; supported range 1–168), and sends a fragment-bearing `${FRONTEND_ORIGIN}/set-password#token=...` link through the existing centralized Microsoft Graph service. The employee welcome subject is `Welcome to PayStream – Set Up Your Employee Account`. No passwords or raw tokens are returned through the management API or stored as plaintext.

The existing Set Password screen inspects the link, requests password/confirmation, enforces the existing 8–128 character policy and invokes the existing single-use atomic activation update. Employee linkage/lifecycle/organization validity is checked before activation. Activation removes invitation state and increments session version; the employee then signs in normally. Expired, used, disabled and unavailable invitations are rejected. Delivery failure retains a pending account, invalidates its unusable token and reports failure for administrator retry. Graph acceptance is reported as acceptance, not guaranteed inbox delivery.

## Targeted validation results

Final results across the selected files: **30 backend tests passed, 1 existing opt-in browser test skipped; 78 frontend tests passed**. No final failing tests remain. Initial new-fixture issues were corrected (organization unique name, asynchronous Angular fixture setup and complete tax-status fixture); their focused reruns passed.

Backend selected files:

| File | Final result |
| --- | --- |
| `src/auth/employee-portal.integration.spec.ts` | 8 passed; isolated temporary MongoDB, actual authentication/tenant/controllers, controlled mail mock. |
| `src/auth/invitation-mail.spec.ts` | 2 passed. |
| `src/auth/password-validation.spec.ts` | 3 passed. |
| `src/auth/invitations.integration.spec.ts` | 12 passed; 1 opt-in browser test skipped. |
| `src/auth/password-reset.service.spec.ts` | 1 passed. |
| `src/run-payroll/manual-payment.spec.ts` | 4 passed. |

New integration coverage includes secure account linking/hash storage, activation/single-use tokens, active-account duplication, expiry/resend, invalid email/existing login collision, delivery failure, employee session identity, own profile/TDS/checks/PDFs, peer/foreign record denial, bulk/admin/mutation denial, email/lifecycle/status/organization restrictions, existing password recovery and session revocation. Real mailbox recipients and customer databases were not used.

Frontend selected files:

- `src/app/employees/employee-portal.spec.ts`.
- `src/app/auth/auth.spec.ts`.
- `src/app/auth/password-reset.spec.ts`.
- `src/app/employees/employee-information.spec.ts`.
- `src/app/features/tax-management/employee-tax-workflow.spec.ts`.
- `src/app/shared/notification-interceptor.spec.ts`.
- `src/app/employees/employee-lifecycle.spec.ts`.
- `src/app/employees/employee-list-pilot.spec.ts`.
- `src/app/employees/pay-checks.spec.ts`.

These cover local-time greeting boundaries, employee login/redirects, direct URL rejection, employee-only navigation, secure profile loading/read-only cards, saved tax display without administrative fetches/actions, paycheck/status/PDF controls without Mark as Paid, invitation menu preservation/confirmation and centralized notifications, plus the directly affected existing profile/tax/lifecycle/paycheck/authentication behavior.

Both builds ran once:

- Backend `npm.cmd run build`: passed.
- Frontend `npm.cmd run build`: passed. Warnings: initial bundle 886.69 kB exceeds the 500 kB warning budget but stays below the 1 MB error budget; existing stylesheet files `ps-feature-layout.scss`, `app.css`, `ps-form-field.scss`, `run-payroll.component.css` exceed warning thresholds; jsPDF dependencies emit CommonJS optimization warnings. These styles/dependencies were not changed. No baseline production build was run, so no claim is made that the initial bundle warning is unchanged in size.
- `git diff --check`: passed for both repositories.

## Tests intentionally not run and operational limitations

No complete backend/Angular suite, broad browser regression/E2E automation, payroll calculation comparison suite, unrelated tests or performance tests were run. The existing optional invitation browser test stayed skipped because `RUN_INVITATION_BROWSER` was not enabled. No browser visual/responsive acceptance or native browser PDF rendering/download was exercised; component tests cover the reused controls and backend tests cover PDF authorization/response.

Use the existing Microsoft Graph configuration and a valid externally reachable `FRONTEND_ORIGIN`; production invitation origins require HTTPS and reject loopback hosts. No `.env` file or Graph configuration was changed. Existing organization-less legacy administrator accounts cannot provision employee portal identities: use an organization-bound administrator so employee access has an explicit organization.

Employee email changes and reuse of a departed employee's login email require a separately verified recovery/ownership process; this implementation intentionally blocks automatic transfer. Administrator enable/disable is available through the documented API, without a new management page. Actual Graph delivery and desktop/mobile browser acceptance remain manual validation items. Deployment remains outside this task.
