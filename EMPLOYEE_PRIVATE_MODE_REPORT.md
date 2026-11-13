# PayStream Employee Portal Private Mode

Implemented 10 November 2026 in the existing PayStream backend and frontend repositories. Previous uncommitted employee portal, invitation and Permissions changes were preserved. No Signum access, commits, pushes, deployment, `.env` edits, live verification emails or customer payroll mutations were performed.

## Implementation status

**Fully implemented:** employee-only Private Mode toggle, default-locked sessions, masked profile/paycheck presentation, backend response protection, email OTP request/verify/resend, session-bound temporary grants, manual locking, automatic expiration, protected tax/PDF access, centralized feedback and focused tests.

**Partially implemented:** none of the requested core flows is left partially implemented.

**Pending manual validation:** actual Graph mailbox receipt and real desktop/mobile browser/PDF acceptance. Tests used a controlled email mock and isolated databases; no live code was emailed during implementation.

## UI and protected information

The compact Private Mode switch appears at the top right of Employee Portal → My Profile → Employee Details. It reuses the existing shared switch/form-field/button/dialog patterns, design tokens and icon map. ON includes a Lucide lock glyph. The switch stays ON while requesting or verifying an OTP.

The employee profile displays Annual CTC as `***` while locked. Pay Checks remain visible with pay period, payment date and payment status, while Gross Pay, Employer Contributions, Deductions and Net Pay display `***`. TDS details and PDF controls are unavailable while locked. Existing views refresh after successful verification and close/clear sensitive views when re-locking. Staff profile/paycheck views have no toggle and retain actual financial values under their existing permissions.

The OTP modal includes a masked email address, six-digit text input preserving leading zeros, verification/loading state, code-expiry countdown, resend cooldown, cancellation and centralized success/error/warning notifications. It never displays the complete registered address. Closing the modal cancels the current challenge through the lock endpoint.

No new fonts, spacing/color constants, dependencies or separate notification/email framework were introduced. Existing PsIcon/PsFormField switch styling is reused; the shared icon map gains a standard Lucide lock glyph. A small token-based placement rule aligns the control to the right. Existing financial formatting continues through `psInr` when authorized.

## Backend data protection

The existing global authentication guard still validates the active account, session version, linked employee record, organization, email match and employment lifecycle on every request. The employee allowlist gains only the specific Private Mode endpoints; unlocking grants no administrator or other-employee permissions.

A new employee-only response interceptor checks the current database grant immediately before returning financial responses:

- Locked own-profile responses contain approved non-financial fields only, with `annualCtc: null` and an explicit Private Mode marker. Arbitrary/unrecognized employee fields are not copied into the locked response.
- Locked paycheck history responses use an allowlist of non-financial identity/period/status fields. Gross Pay, employer contributions, deductions, Net Pay and TDS are null; nested financial snapshots, annual/monthly CTC, component data, stored PDF data and PDF URLs are omitted.
- Tax summary/history APIs also require an unlock because their existing snapshots contain Annual CTC and payroll figures. This closes an alternate exposure path. The employee tax panel explains how to unlock instead of fetching protected snapshots while locked. Tax calculations/services remain unchanged.

Query parameters or payload fields such as `privateMode=false` cannot authorize access. Authorization comes exclusively from the active session's server-side grant. Existing no-store response headers remain in place. Interception and additional guards are conditional on the employee role; administrator/authorized-user APIs are not redacted.

## OTP generation, delivery and verification

The existing centralized EmailService and Microsoft Graph integration send the branded security email with subject **PayStream – Your Private Mode Verification Code**. The body includes the employee first name, purpose, six-digit code, expiry and security guidance. No salary/payroll values are included. Existing Graph configuration and sender are unchanged.

Codes use `crypto.randomInt`, a cryptographically random challenge generation value and a purpose/session/account-bound HMAC-SHA-256 digest keyed by the existing SESSION_SECRET. Only the digest is stored; a plain six-digit SHA hash is deliberately avoided because that small keyspace could be enumerated from a leaked database. Immediately replacing a still-pending challenge cannot randomly repeat its prior code. The previous hash is overwritten on resend.

Verification uses constant-time digest comparison, an atomic attempt increment and an atomic hash/generation/expiry match to consume the challenge. Only one concurrent verification can consume it. Locking changes the generation and removes the OTP hash, so an old in-flight verification cannot undo a completed lock. A challenge is verifiable only after successful mail-service acceptance; a failed send clears its hash and grants no access. Codes are not returned by any API or written to application logs/browser storage.

Security controls:

