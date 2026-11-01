# Income Tax/TDS and Run Payroll UI improvements

## Implemented

- Compact Financial Year and derived Tax Regime controls, plus a short two-row review-note textarea. Existing required/max-length validation remains.
- Employment During Current Financial Year is a nested card with aligned radio/checkbox controls, responsive wrapping, and clearly grouped prior-employer fields. Header Edit/Save icons reuse the same profile editor, form, permissions and Save handler. Cancel and financial-year change behavior remain in place.
- Calculate Annual TDS is disabled for a current calculated profile. Valid relevant edits enable it; activating it saves through the existing profile Save workflow first, then explicitly invokes the existing calculation endpoint. Failed validation/save stops calculation. Busy state prevents duplicate requests. Saved stale or uncalculated profiles can be calculated without editing. Opening the tab never calculates.
- History and slab controls are compact icons with accessible names and native title tooltips. Both open dialogs on the current page.
- Both saved-tax summary grids now use the same existing light background, typography, spacing and responsive grid. Displayed calculation values are unchanged.
- Directory first/last name links keep the same color and no underline across normal, visited, hover and active states. Hover feedback, keyboard focus outlines and existing navigation remain.
- Run Payroll uses one warning button immediately before an affected employee's first name. Full warning/status text no longer appears in the row. The button opens complete separate messages in a compact dialog. All employee-specific validation messages are included and duplicates removed. Stale/not-calculated applicable TDS is actionable; optional unconfigured/disabled TDS alone does not generate a warning. Existing review blocking, selection and payroll processing rules are unchanged.

## Dialog behavior and reused components

The shared `ActionIcon` component was extended with history, table, edit, save, warning and close icons, retaining the existing SVG style. No icon dependency was added.

The new `DetailDialog` reuses PayStream's native `<dialog>` convention: modal background, accessible heading, initial Close-button focus, native keyboard focus containment, Escape, close button, backdrop dismissal, background scroll locking and focus restoration to the opener. A sticky header keeps Close available while long content scrolls. It is shared by tax history, slabs and payroll warning details; no alternate API/save mechanism is introduced.

History uses the existing employee/year history API. The table displays recorded date, year, regime, scenario, annual liability, remaining TDS, saved status and a View breakdown action. Missing historical fields are labelled Not recorded. Saved status is explicitly distinguished from the profile's current payroll eligibility. Choosing a history row displays its stored breakdown without rewriting any record.

The slab dialog displays `viewingCalculation.snapshot.result.slabs` and that snapshot's year, regime and configuration version. It never substitutes the latest configuration for an older saved revision. The main breakdown no longer contains the slab table.

Payroll uses a dialog rather than an anchored popover because the application already uses native dialogs and has no reusable message-popover component. Warning messages stay outside the table layout. Multiple validation issues for one employee also receive unique view tracking keys, avoiding duplicate-key rendering warnings.

## Files changed for this UI task

Frontend (`payroll-frontend`):

- `src/app/features/tax-management/employee-tax.html`
- `src/app/features/tax-management/employee-tax.css`
- `src/app/features/tax-management/employee-tax.ts`
- `src/app/features/tax-management/employee-tax-workflow.spec.ts`
- `src/app/features/run-payroll/run-payroll.component.html`
- `src/app/features/run-payroll/run-payroll.component.ts`
- `src/app/features/run-payroll/unified-payroll.spec.ts`
- `src/app/employees/employee-list.css`
- `src/app/shared/action-icon.ts`
- `src/app/shared/detail-dialog.ts` (new)

Backend repository, tests/documentation only for this task:

- `src/employee-tax-profile/employee-tax-workflow.integration.spec.ts`: production-browser dialog, responsive layout, link navigation/style and history-preservation checks.
- `src/run-payroll/run-payroll-review.integration.spec.ts`: warning indicator/dismissal checks and API-authoritative KPI expectations in the existing production-browser workflow.
- This report.

Earlier financial-year repair changes are still pending in the working tree and were preserved. Unrelated auth/startup/organization tests and shared delete-dialog edits were not included in this task's changes.

## Verification

- Angular production build passed. Existing initial-bundle and CommonJS dependency warnings remain; no new component stylesheet budget warning remains in the final build.
- NestJS production build passed.
- Complete frontend suite: **31 files, 224 tests passed**.
- Tax/profile/payroll unit and real MongoDB integration suite with both browser flags enabled: **10 suites, 86 tests passed, none skipped**.
- Headless Edge exercised the production Angular output against isolated real NestJS/MongoDB APIs. Coverage includes history and slab dialogs, Escape/backdrop/Close behavior and focus restoration, a 390px employment-card layout, desktop/mobile screenshots, name-link color/no underline before and after navigation, year-change Save/reload/Edit/Cancel, payroll warning interaction, selection/KPI updates, Save Draft, reload, Submit, and valid PDF output.
- Frontend regressions explicitly cover save-before-calculation sequencing and duplicate prevention, disabling after a current result, historical snapshot slabs despite a different latest configuration, multiple full warning messages outside table cells, and unchanged KPI data after dialog interaction.
- Historical tax records, another year's profile, finalized payroll snapshots and payslip PDFs remain covered by integration assertions.
- `git diff --check` passed in both repositories.

The first enabled payroll-browser run exposed an old fixed net-pay assertion that predated the existing remaining-period TDS allocation behavior. The assertion now compares displayed net pay to the authoritative API fixture; no arithmetic was changed. A browser test-server root-path restriction was also corrected so the employee directory could be exercised. Both workflows pass in the final combined run.

All persistence checks used isolated test databases. No production employee records were changed. Tax formulas, salary formulas, employer/employee contributions, tax configuration, previous-employer treatment, allocation, optional TDS and Run Payroll business logic were not modified for this UI task.

No commit or push was made.
