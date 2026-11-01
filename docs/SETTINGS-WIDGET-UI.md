# Settings widget UI refinements

Implemented the Settings presentation request without backend code, API, schema, tax-engine, formula, validation, or calculation changes.

## Behavior

- One shared Settings heading/navigation puts Organization Settings first for administrators. All four pages use the same separator, spacing, active-tab treatment, and existing access restrictions.
- Organization Information and Organization Address use matching cards in two columns, stacking on smaller screens. Address starts read-only, including first-time setup; Edit enables its existing form, Save uses the existing versioned address PATCH, and Cancel restores saved values. Navigation/unload protect an address draft and pending save.
- **Confirmed scope exception:** the user explicitly chose to preserve the Super Admin restriction on Organization Information. Organization name remains read-only, with its existing explanatory text. No tenant-admin name editor or endpoint was introduced.
- Salary Components use accessible Edit, Activate/Deactivate, and Delete icons with tooltips. Existing handlers, mandatory-component restrictions, modal, confirmation, formulas, and payloads are unchanged.
- Progressive Tax Slabs and Surcharge Thresholds start read-only and have independent Edit/Save/Cancel controls. Numeric inputs, columns, action widths, and mobile spacing are compact. Unlimited upper bounds are identified in read-only mode.
- Table Save reuses `saveSection`, the existing full-rules validation, optimistic configuration version, and immutable unpublished revision API. Other drafts and historical revisions remain intact. Publication remains a separate existing action.
- Cancel confirms changed table drafts and restores that table's entry snapshot. Route changes, page unload, reload, and history-to-editor replacement protect table drafts. Financial-year/regime selectors are disabled while either table is being edited, to keep drafts attached to their original context.
- First configuration creation retains the existing complete-revision workflow; individual-section Save still requires an existing baseline, with the original explanatory feedback.

## Files changed for this request

Frontend paths are relative to `D:/projects/payroll-frontend`:

- `src/app/shared/settings-tabs.ts` (new)
- `src/app/shared/action-icon.ts`
- `src/app/app.config.ts`
- `src/app/settings/settings.ts`
- `src/app/settings/settings.html`
- `src/app/settings/settings.css`
- `src/app/settings/organization-settings.ts`
- `src/app/settings/organization-settings.html`
- `src/app/settings/organization-settings.css`
- `src/app/settings/organization-settings.spec.ts`
- `src/app/statutory-deductions/statutory-deductions.ts`
- `src/app/statutory-deductions/statutory-deductions.html`
- `src/app/features/tax-management/tax-configuration.ts`
- `src/app/features/tax-management/tax-configuration.html`
- `src/app/features/tax-management/tax-configuration.css`
- `src/app/features/tax-management/tax-configuration-sections.spec.ts`
- `e2e/settings-ui.spec.ts` (new)

Backend repository: this report and `docs/README.md` only. Earlier employee/TDS UI changes already present in both working trees were preserved.

## Verification

- Frontend `npm.cmd test -- --watch=false`: **36 files, 268 tests passed**.
- Frontend `npm.cmd run build`: **passed**.
- Backend `npm.cmd run build`: **passed**.
- Backend focused regression: **9 suites passed, 129 tests passed, 2 optional browser tests skipped**. Used `RUN_TAX_MONGO_TESTS=1`, `RUN_PAYROLL_MONGO_TESTS=1`, `--runInBand --testTimeout=30000` for tax revision workflow, tax configuration integration, tax rule validation, employee tax workflow, tax engine, payroll tax, mid-year TDS integration, payroll review integration, and payslip tests. MongoDB fixtures use isolated test databases.
- Production-build Edge browser regression: **5 tests passed** across `settings-ui`, `tds-widgets`, `pay-check-details`, and `run-payroll`.
- Settings browser coverage checks address save/reload/read-only, all four navigation links and exact stable separator geometry, individual tax-table save/reload, unchanged prior revision/publication, unsaved-navigation refusal, no table overflow at 1280px and 390px, salary Edit/Cancel, status PATCH, and confirmed DELETE. Layout checks use reduced motion to avoid measuring the existing page-entry animation mid-frame.
- Tax section unit coverage additionally checks invalid rules, version conflicts retaining edit state, independent cancellation, and retention of unrelated drafts.
- Existing TDS/payroll/browser regression verifies explicit annual calculation, previous-employer inputs, historical snapshots, payroll flow, and unchanged generated payslip PDF bytes.
- Both repositories' `git diff --check`: **passed**.

## Warnings and limits

Production builds succeed with warning-level frontend size budgets (initial bundle and some component styles, including Tax Configuration) and existing PDF-library CommonJS warnings. No build budget thresholds were changed. Browser business APIs are mocked; backend isolated-Mongo integration tests separately exercise the actual configuration and calculation services. Live production data was not modified.

No commits or pushes were made.