- Default OTP lifetime: **300 seconds**.
- Maximum **5 verification attempts per challenge**; further guesses are rejected/rate-limited.
- **60-second resend cooldown**, shared across the employee's sessions.
- Maximum **5 code-request attempts per account per fixed 15-minute window**, including failed/cooldown attempts.
- Maximum **20 verification requests per account per fixed 15-minute window**, across sessions.
- Invalid, expired, cancelled and already-used codes are rejected. Codes from another employee or another session cannot unlock the current session.
- All endpoints require existing authenticated employee access and existing POST origin/custom-header CSRF checks. No public OTP or employee-registration endpoint was added.

## Temporary authorization and re-locking

Successful verification stores a short-lived grant in the challenge record. Its key is an HMAC of purpose, authenticated account ID and the existing server session ID; its account ID, session version, purpose and expiry must all match. The raw session ID and a reusable browser-side bearer token are not stored in challenge records or returned to the client. The current session is still represented by the existing protected session cookie.

Default grant lifetime is **900 seconds**, capped by the existing authentication session expiry. Every sensitive API checks the current database grant; a stale session copy or manually edited browser state cannot reveal values. Tax responses and PDF sends recheck at completion as well as at the initial guard, protecting requests whose grant expires during processing.

A new login regenerates its session ID through the existing login workflow and has no matching grant, including when the same employee logs in again. Logout destroys the authentication session, making its old grant unusable; expired records are subsequently removed by TTL. Access revocation/session-version changes reject the old session immediately, even if its grant has time remaining. Account restoration does not revive an old session/grant.

The frontend uses in-memory signals only, initially ON. On refresh it can restore OFF only after the server confirms a still-valid grant for that same existing session. It does not persist an unlocked flag, OTP or authorization token in local/session storage. Expiry timing uses server-reported remaining duration and a monotonic deadline; the backend remains authoritative. The UI checks the server every 15 seconds while unlocked, and clears visible authorization before revalidation on focus/pageshow/return to a visible tab. Revocation is immediate at the API; the visible page notices via its next request/poll/return-to-tab check.

Turning ON masks immediately and requests server locking without an OTP. The server invalidates both grant and pending code. Failed network lock requests keep the UI masked, report that server confirmation failed and retry; a network failure cannot be represented as a confirmed server revocation. State-generation checks prevent late responses from restoring cancelled client access. Supported browsers synchronize locked state across tabs through BroadcastChannel; unlocked authorization is never broadcast.

## PDF/download protection

Existing saved payslips contain financial values, so locked employees cannot preview or download them. The existing authenticated PDF API rejects locked employees before reading the document and rechecks the grant before sending bytes. No public/unprotected replacement download URL was added.

When unlocked, the existing stored-PDF workflow is reused unchanged. The employee viewer is closed and its blob URL revoked on re-lock; pending employee downloads check authorization again before creating the download link. Administrator/user PDF behavior and original two-argument download delegation remain unchanged. Saved PDF bytes and PDF generation were not altered. Files already legitimately downloaded while authorized cannot be recalled from the employee's device.

## APIs

| Method/path | Purpose |
| --- | --- |
| `GET /employee-portal/private-mode` | Return server-authoritative ON/OFF status, bounded unlock expiry and server time; no sensitive values or OTPs. |
| `POST /employee-portal/private-mode/request` | Generate/send or resend a new code; return only masked email, expiry/cooldown and feedback. |
| `POST /employee-portal/private-mode/verify` | Accept `{ "code": "six digits" }`; consume once and grant temporary access to the current employee/session only. |
| `POST /employee-portal/private-mode/lock` | Revoke the current session's grant and pending OTP. No OTP required. |

Existing own-profile, own-paycheck and PDF URLs are retained. Tax snapshot URLs are retained and protected by the same grant. Existing administrator and organization isolation rules are unchanged.

## Database and configuration

Two small authentication metadata collections use the existing MongoDB connection:

- `employee_private_mode_challenges`: keyed session/account/purpose identifier, account ID, session version, random generation, keyed OTP hash, OTP expiry, attempt count, mail-acceptance state, grant expiry and purge date. No compensation or raw OTP/session cookie is stored.
- `employee_private_mode_limits`: account-scoped rate-window counts and resend availability/purge times.

Both have a `purgeAt` TTL index created at module initialization. TTL is cleanup only: explicit expiry checks enforce security even before MongoDB deletes an expired record. No employee, AuthUser, payroll, paycheck or tax database schema/migration is needed. Existing financial records are never changed. The frontend Employee response type permits a null Annual CTC for the redacted response; CreateEmployee and backend stored salary validation remain numeric.

Optional deployment variables:

| Variable | Default | Allowed range |
| --- | --- | --- |
| `PRIVATE_MODE_OTP_TTL_SECONDS` | 300 | 60–600 seconds |
| `PRIVATE_MODE_UNLOCK_SECONDS` | 900 | 60–1800 seconds |

Invalid values fail startup. Existing SESSION_SECRET and Graph settings are reused; no configuration edit is required for defaults. The database user needs the normal existing ability to create collections/indexes. No `.env` file was edited.

## Files changed for this task

