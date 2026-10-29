# PayStream branding and customer organization display

The sidebar retains the P icon, green palette and navigation. Product-facing
labels use **PayStream, An Excelhire Product** in the sidebar, login page, footer,
browser title, User Management description and PDF fallback product label.
Internal payroll identifiers, package names, routes and historical documentation
are unchanged. Report calculations, layout, columns, filenames and optional
existing companyName values are preserved.

## Configure a customer's organization name

The current application is a single-customer deployment with no existing tenant
or organization model. The minimal configuration is an operator-managed backend
environment variable:

```dotenv
ORGANIZATION_NAME=Example Customer Organization
```

Set this in the backend deployment environment or private `.env` file, restart
the backend using the normal deployment process, and refresh the browser. Existing
shell/deployment variables take precedence over `.env`. No Angular rebuild or
header source edit is required. The default when omitted or blank is exactly
`PayStream, An Excelhire Product`. The example configuration documents this
default; the existing private .env was not changed.

Product branding and customer identity are separate. The Angular product label
lives in `src/app/branding.ts`; the authenticated header loads the customer name
through the Organization service from `GET /settings/organization`. Long names
are truncated visually with the full name available in the title tooltip and
accessible label. The existing single Sign out button stays beside the name.

The configuration endpoint uses the existing global authentication guard. It
returns only `{ displayName }`, without account data or other environment
values. Both authenticated roles may read it. No public endpoint or settings
write API was added, so neither ordinary Users nor application Admins can edit
the server configuration through the application. Customer onboarding is an
operator configuration step. No database records, collections or indexes were
added or migrated for this feature.

This is not a multi-tenant implementation: use a separate configuration per
customer deployment. Changes take effect after backend restart/browser refresh,
not as a live pushed update. If optional configuration retrieval fails, the UI
keeps the product/default name and existing 401 session handling still applies.
The service is loaded only by the authenticated workspace, never by the public
login page. PDFs retain their existing optional companyName behavior; only the
fallback product label is rebranded.

## Verification and files

Frontend unit tests cover default/custom names, reloading configuration, safe
failure fallback, full long-name tooltips and the existing logout method.
Browser tests verify default/custom branding, navigation consistency, no overlap
at 1440/800/390/320-pixel widths, a single sign-out button, logout and protected
navigation. Existing employee lifecycle, settings, statutory and annual/monthly
PDF browser regressions were run with their API fixtures. Screenshots are kept
as ignored local artifacts, not source assets.

Backend checks cover environment defaults/changes, authenticated configuration
responses, unauthenticated rejection, ordinary-user reads and rejection of an
attempted settings write. The existing complete route audit now covers 25
protected routes; the public allowlist is unchanged.

Files changed/added for this task:

- Backend: `.env.example`, `src/app.controller.ts`, `src/organization.spec.ts`,
  `test/auth.e2e-spec.ts`, `test/users.e2e-spec.ts`, this guide.
- Frontend: `src/index.html`, `src/app/branding.ts`, `organization.ts`,
  `organization.spec.ts`, `app.ts`, `app.html`, `app.css`, `auth/login.ts`,
  `users/users.ts`, `users/users.html`, `payroll/payroll-report.service.ts`,
  `e2e/branding.spec.ts`, `e2e/authenticated-test.ts`, `e2e/authentication.spec.ts`.

The pre-existing `src/app/shared/delete-confirmation.ts` change was preserved.
No dependencies were added. No commits, pushes, branch changes, real account
changes, private environment edits or payroll data writes were performed.

Actual results: frontend unit/regression tests **75 passed**; selected browser
tests **9 passed**; backend security/end-to-end tests **29 passed**. Backend
unit/regression tests had **226 passed, 4 known pre-existing BASIC/DA fixture
failures, and 14 optional skips**. Both production builds passed (backend output
was isolated in the ignored .tmp directory). Frontend retains existing bundle
budget/CommonJS warning categories. No test failure was hidden by changing
payroll calculations or existing regression fixtures.
