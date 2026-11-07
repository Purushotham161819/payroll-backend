# Email implementation report

Date: 5 November 2026 (America/Chicago)

## Completion status

| Area | Result |
|---|---|
| Code | Central Graph provider, existing invitation adapter, Forgot Password/reset and password change notifications implemented |
| Microsoft 365 configuration | Not accessed or changed; existing configuration is user-reported, not independently verified |
| Automated verification | Focused backend/UI tests and builds pass; unrelated organization display tests have two failures described below |
| Real Graph acceptance | Not tested: tenant/client credentials and approved test recipient unavailable |
| Recipient receipt / formatting | Not verified against Microsoft 365 |
| Mailbox-only tenant isolation | Administrator audit and positive/negative authorization tests still required |
| SMTP permission removal | None removed; deferred until actual Graph validation |

## Architecture and files changed in this task

Both repositories contained extensive pre-existing staged/unstaged/untracked invitation and UI work. That work was inspected and retained. Git's total diff includes that earlier work and must not be interpreted as this task's entire change set. No commits, pushes, resets, database migrations or customer data operations were performed.

Backend:

- `src/auth/email.service.ts`: centralized fetch-based OAuth/Graph provider, token coalescing/cache/refresh, multipart MIME encoding and separate reusable security email template function. No extra HTTP dependencies.
- `src/auth/email.service.spec.ts`: controlled HTTP tests; no real credentials or recipients.
- `src/auth/invitation-mail.ts`: existing template retained; SMTP transport replaced with a compatibility adapter to EmailService.
- `src/auth/invitation-mail.spec.ts`: adapter/template regression test replacing obsolete SMTP transport assertions.
- `src/auth/password-reset.service.ts` and `.spec.ts`: bounded asynchronous request queue, generic response, hashed expiring tokens, persisted cooldown, atomic single-use completion, organization eligibility and security notification.
- `src/auth/auth.module.ts`: provider registration.
- `src/auth/auth.controller.ts`: Forgot Password and reset inspect/complete routes with validated DTOs.
- `src/auth/auth.guard.ts`: narrowly permits those public handlers, preserving exact-origin/custom-header CSRF checks.
- `src/auth/http-security.ts`: shared public-reset IP limiter.
- `src/auth/auth.schema.ts`: hidden reset hash, expiry and request timestamp; additive optional fields, no migration.
- `src/auth/auth.service.ts`: password change notification and reset revocation.
- `src/auth/users.service.ts`: administrator password notification; revocation on email, status and password changes.
- `src/organizations/platform.service.ts`: same notification/revocation for existing Super Admin operations. Provisioning, roles, temporary passwords and forced change remain intact.
- `src/auth/invitations.service.ts`: accurate Graph-accepted feedback; existing hashed/single-use invitation workflow retained.
- `src/auth/invitations.integration.spec.ts`: existing invitation integration coverage extended with resets, cooldown, expiry, old-link revocation, organization eligibility, password notifications, API rate limits and CSRF checks. Optional browser assertion updated for accepted wording.
- `.env.example`: documented placeholders only; SMTP example replaced with Graph configuration.
- `docs/EMAIL_INTEGRATION_GUIDE.md` and this report.

Frontend:

- `src/app/app.config.ts`: two public lazy routes, `/forgot-password` and `/reset-password`.
- `src/app/auth/login.ts`, `login.html`: existing styles preserved; Forgot Password link and RouterLink import.
- `src/app/auth/forgot-password.ts`: generic request state, validation, rate-limit/failure guidance using shared components.
- `src/app/auth/set-password.ts`, `set-password.html`: reuse existing password page for resets, secure fragment removal, referrer protection, matching length validations, visibility controls and safe expired/used states.
- `src/app/auth/password-reset.spec.ts`: four focused frontend tests.

No shared styling, fonts or design tokens changed; no design-system deviation introduced. Existing auth CSS and shared controls are reused. No unrelated payroll, PDF, tax, contractor, employee or dashboard feature was changed by this task.

## Email event matrix

