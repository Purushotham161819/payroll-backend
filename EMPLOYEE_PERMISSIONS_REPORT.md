# PayStream employee Permissions and access management

Implemented 10 November 2026 in the existing `D:\projects\payroll-backend` and `D:\projects\payroll-frontend` repositories. Earlier uncommitted employee portal/invitation work was preserved. No Signum files were accessed. No staging, commits, pushes, deployment, `.env` edits, customer database mutations or live invitation emails were performed for this task.

## Implementation

The existing Employee Details view now includes **Permissions**, immediately after **Pay Checks**. Administrators see Employee Details → Income Tax / TDS → Pay Checks → Permissions. Regular users retain their existing tax-tab restrictions and see Permissions after Pay Checks. Employee portal users cannot see the new tab, select it through the query parameter, fetch its API, or execute its actions.

The Permissions panel reuses ProfileCard, the approved employee details layout, PsStatusBadge, PsDataTable, PsButton, PsDialog and NotificationService. It contains Employee Account, Access Management and Access History sections. All timestamps use actual stored dates formatted in the browser's local timezone, which is named on the panel. Missing historical timestamps are displayed as Not Available. The existing employee details, tax, paycheck, dashboard and Mark as Paid implementations were not redesigned or recalculated.

### Account and invitation visibility

The API explicitly returns employee name/email, linked login email if different, account status, invitation status, password setup status, account activation, last successful login, access status and available actions. Supported labels include:

- Not Invited.
- Invitation Sent and Invitation Pending.
- Invitation Accepted.
- Password Setup Pending / Completed.
- Account Active.
- Access Revoked and Access Blocked.
- Invitation Expired and Invitation Cancelled.
- Delivery Failed.
- Never Logged In and Not Available.

Invitation acceptance is recorded when password setup and activation successfully commit, not when the invitation page is opened. Acceptance, setup completion and activation therefore share the actual setup-commit timestamp. None of these events records a login. The panel explains that Microsoft Graph acceptance does not prove the recipient received/read the message. A failed initial mail attempt does not populate Invitation Sent On.

Old active accounts without historical login tracking display Not Available rather than falsely claiming Never Logged In. New tracked activations with no successful login display Never Logged In. No account-created/updated date is substituted for missing activation or login history.

### Last Login

The existing login controller records employee login only after credential/organization/employee validation and successful session persistence. An atomic account update sets the latest stored `lastLoginAt` and appends a successful-login event. Failed credentials, revoked access and `/auth/me` session probes do not update Last Login. If login recording fails, the newly saved session is destroyed before returning the failure. Administrator login behavior is unchanged.

### Revoke Access

Authorized employee managers can revoke an existing employee account after confirmation. The existing status API sets `active: false`, increments `sessionVersion`, removes reset/invitation tokens, records the revocation timestamp and appends an audit event. Every protected request revalidates the persisted account/version, so existing sessions immediately lose access. Employee/account/payroll/paycheck history is retained. Revoking a pending account also marks its now-invalid invitation cancelled, with an audit event.

### Restore Access

Only an administrator can restore access. Restoration checks the current active employee record, organization and matching linked email; rehire is explicitly authorized by updating the linked lifecycle version. The same account is retained, session version advances, and any remaining setup/reset links are invalidated. Login/setup/history timestamps are preserved. No email or replacement account is created automatically. A pending account requires a subsequent explicit Resend Invitation. Target-record eligibility failures are reported as conflicts, not as an authentication failure for the administrator.

### Cancel Invitation

Authorized managers can cancel only a pending invitation after confirmation. Cancellation removes its token/hash and expiry, records cancellation, advances session version and appends an audit event. The setup link immediately fails validation. Activated accounts cannot be cancelled. No employee/account/history is deleted.

### Resend Invitation

Authorized managers can resend an enabled account's pending, expired or cancelled invitation after confirmation. This reuses InvitationsService, the existing 32-byte random token/SHA-256 hash workflow, existing expiry configuration and Microsoft Graph email service. The previous link is invalidated; a fresh successful-send timestamp and sent/resent event are recorded. Existing resend cooldown rules remain in force. Activated, revoked, terminated, mismatched-email or unauthorized-lifecycle accounts cannot receive an unnecessary invitation. Sending again creates no duplicate account.

### Access audit

The latest 100 employee account events are stored on the owning AuthUser and displayed newest first:

- Invitation sent/resent/accepted.
- Password setup completed and account activated.
- Successful login.
- Access revoked/restored.
- Invitation cancelled.

