# Organization logos, designation and manual payment

Implemented 6 November 2026. No commits or pushes. Existing unrelated workspace changes preserved.

## Behavior and storage
- Organization Information provides PNG/JPEG upload, saved preview, replacement and removal, with centralized success/error/warning popups. Limits: 2 MB, 16 megapixels; backend verifies image content, format and dimensions.
- Existing storage uses MongoDB-embedded finalized PDF data; no external file/object storage abstraction exists. Logo data is likewise stored as a bounded image data URL on the organization record, with logoUpdatedAt/logoUpdatedBy. No public upload directory or external URLs. Removal sets the logo to null.
- The authenticated administrator's organization ID controls all logo reads/writes. The existing global guard protects Organization Settings; the new storage method additionally checks the persisted administrator's organization and active status. Existing CSRF/session checks remain in effect. A route-specific JSON parser permits the bounded base64 upload.
- Newly finalized PDFs retrieve the active organization logo by organization ID. The logo fits a 110 x 65 point box at the top-right with its original aspect ratio. Missing logos leave a clean layout. Both View and Download use the same stored PDF.
- Employee designation comes from the existing field in the tenant-scoped employee collection at finalization. It is printed directly below the name, at 9 points versus the existing 11.04 point name, with no placeholder when absent. Calculation inputs/hashes and formulas are unchanged.
- Finalized historical PDF bytes remain immutable. Uploading a logo or changing designation affects newly finalized checks only.
- Administrator-only Mark as Paid opens the existing shared dialog with the requested external-payment confirmation. Cancel sends no request. Confirm calls the new POST /payroll/runs/:period/checks/:id/paid endpoint, updates the row after persistence and publishes the centralized success popup.
- Backend writes only the selected embedded check, including checks in additional submissions. Atomic organization/status/check-ID/unpaid predicates prevent duplicate or concurrent transitions. paymentStatus, paidAt and paidBy are persisted on the check. Existing absence of paymentStatus on submitted checks means Payment Pending; paid checks are presented as Paid in all history/submission responses. No bank operation is initiated.

## Changed files
Backend (relative to payroll-backend):
- src/main.ts
- src/organizations/organization-settings.controller.ts
- src/organizations/organization-settings.dto.ts
- src/organizations/platform.service.ts
- src/organizations/organization-logo.ts (new)
- src/organizations/organization-logo.spec.ts (new)
- src/run-payroll/schemas/payroll-run.schema.ts
- src/run-payroll/run-payroll.controller.ts
- src/run-payroll/run-payroll.service.ts
- src/run-payroll/payslip.ts
- src/run-payroll/payslip.spec.ts
- src/run-payroll/manual-payment.spec.ts (new)
- docs/ORGANIZATION_LOGO_MANUAL_PAYMENT_REPORT.md (new)

Frontend (relative to payroll-frontend):
- src/app/settings/organization-settings.ts
- src/app/settings/organization-settings.html
- src/app/settings/organization-settings.css
- src/app/settings/organization-logo.spec.ts (new)
- src/app/employees/pay-checks.ts
- src/app/employees/pay-checks.html
- src/app/employees/pay-checks.css
- src/app/employees/pay-checks.spec.ts
- src/app/features/run-payroll/run-payroll.service.ts

## Focused verification
- Backend manual-payment tests: 4 passed. Covers primary/additional submission atomic update predicates, tenant filter, audit fields, duplicate/concurrent rejection and unauthorized controller access.
- Backend logo tests: 2 passed. Covers supported image validation, spoof/corruption/size rejection, scoped storage and removal, and cross-organization rejection.
- Backend payslip tests: 10 passed. Covers existing PDF presentation plus image embedding/absence and designation. Added position/font assertions verified separately: 1 passed. Initial corrupt PNG fixture was replaced with a generated valid fixture; a coordinate assertion was corrected to the inspector's top-origin coordinates.
- Frontend Pay Checks tests: 4 passed. Covers existing actions and confirmation/cancel/no-request-before-confirm, successful API dispatch, Paid display and action removal. Test DOM native dialog methods are stubbed for the new modal test.
- Frontend Organization Settings tests: 8 passed.
- Frontend logo tests: 3 passed. Covers saved preview, removal and reload, upload/replacement and in-flight preview, and local format/size rejection.
- Backend production build: passed (one run).
- Frontend production build: one run failed on an incorrect shared-dialog barrel import. Import corrected; subsequent focused test bundling passed. Final Angular compiler check (ngc -p tsconfig.app.json --noEmit): passed. Production build was not repeated, respecting the requested one-build limit.

## Limits and design-system notes
No application-wide regression/browser suite or live database end-to-end test was run. Persistence and organization checks were tested using focused storage mocks and atomic query assertions; live reload, permissions and full browser/PDF appearance should receive a focused manual check. No external storage configuration or data migration is required. Reverse proxies must allow the 3 MB request envelope for the logo route.

Existing shared buttons, form fields, dialog, notification service and spacing tokens are reused. No shared component was restyled. Functional/API changes explicitly requested here supersede older UI-only scope restrictions in AGENTS.md; no unrelated redesign or design-token deviation was introduced.

## Follow-up: Run Payroll request parsing fix (6 November 2026)
The route-specific logo JSON parser registered during bootstrap was detected by Nest as an existing application JSON parser, causing Nest to omit the normal parser on unrelated routes. Run Payroll therefore received an undefined body and rejected the missing period as invalid. A real Nest/Supertest bootstrap test reproduced HTTP 400 before the fix. The logo parser is now mounted through a named route-specific wrapper so Nest also installs its normal parser. The 3 MB logo envelope and default 100 KB limit on other JSON routes are preserved.

Files: src/main.ts; new src/organizations/organization-logo-body-parser.ts; new src/organizations/organization-logo-body-parser.spec.ts. Focused HTTP/parser and payroll controller tests: 7 passed, covering preview month/employee parsing, draft/submission bodies, larger logo uploads, normal request limits and existing authorization behavior. No calculation or stored payroll data changes. Restart the backend process to load the corrected bootstrap.