| Event | Trigger | Recipient | Required / implementation |
|---|---|---|---|
| User/admin invitation in User Management | Organization admin creates pending user | Created user in actor's organization | Yes: single combined welcome/invitation |
| Invitation resend | Authorized admin requests resend | Existing pending user in same organization | Yes: new token, previous invalidated, 60-second cooldown and persisted attempt timestamp |
| Forgot Password | Public eligible-account request | Active non-pending account; organization must be active | Yes: generic queued HTTP response, 30-minute reset token |
| Password reset completion | Atomic valid reset consumption | Account owner | Yes: one security notice after committed password mutation |
| Signed-in password change | Valid current password and session | Account owner | Yes: security notice, session invalidation, reset revocation |
| Organization admin password change | Authorized existing account password operation | Changed account | Yes: security notice, no plaintext password |
| Super Admin temporary password reset | Existing scoped platform operation | Changed account | Yes: security notice; existing forced-change behavior retained |
| Initial invitation password setup | User finishes invitation | Invited user | No additional welcome/security email: invitation is already the welcome and this is initial setup |
| Platform organization/user provisioning | Existing temporary-password provisioning | New organization admin/user | No new invitation system: existing private delivery/forced-change workflow preserved as requested |
| Account activation/deactivation or role changes | Existing admin operation | Account owner | No new notification requirement existed; preserve product behavior; revoke outstanding reset on deactivation/email change |
| Login/logout, payroll, employee changes | Existing unrelated workflow | N/A | No new email; outside authorized transactional account scope |

## Security and delivery semantics

Sender is enforced as `ps-noreply@excelhire.us`, with configurable display name defaulting to PayStream. Client credentials stay backend-only. Startup validates enabled configuration; local disabling is explicit. `.env` protection was verified with `git check-ignore .env`. No local credentials were edited. Test credentials/IDs are controlled fixtures only.

Tokens use 32 cryptographically random bytes, SHA-256 hashes, expiry, single-use conditional updates and existing database-wide account locks. Reset attempts have a persisted per-account one-minute cooldown and public routes a 10-per-15-minute IP limit. Asynchronous queuing keeps response timing independent of account lookup/Graph latency. Existing global email uniqueness and organization authorization remain intact; no organization IDs appear in links. Password changes revoke sessions and outstanding resets; changing email or deactivating revokes outstanding resets.

Graph request accepted is distinguished from recipient delivery. Existing `invitationDelivery='sent'` and `invitationSent` fields remain for API compatibility and mean accepted, with explicit UI wording. Logs record sanitized attempt IDs and reasons without email addresses, credentials or content. No access/reset/invitation token is logged. No notification failure reverses a successful password change or deletes a user.

Explicit 429 retry is bounded and honors Retry-After; 401 permits one refresh. Permanent errors and ambiguous 5xx/network timeouts are not automatically retried. A sendMail request does not provide exactly-once delivery; Message-ID is correlation only. Templates include plain text and HTML MIME alternatives and retain PayStream invitation styling.

## Verification executed

Commands use `npm.cmd` because this machine's PowerShell policy blocks the npm.ps1 wrapper.

| Check | Result |
|---|---|
| Backend `npm.cmd run build` | Pass (including MIME implementation) |
| Graph provider + invitation adapter | 14 passing tests |
| Existing HTTP security, password validation and account storage tests | 14 passing tests |
| Extended invitations/reset integration (isolated temporary MongoDB) | 12 passing tests, 1 optional browser test skipped |
| Reset queue unit test | 1 passing test |
| `npm.cmd run test:e2e -- --runInBand test/users.e2e-spec.ts` with `EMAIL_ENABLED=false` and mocked invitation delivery | 11 passing tests |
| Frontend invitation + password-reset tests | 7 passing tests across 2 files |
| Frontend production build | Pass; existing bundle-budget/component stylesheet and PDF dependency CommonJS warnings remain |
| `git diff --check` in both repos | Pass; frontend emits normal CRLF normalization notices |
| Additional `src/organization.spec.ts` | 2 failures: synchronous equality checks receive a Promise from unchanged asynchronous organization controller; files untouched by this task |
| Actual Microsoft 365 delivery, mailbox negative send and Outlook rendering | Not run; no tenant credentials/approved recipient |