Each event contains only `action`, authenticated `actorId` and `at`; the containing immutable account/organization/employee relationship identifies the affected account. Actor names are resolved only within that organization, with the stored ID as fallback. Passwords, token hashes, raw invitation/reset tokens, credentials and session IDs are never included.

Existing platform auditing is a private super-administrator service using `actorId`, `action` and `at`. Those conventions are reused. Employee events are account-owned and updated atomically with lifecycle fields instead of exposing/reworking platform-only audit APIs or requiring multi-document transactions. This is a bounded recent history, not an unlimited audit archive; no historical events are fabricated or backfilled.

## Authorization and APIs

The existing application has role-based employee management rather than a separate fine-grained employee permission matrix. Active organization-bound `admin` and `user` accounts already manage employee records. These roles can view Permissions, revoke, cancel and resend. Only `admin` can restore. Existing initial account creation/conversion through the Employees directory remains administrator-only.

| API | Authorization | Result |
| --- | --- | --- |
| `GET /employee-accounts/:id/permissions` | Admin / existing employee-management user | Sanitized status, stored timestamps, actor-labelled recent audit and allowed-action flags. |
| `PATCH /employee-accounts/:id/status` with `{ "active": false }` | Admin / employee-management user | Immediate revocation and session/token invalidation. |
| Same endpoint with `{ "active": true }` | Admin only | Restore existing eligible employee account without email/account creation. |
| `POST /employee-accounts/:id/invitation/cancel` | Admin / employee-management user | Cancel pending setup link and retain account/history. |
| `POST /employee-accounts/:id/invitation/resend` | Admin / employee-management user | Reuse existing invitation and Graph services for a new pending setup link. |

All `:id` values identify employee MongoDB record IDs. The backend selects the organization from the persisted authenticated actor; callers cannot choose a tenant. Requests must pass existing authentication, CSRF origin/header checks and role rules. Employee management first resolves the employee in that organization's collection, then selects its linked employee account. Other-organization employees return Not Found. Employee roles are denied by the existing global allowlist and the service role checks, including their own permissions/revoke/restore endpoints. Temporary-password accounts cannot manage employee access.

A regular-user or administrator login sharing the employee's email is not silently treated as a linked employee portal account. The previous explicit pending-user conversion flow remains in the directory's Send Invite action. No active account ownership transfer was introduced.

## Database changes

Optional AuthUser fields added:

- `portalInvitationSentAt`: latest invitation accepted by the email service; retained after activation/token cleanup.
- `invitationAcceptedAt`, `passwordSetupAt`, `accountActivatedAt`.
- `lastLoginAt`.
- `invitationCancelledAt`, `accessRevokedAt`, `accessRestoredAt`.
- `portalAudit`: bounded array of `{ action, actorId, at }`, excluded from ordinary model selections.

Existing `active`, `invitationPending`, `invitationDelivery`, hashed tokens, `sessionVersion`, immutable employee/organization references and lifecycle version remain authoritative. No new collection, dependency, environment variable, payroll schema, data migration or index is required. Older values remain absent unless a real event supplies them. Existing known pending invitation timestamps are retained where delivery was recorded as sent.

## Files changed for this task

Backend, relative to `D:\projects\payroll-backend`:

- New `src/auth/employee-account-audit.ts`: bounded event update builder.
- `src/auth/auth.schema.ts`: lifecycle timestamps and private audit array.
- `src/auth/auth.service.ts`: conditional successful employee-login recording.
- `src/auth/auth.controller.ts`: record only after session save; destroy new session on recording failure.
- `src/auth/invitations.service.ts`: retained send/setup/activation timestamps and employee invitation audit events.
- `src/auth/employee-accounts.service.ts`: permissions state, scoped manager authorization, audited revoke/restore, cancel and resend.
- `src/auth/employee-accounts.controller.ts`: permissions/cancel/resend routes; existing status route reused.
- `src/auth/employee-portal.integration.spec.ts`: focused status, tracking, cancellation/resend, revocation/restoration, manager/employee/organization security coverage.
- New `EMPLOYEE_PERMISSIONS_REPORT.md`: this report.

Frontend, relative to `D:\projects\payroll-frontend`:

