# Financial-year change workflow repair

## Root cause and why the earlier fix was insufficient

The database already supports one profile per organization, employee and financial year, with a compound unique index. The defect was in transitioning between those profiles, not a missing database association.

In Angular, `confirmYearChange` set the target year and change-session flags, then called `fetch`. When the target already had a profile, `fetch` cleared the change token, return year and change mode, and set editing to false. That dropped the review/save/cancel session immediately. The backend also always returned a new-profile change token scoped to version zero, while updating an existing target requires a version-bound edit token. No such edit permission was supplied by the change-year action. The original year picker additionally started blank, omitted the current year and used the configuration cached when the component first loaded.

The previous follow-up added visibility guidance and Save-validation feedback. It did not repair these state transitions or existing-target permission handling. Its old test even expected cancellation after opening an existing target to stay on the target; that expectation has been corrected to retain the source until explicit Save.

## Corrected workflow

- Change Financial Year opens a dialog with the current year selected and refreshes the list through the existing configuration API.
- Selecting another year retrieves that employee/year's summary and derives the preview regime from the backend's published configuration. Missing or ambiguous published rules show a specific message and prevent confirmation. No regime is chosen manually or copied from the source.
- Confirmation obtains permission and reloads the target summary before changing the visible profile context. A failed target load leaves the source state intact.
- New targets use the existing year-change token. Existing targets additionally receive an edit token bound to the target profile's version, employee, year, organization and actor.
- The target remains in review/edit mode until Save or Cancel. Its own profile, previous-employer facts and calculation snapshot are loaded; a new target starts with empty profile inputs and no source-year calculation.
- Save uses the target-year endpoint with the appropriate permission and optimistic version. Opening an existing year is treated as an explicit pending year change, so Save is available when required data is valid even if the user has not changed a target field. The existing save/versioning rules remain in force.
- Only confirmed persistence followed by a successful summary reload displays the saved success message and returns to read-only mode. Profile discovery already sorts by saved update time, so a full-page reload selects the newly saved target.
- Cancel reloads the original year without writing either profile. Target-load failures do not discard the source context; cancel-load failures retain the target edit permission for retry.

Ordinary Edit keeps the existing financial year visible and locked. Its options come from configured years; the existing available-year list and guidance direct users to Save/Cancel before using Change Financial Year. Ordinary field edits cannot change the employee/year association. Tax regime remains derived and read-only.

## Backend and persistence trace

Configuration is retrieved from `GET /settings/tax-configuration`. Employee/year summary is retrieved from `GET /employees/:id/income-tax/:year`. `POST .../change-year` validates the source profile/version, target financial year and published regime selection. `PUT .../:year` saves through `saveFromEditor` into the organization/employee/year record and retains audit/version checks. There is no fallback that silently saves the source year.

Published revisions remain the authority for valid regime configuration. The existing financial-year active flag continues to govern current payroll eligibility; this fix does not activate years or tax revisions merely to open historical/future profiles.

No schema change, migration, duplicate collection, new endpoint or calculation-engine change was required. The change-year response gains an optional `editToken` for an existing target, retaining its existing response fields. Other years are never overwritten. Calculation queries and snapshots remain year-specific, and saving a profile continues to invalidate calculations through the existing version mechanism.

## Files changed

Backend:

- `src/employee-tax-profile/employee-tax-profile.service.ts`: issue target-version edit permission when the selected year already has a profile.
- `src/employee-tax-profile/employee-tax-workflow.integration.spec.ts`: persisted existing-target save/reload, source/history preservation and production-browser regression.
- This report.

Frontend, in `payroll-frontend`:

- `src/app/features/tax-management/employee-tax.ts`: retain year-change sessions, preview target configuration, refresh options, make loading transactional, and preserve Save/Cancel context.
- `src/app/features/tax-management/employee-tax.html`: current-year default option, backend-derived regime preview, review/confirmation guidance and valid-selection gating.
- `src/app/features/tax-management/employee-tax-workflow.spec.ts`: regressions for new/existing targets, Save/reinitialization, Cancel, unavailable configuration, different regimes, target inputs/calculations and failed loads.

## Verification

- Angular production build passed; existing bundle-budget/CommonJS warnings remain.
- NestJS production build passed.
- Frontend tax tests: 6 files, 107 tests passed.
- Backend income-tax/profile/payroll regression: 10 suites, 84 tests passed; two opt-in browser cases skipped in this broad run.
- A separate run enabled `RUN_TAX_BROWSER_TESTS=1`: all 12 profile workflow tests passed, including the real browser case.
- The browser case served the production Angular output, launched headless Edge, and routed tax/configuration requests to real NestJS APIs backed by an isolated MongoDB database. It clicked Change Financial Year, checked the default/current selection, selected an existing target, confirmed, saved, reloaded the full page, entered ordinary Edit, checked the visible locked year, and exercised Cancel after another year selection.
- Assertions verified that the other year's profile, historical calculation records and finalized payslip PDF remained unchanged.
- HTTP/MongoDB coverage also verifies creating a new year-specific profile, target-year calculation/configuration, most-recently-saved profile discovery, invalid configuration, optimistic permissions and organization isolation. Frontend tests verify a new target saved with its change token remains selected after component reinitialization and retains its own regime and inputs.
- `git diff --check` passed in both repositories.

The browser and persistence checks used isolated test records, not changes to production employees. Supporting ambiguous new-profile regimes still requires configuration review; the application does not invent a regime. Tax rates, salary formulas, proration, prior-employer tax treatment, allocation, payroll integration and historical records were not modified.

No commit or push was made. Existing unrelated local changes were preserved.
