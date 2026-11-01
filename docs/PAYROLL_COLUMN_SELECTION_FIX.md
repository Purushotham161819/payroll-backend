# Payroll report column-selection correction

## Root cause
The dialog's options came only from Salary Components configuration. The report independently rendered twelve aggregate result fields, so ER EPS/EPF/ESI, Gross Wages, Core Wages, Total Allowances, Excess Allowance, and Compliance Wage Base never received selectable metadata and were always rendered.

## Correction
The existing annualColumns mapping now also supplies all optional aggregate checkbox options. No parallel list of report labels was introduced. Stable result:<annual-field-key> IDs distinguish these options from configured component IDs. The same selection state controls Select All, Deselect All and individual checkboxes.

Basic Salary, Dearness Allowance and Retaining Allowance remain checked and disabled. The report mapper also enforces their inclusion independently of checkbox state. Employee Name remains visible as row identification. All other existing monetary report fields, including CTC, are optional. HRA remains sourced dynamically from active Salary Components configuration.

The PDF service partitions the selection: configured component IDs use the existing POST /payroll/annual request and backend validation; result field keys go to the annual/monthly frontend report mapper. This preserves the API contract and complete calculation response. Unknown result keys are rejected. The mapper filters headings, rows and totals with the same field indices, retaining existing order. No backend service or controller edits were needed for this correction.

Annual formulas, dependency resolution, percentages, settings, monthly conversions and rounding are unchanged. Existing PDF formatting, orientation, download workflow and dynamic width handling remain intact.

## Files modified for this correction
In D:/projects/payroll-frontend:
- src/app/payroll/annual-payroll-report.ts: derive aggregate checkbox metadata and apply display selection to headings, values and totals.
- src/app/payroll/monthly-payroll-report.ts: apply the same selection after existing monthly conversion.
- src/app/payroll/payroll-report.service.ts: combine configured components with aggregate options; partition display keys from backend component IDs.
- src/app/payroll/payroll-generator.html: describe the selector as Report columns.
- src/app/payroll/report-columns.spec.ts (new): field coverage, HRA loading, independent selections, required fields, totals and unchanged source data in both report frequencies.
- e2e/dynamic-components-pdf.spec.ts: required checkboxes and aggregate visibility in downloaded annual/monthly PDFs.
In D:/projects/payroll-backend:
- PAYROLL_COLUMN_SELECTION_FIX.md (this document).
Previous task changes remain in place; they were not reset or discarded.

## Actual validation
- Backend production build passed.
- Backend payroll-generator tests: 5 suites / 30 tests passed.
- Full backend src suite: 12 suites passed, 1 failed, 5 skipped; 52 tests passed, 4 failed, 7 skipped. The same four pre-existing failures remain in untouched src/salary-components/salary-calculation.service.spec.ts: fixtures fail mandatory-component validation. Database-dependent suites were skipped under existing conditions.
- Frontend production build passed with PDF-dependency CommonJS optimization warnings.
- Frontend unit tests: 9 files / 31 tests passed.
- Playwright PDF tests: 7 passed, covering existing annual pagination, monthly downloads, mandatory checkbox state, Select All/Deselect All, optional result visibility, totals and page bounds. Browser tests use intercepted API fixtures rather than live MongoDB.