- New `src/app/employees/employee-permissions-api.ts`: typed Permissions API adapter.
- New `src/app/employees/employee-permissions.ts`: account/action state, confirmations, central notifications and refresh.
- New `src/app/employees/employee-permissions.html`: Employee Account, Access Management and Access History presentation.
- New `src/app/employees/employee-permissions.css`: token-based section spacing/helper text; approved profile layout stylesheet reused.
- New `src/app/employees/employee-permissions.spec.ts`: 13 focused UI/API tests.
- `src/app/employees/profile-tabs.ts`: opt-in Permissions tab after Pay Checks; existing consumers default to hidden.
- `src/app/employees/employee-profile.ts`: authorized query-tab selection and component registration.
- `src/app/employees/employee-profile.html`: authorized tab/panel mounting.
- `src/app/shared/notification-interceptor.ts`: let account actions publish specific centralized feedback without duplicate generic modals.
- `src/app/shared/ui/ps-status-badge.ts`: map the new portal statuses to existing success/amber/danger/neutral tones without changing existing mappings or styling.

No design-system deviations were introduced. No fonts, colors, spacing values, icon libraries, global layouts, existing badge mappings, existing action handlers or approved financial presentations were changed. The new status labels extend the existing central mapping and reuse its styles.

## Focused validation

**28 backend tests passed, 1 existing optional browser test skipped.** Selected files:

- `src/auth/employee-portal.integration.spec.ts`: 15 passed. Includes existing employee/invitation security plus the new status/timestamp/cancel/resend/revoke/restore/manager/organization cases. Uses temporary isolated MongoDB, actual controllers/session guards and controlled email mocks.
- `src/auth/invitations.integration.spec.ts`: 12 passed; 1 optional invitation browser test skipped because `RUN_INVITATION_BROWSER` was not enabled.
- `src/auth/password-reset.service.spec.ts`: 1 passed.

New coverage checks actual activation/send/login dates, successful login timestamp advancement, no advancement on failed login or `/auth/me`, unavailable legacy dates, setup without login, invitation cancellation and old-token invalidation, resend without duplication, expiry display, failed-mail timestamps, revoked credential/session rejection, restoration without email and preservation of history, administrator-only restore, manager revoke/cancel/resend and employee/organization rejection.

**50 frontend tests passed.** Selected files:

- `src/app/employees/employee-permissions.spec.ts`: 13 passed. Account/date/login presentation, confirmation-before-action, duplicate-submit protection, action refresh, restore role restrictions, cancel/resend, specific central notifications, employee exclusion, direct query selection, tab order and API payloads.
- `src/app/employees/employee-portal.spec.ts`: 11 passed; directly affected self-service/tab integration and invitation confirmation behavior.
- `src/app/shared/notification-interceptor.spec.ts`: 4 passed.
- `src/app/shared/ui/ps-status-badge.spec.ts`: 22 passed; existing mappings and unknown-status fallback retained.

Commands used selected `--runTestsByPath` / `--include` files only. Focused reruns followed source changes; no unrelated suites were repeated.

Each application build ran once for this task:

- Backend `npm.cmd run build`: **passed**.
- Frontend `npm.cmd run build`: **passed**. Initial bundle 901.61 kB exceeds the 500 kB warning threshold but remains below the 1 MB failure threshold. Existing unchanged stylesheets (`ps-form-field.scss`, `ps-feature-layout.scss`, `run-payroll.component.css`, `app.css`) emitted warning-budget notices. Existing jsPDF/canvg dependencies emitted CommonJS optimization warnings. No budgets/dependencies were changed to suppress warnings.
- `git diff --check`: **passed** in both repositories.

## Limitations and tests intentionally not run

- Historical send/acceptance/activation/login/audit events that were not stored before this feature remain unavailable. New recording starts with real subsequent events; no timestamp backfill is attempted.
- Recent audit history retains 100 events per employee account. Unlimited archival/audit export is not implemented. Reliable Last Login is stored separately and remains available after older events leave the bounded history.
- Invitation acceptance means successful setup completion in the existing workflow, not link opening. Graph acceptance is not confirmation of inbox receipt, opening or reading. Delivery receipts require additional mail-provider capability/configuration; none was introduced.
- Regular users follow the existing employee-management role boundary; no new fine-grained entitlement model was invented. Initial invitations for unlinked employees continue through the existing administrator directory action.
- Browser visual/mobile/native PDF acceptance and live Graph delivery were not performed. No full backend suite, full Angular suite, broad browser/E2E regression, payroll comparison suite, unrelated regression or performance tests were run.
- Existing Graph/application-origin/session settings are reused. No new configuration is needed for the new tab. No live account state was changed during testing, and no deployment was performed.

The Permissions tab, scoped access actions and future lifecycle/login tracking are implemented. Historical recovery, unlimited audit archival and delivery-receipt tracking remain explicitly outside this implementation.