The broad organization check returned 39 passing, 2 failing and 1 skipped tests before the final extra reset/queue tests were added. It is not an all-green full-suite claim. Full application/browser regression was not run. Existing optional browser test needs a running frontend and `RUN_INVITATION_BROWSER=1`; it was not enabled. No production/customer MongoDB was used for tests.

## Administrator handoff and remaining work

1. Supply actual tenant ID, existing client ID and secret **value** securely in ignored `.env`/secrets manager. No IDs were found to populate tenant-specific commands, so the guide discovers the existing service principals from the actual entered client ID and checks uniqueness.
2. Run the guide's Exchange/Entra audit. Inspect every direct application grant and Exchange scope/assignment. Do not add unrestricted Graph Mail.Send. Use the actual existing principal.
3. Create only missing `PayStream-Mailbox-Scope` and scoped `Application Mail.Send` assignment, using the documented current `New-ManagementRoleAssignment` cmdlet. Confirm sender InScope=True and an actual unrelated mailbox InScope=False, plus absence of additive direct grants.
4. Run an approved end-to-end user invitation/reset test, record 202 acceptance and separately verify actual receipt, sender, HTML/text and links. This task cannot certify Microsoft 365 delivery or isolation.
5. After successful Graph validation, document and remove only obsolete SMTP.SendAsApp/SMTP-only FullAccess and SendAs grants. Remove conflicting Mail.Send under your reviewed tenant change procedure before declaring scoped isolation. No permission has been removed here. Keep the application and service principal. Remove unused nodemailer dependency/private SMTP variables after real validation.