Backend, relative to `D:\projects\payroll-backend`:

- New `src/auth/private-mode.service.ts`: challenge, mail, rate limits, grants and locking.
- New `src/auth/private-mode.controller.ts`: authenticated endpoints and code DTO.
- New `src/auth/private-mode.interceptor.ts`: allowlisted locked response projection and tax response completion check.
- New `src/auth/private-mode.integration.spec.ts`: eight isolated security integration tests.
- `src/auth/auth.module.ts`: register/export the Private Mode service/controller/interceptor.
- `src/auth/auth.guard.ts`: protect employee tax/PDF access using temporary authorization.
- `src/auth/employee-access.ts`: allow only the new employee-owned Private Mode operations.
- `src/run-payroll/run-payroll.module.ts`: import the existing AuthModule service export.
- `src/run-payroll/run-payroll.controller.ts`: final employee PDF authorization check; no generation/payment logic change.
- `src/auth/employee-portal.integration.spec.ts`: update the existing tax/PDF fixture to obtain an OTP grant before its formerly unrestricted employee financial reads. The complete existing suite was not run for this task.
- New `EMPLOYEE_PRIVATE_MODE_REPORT.md`: this report.

Frontend, relative to `D:\projects\payroll-frontend`:

- New `src/app/employees/private-mode.ts`: ephemeral status/grant timing, locking, retries and cross-tab/focus revalidation.
- New `src/app/employees/private-mode-control.ts` and `.html`: shared switch, OTP modal, countdown and centralized feedback.
- New `src/app/employees/private-mode.spec.ts`: ten focused UI/state tests.
- `src/app/auth/auth.ts`: reset sensitive state for new login/logout/identity expiry and react to backend Private Mode expiry errors.
- `src/app/employees/employee-profile.ts`, `.html`, `.css`: employee-only placement, CTC masking, authorized refresh, tax snapshot gate and stale-response protection.
- `src/app/employees/employee.ts`: nullable Annual CTC in the read response contract only.
- `src/app/employees/pay-checks.ts`, `.html`: employee-only financial/PDF/TDS masking and viewer cleanup while retaining non-financial rows.
- `src/app/features/run-payroll/run-payroll.service.ts`: optional employee download completion guard; staff call signature and workflow retained.
- `src/app/shared/notification-interceptor.ts`: avoid duplicate generic OTP errors; the OTP control publishes specific centralized feedback.
- `src/app/shared/ui/action-icons.ts`: add the lock glyph to the existing icon map.
- `src/app/employees/employee-portal.spec.ts`, `pay-checks.spec.ts`, `employee-permissions.spec.ts`: adapt test providers for the new privacy service/control dependency. The Permissions fixture uses a privacy stub to keep that unrelated suite independent; it was not run for this task.

## Targeted validation

**Backend: 8 tests passed** in `src/auth/private-mode.integration.spec.ts`, using an isolated temporary MongoDB and mocked centralized EmailService. Covered default locking, profile/check redaction, alternate snapshot/PDF blocking, secure code/email/hash behavior, correct verification, invalid/expired/reused codes, resend invalidation, cooldown/guess limits, cross-session/cross-employee denial, temporary expiry, manual lock, new logins/logout, revocation, mail failure and unchanged administrator/user values/PDF access.

**Frontend: 29 tests passed** across selected files:

- `src/app/employees/private-mode.spec.ts`: 10 passed.
- `src/app/employees/employee-portal.spec.ts`: 11 passed.
- `src/app/employees/pay-checks.spec.ts`: 4 passed.
- `src/app/shared/notification-interceptor.spec.ts`: 4 passed.

Coverage includes toggle placement/default, CTC and four paycheck masks, retained period/status, masked-email OTP modal, verify/resend/error notifications, immediate manual mask, automatic expiry, focus/refresh/new-login revalidation, and staff financial/download compatibility. An initial staff download-signature assertion exposed an unintended extra argument; the call was made employee-only and its focused rerun passed. Final selected tests have no failures.

Each build ran once for this task:

- Backend `npm.cmd run build`: **passed**.
- Frontend `npm.cmd run build`: **passed**. Initial bundle is 912.05 kB, above the 500 kB warning threshold and below the 1 MB failure threshold. Existing unchanged shared/form/payroll/app stylesheet budgets and jsPDF/canvg CommonJS dependencies also emitted warnings. No budgets/dependencies were changed to hide warnings.
- `git diff --check`: **passed** for both repositories.

No complete backend/Angular suite, full employee Permissions suite, broad browser regression/E2E run, payroll calculation comparison, unrelated test repetition or performance test was performed. Live Graph delivery and real browser/mobile/PDF interaction remain manual checks. Existing invitation, password setup, payroll/TDS/statutory calculations, administrator dashboard, Permissions functionality, Mark as Paid and bank-integration scope were not changed.
