# Salary Components and Statutory Deductions UI refinement

Salary Components: removed Search calculation bases, its state and text filtering. The existing calculation-base dropdown, active/current-base rules and dependency cycle exclusions remain unchanged. No search-specific CSS existed to remove.

Statutory Deductions: removed EPF/ESI employee inputs and their frontend draft/payload fields. EPF Contributions contains Annual EPF Ceiling Limit, EPF Employer Contribution and EPS Employer Contribution in one three-column row. ESI Contributions contains Annual ESI Wage Ceiling Limit and ESI Employer Contribution in a two-column row below. Both stack below 750px. INR ceiling displays, percentage validation, optional ESI ceiling behavior, Save Settings and Reset Changes are preserved.

Compatibility: existing backend employee fields and their schema remain. DTOs now permit omission of employee percentages while continuing to validate provided values. Updates omit absent employee fields from $set, preserving stored rates; first-time saves initialize absent legacy employee rates to zero using $setOnInsert. Old clients may still submit them, including explicit zero. No existing data is deleted or migrated. Legacy employee contribution service and manually configured Salary Components remain available. No payroll calculation, ceiling, rounding, monthly conversion or PDF code changed in this task.

Files changed for this request:
Backend:
- src/statutory-deductions/statutory-deductions.dto.ts
- src/statutory-deductions/statutory-deductions.service.ts
- src/statutory-deductions/statutory-settings-compatibility.spec.ts (new)
- SETTINGS_UI_REFINEMENT.md (this document)
Sibling payroll-frontend:
- src/app/settings/settings.ts
- src/app/settings/settings.html
- src/app/statutory-deductions/statutory-deductions.ts
- src/app/statutory-deductions/statutory-deductions.html
- src/app/statutory-deductions/statutory-deductions.css
- src/app/statutory-deductions/statutory-deductions.spec.ts
- e2e/settings.spec.ts
- e2e/statutory-deductions.spec.ts
Earlier uncommitted task changes are retained.

Actual validation:
- Backend production build passed.
- Full backend src tests: 13 suites passed, 1 failed, 5 skipped; 61 tests passed, 4 failed, 7 skipped. Four failures remain in the untouched legacy salary-components/salary-calculation.service.spec.ts, whose fixtures fail mandatory-component validation, as before this task.
- Targeted statutory tests: 11 passed, 2 database-dependent tests skipped. Nine new compatibility HTTP tests use an in-memory model stub to verify payload validation, update shape, preservation of hidden values, first-time saves and legacy clients. Live MongoDB persistence was not run.
- Frontend production build passed, with existing PDF dependency CommonJS optimization warnings.
- Frontend unit tests: 9 files / 31 tests passed.
- Browser checks: all 9 relevant scenarios passed (8 in the combined run; corrected salary-component test passed in its rerun). Coverage includes desktop EPF/ESI rows, mobile stacking, hidden input absence, validation/save/reload/reset/errors, employee deduction creation via Salary Components, and seven annual/monthly PDF/download/layout tests. Browser tests use intercepted API fixtures.