Exact numbered setup/testing/cleanup instructions and PowerShell commands are in `EMAIL_INTEGRATION_GUIDE.md`. The cmdlet correction and additive-grant caution follow [Microsoft's Exchange Application RBAC documentation](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac); 202/MIME semantics follow [Graph sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0).

## Known limits

- This is code-complete for the listed account email flows, not a claim of production tenant readiness; administrator validation is outstanding.
- Forgot Password uses a bounded in-memory queue, not a durable broker. Restart/overload can lose a request; shared account-lock contention logs a generic failure and requires requesting again. No plaintext bearer token is persisted in a queue. Guaranteed asynchronous processing would require an encrypted durable outbox/infrastructure.
- IP rate limiting and token caches are per process. Use gateway/shared rate limits for multi-instance production. Per-account cooldown is stored in MongoDB and shared.
- Notification failures are logged without automatic replay. No delivery receipts/read tracking, durable delivery ledger or exactly-once Graph guarantee is implemented.
- Client-secret authentication is implemented. Certificates/workload identity remain a production hardening option requiring separate key management integration.
- Existing account-wide lock behavior is preserved: a crashed writer can leave a fail-closed lock requiring the established operator recovery process. Never delete locks based on age alone.
- SMTP dependency/tenant permissions remain pending real verification; no runtime SMTP is used. Microsoft 365 administrator powershell commands were documented, not executed.

Final verification: backend build passed; all 7 focused backend suites passed (41 tests, 1 optional browser test skipped). Together with the 11 passing user e2e tests and 7 passing frontend tests, 59 distinct focused tests passed. Both production builds passed. The two unrelated organization display test failures remain documented above.

## Configuration repair follow-up — 5 November 2026

### Confirmed root cause

The service reads process.env directly; the application has no ConfigModule/ConfigService or dotenv loader. main.ts already imports src/environment.ts before AppModule. That loader used loadEnvFile('.env'), resolving against the caller's working directory. Inspection of the actual on-disk D:\projects\payroll-backend\.env showed every email setting missing, as did the process environment. Populated values were in .env.example instead. The backend correctly never loads .env.example; this explains the EMAIL_PROVIDER startup error. A different working directory was an additional genuine loader weakness, not evidence that this particular startup used the wrong directory. No mismatch in variable names or duplicate loaders was found.

The example credentials were removed and restored to empty placeholders. The exposed client secret requires rotation. The private .env was not edited. An approved test recipient was supplied in chat, but that does not configure credentials or establish mailbox authorization.

### Changes made

- src/environment.ts: one project-relative loader shared by startup, existing administrator commands and diagnostics; native parsing and deployment override precedence preserved; missing local file remains optional for deployments; other loader failures report a sanitized error.
- .env.example: correct project-root loading instructions and empty Microsoft credential placeholders.
- src/auth/email.service.ts: preserves provider/credential validation, validates EMAIL_ENABLED values, adds a token-only check using the same coalesced cache, and returns safe numeric Microsoft AADSTS codes with fixed explanations. No raw OAuth error description is logged. Graph 401/403/429 failures have actionable explanations without claiming RBAC validation.
- src/email-diagnostics.ts and package.json: npm.cmd run email:diagnostics; default checks config/OAuth without sending, -- --to supplies explicit send authorization. Uses the same runtime provider without starting Nest or MongoDB.
- src/environment.spec.ts, src/email-diagnostics.spec.ts, src/auth/email.service.spec.ts: focused environment, secret-safety, configuration, OAuth and diagnostic coverage.
- docs/EMAIL_INTEGRATION_GUIDE.md: startup/diagnostic instructions and existing exact scoped RBAC administrator commands retained.

The invitation adapter, invitation/reset token behavior, notification integration, payroll/authentication business behavior and frontend are unchanged in this follow-up. SMTP remains unused; no Microsoft permissions were granted or removed. No commits or pushes were performed.

### Live configuration / tenant status

Both npm.cmd run email:diagnostics and the compiled diagnostic launched from the frontend directory correctly resolved D:\projects\payroll-backend\.env and reported environmentFileLoaded=true. At execution time provider, tenant ID, client ID, secret and sender were missing. Both failed explicitly at configuration validation before any OAuth or send request. This is intentional validation, not a bypass. No actual token acquisition, Graph acceptance, recipient receipt or scoped mailbox authorization can be claimed from these runs. Save the rotated credentials in the private backend .env, rerun the diagnostic, then run the approved --to test. The Exchange administrator audit and positive/negative Test-ServicePrincipalAuthorization commands remain in the guide.

The diagnostic always labels Exchange RBAC as unverified until an administrator provides the scope and direct-grant audit evidence. It cannot infer scoped-only authorization from a token or a single successful send. No new Graph permission is needed for the diagnostic's token check and optional send beyond the existing intended scoped sending authorization.

Follow-up verification results: backend build passed. All six requested focused suites passed: 46 tests passed, one optional browser test skipped. Coverage includes project-relative loading from another working directory, native quote/whitespace parsing, deployment/empty override precedence, missing-file behavior without example fallback, credential placeholder safety, safe diagnostic output, explicit test-send authorization, OAuth AADSTS error redaction, token caching/refresh, Graph status handling, invitation and reset/security-notification integration. No unrelated payroll/TDS/employee/contractor/organization tests or frontend builds were run in this follow-up. git diff --check passed. The final presence-only recheck still found all seven email settings missing in the actual private .env, so live OAuth and the approved-recipient send were not attempted. Startup has not been falsely declared functional with missing credentials.

## Live HTTP 403 investigation follow-up — 5 November 2026

The previously reported HTTP 403 could not be reproduced with current tenant state. The unchanged provider returned HTTP 202 Accepted for the approved test recipient, and the user confirmed receipt with correct sender and formatting. A token-only check verified the exact configured app/tenant, Graph audience, app token type, no delegated scopes, and service principal ae21cf95-77ac-469b-be92-af3e7abd0b9e matching the user's Exchange evidence. Token roles were empty; no broad Mail.Send permission was added. The agent's initial sandbox-only attempt failed at OAuth due to network restrictions; the authorized network-enabled run succeeded. These are distinct from the historical 403.

Safe Graph error details and selected token identity diagnostics were added without changing the working transport, endpoint, private .env or tenant permissions. The historical 403's exact cause remains unproven because the earlier response details were discarded; cache propagation is consistent with, but not established by, the observations. Do not claim a particular permission fix was made. Full evidence, changed files, focused validation and exact read-only administrator scope-isolation commands are in EMAIL_403_INVESTIGATION.md. The remaining unrelated-mailbox negative test and complete additive-grant audit have not been independently performed by the agent.

Final HTTP 403 investigation verification: backend build passed; 50 focused email tests passed, one optional browser test skipped. Live Graph returned HTTP 202 Accepted, and the user independently confirmed receipt with correct sender and formatting. No private configuration or tenant permissions were changed.
