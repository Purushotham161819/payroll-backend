# Organization Settings

## UI and workflow

Organization Settings is available at `/settings/organization` and linked from the existing Settings navigation for organization admins only. It uses the existing `administrator` route guard; regular users do not see the link and direct navigation redirects away. Super Admin customer-data restrictions remain unchanged.

The Organization Information card shows the exact name from the existing Super Admin-managed organization record. It is a text display, not an editable input, and does not use the deployment-name fallback.

The separate Organization Address card starts with six empty values when no address has been saved. Saving a complete address requires Address Line 1, City, State/region, Country and Zip Code; Address Line 2 is optional. The country selector contains the complete 249-entry ISO 3166-1 inventory from the already installed validator dataset, with English names supplied by `Intl.DisplayNames`. It is not a limited country shortlist and needs no runtime external service. Country names and postal codes are stored as strings.

After Save, fields are read-only and an Edit action appears at the card's top right. Edit exposes Save/Cancel; Cancel restores the last saved address. Loading/saving feedback, existing notification styles, duplicate-submit protection, required-field/length validation and retention of entered values after validation errors are included. The layout uses the existing Settings card, typography, button and responsive-grid conventions.

## Backend, storage and APIs

The existing `PlatformService` and its shared `organizations` collection are reused. No duplicate organization, separate address collection, new organization model or migration was introduced. Super Admin onboarding remains unchanged: records without address fields are read as an empty address until first Save.

The existing organization record gains these fields only when an address is saved:

- `address`: `addressLine1`, `addressLine2`, `city`, `state`, `country`, `zipCode`.
- `addressVersion`: an optimistic concurrency counter, initially treated as zero when absent.
- `addressUpdatedAt` and `addressUpdatedBy`: server-supplied update metadata.

Endpoints:

- `GET /settings/organization-profile`: returns `organizationName`, `addressVersion` and the six address strings.
- `PATCH /settings/organization-profile/address`: accepts those six address fields plus `version`, updates the existing record, and returns the refreshed settings. It never upserts an organization.

Address strings are trimmed, bounded in length and reject embedded control characters. Common punctuation, Unicode letters and postal codes with leading zeros or letters are supported. Missing Address Line 2 defaults to an empty string. A stale address version returns 409 rather than overwriting another admin's update.

## Authorization and isolation

The existing global `AuthGuard` enforces authentication, current sessions, admin role, organization membership, password-change requirements, and existing Origin/custom-header CSRF checks. The new controller is restricted to organization admins using the same guard pattern already used for account administration. Legacy admins without an organization cannot create one by saving an address.

Organization ownership comes exclusively from the persisted authenticated account attached by `AuthGuard`. The new routes have no organization-ID path parameter. Caller-supplied query/header IDs are not used to choose an organization. Body IDs, organization names, subscription properties and other unexpected fields are rejected by the existing strict global validation pipe.

MongoDB updates filter by the trusted organization ID, active status and address version and set only address data and its metadata. Existing IDs, names, status, subscriptions, timestamps managed by Super Admin, and other organization properties are preserved. Existing branding, employee, tax, payroll and PDF integrations were not extended or modified.

## Files

Backend:

- `src/organizations/organization-settings.controller.ts` (new)
- `src/organizations/organization-settings.dto.ts` (new)
- `src/organizations/platform.service.ts`
- `src/auth/auth.guard.ts`
- `src/auth/auth.module.ts`
- `test/platform.e2e-spec.ts`

Frontend in `payroll-frontend`:

- `src/app/settings/organization-settings.ts`, `.html`, `.css`, `.spec.ts` (new)
- `src/app/settings/countries.ts` (new complete country inventory)
- `src/app/app.config.ts`
- `src/app/settings/settings.html`
- `src/app/statutory-deductions/statutory-deductions.html`
- `src/app/features/tax-management/tax-configuration.html`

## Verification

- NestJS production build passed.
- Angular production build passed, with the existing initial-bundle/CommonJS warnings.
- Complete frontend suite: **32 files, 232 tests passed**. The new tests cover dynamic readonly name, empty initial state, full country options, postal string handling, valid form submission, duplicate prevention, reload, Edit/Cancel, error retention, menu visibility and the existing admin route guard.
- Backend auth tests: **3 suites, 14 tests passed**.
- Super Admin/platform end-to-end suite with `RUN_ORGANIZATION_BROWSER_TESTS=1`: **19 tests passed** against isolated MongoDB. It includes existing onboarding, forced-password, account/role management, customer isolation, organization activation and Super Admin recovery tests.
- New API regressions verify initial blank address, persistent Save/update, optional second line, leading-zero/alphanumeric postal codes, version conflicts, rejection of extra privileged fields, CSRF, anonymous/member/Super Admin/legacy-account rejection, forged organization IDs, and independent A/B addresses. The stored record is compared before/after to prove Super Admin-managed fields and organization counts are unchanged.
- Headless Edge exercised the production Angular page with real authenticated test sessions and real NestJS/MongoDB APIs: admin Save, reload, read-only state and Cancel; regular-user Settings-menu exclusion and direct-route denial. The browser proxy reflects only its isolated random-port test origin; production CORS/CSRF settings were not weakened.
- `git diff --check` passed in both repositories.

The existing platform suite intentionally simulates an audit failure to test failed onboarding; its expected server error log is part of that passing test. Earlier browser-proxy CORS diagnostics were resolved in the harness, and no diagnostic logging remains in the new test.

Production organization records were not modified during verification. Prior unrelated and earlier-task working-tree changes were preserved. No commit or push was made.
