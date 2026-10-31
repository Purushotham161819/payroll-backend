# Run Payroll execution investigation and verification

Historical report: the later approved optional TDS policy supersedes the TDS-related blocking behavior described below. Current behavior and verification are documented in [Optional TDS payroll](OPTIONAL-TDS-PAYROLL-FIX.md).

## Root cause

The read-only check of the existing organization's data found EMP001 with finalized October 2026 payroll without a TDS snapshot, and a current enabled New Regime profile for FY 2026–27. November 2026 correctly resolves to that year and its published configuration. `IncomeTaxService.payrollDeduction` rejects a selected employee when submitted payroll in the same tax year has no TDS snapshot or a different tax input hash. The hash includes salary, published revision and profile version. This is the existing Version 1 restriction on mid-year reconciliation, not a failure to fetch the employee or a zero salary calculation.

`RunPayrollService.calculate` previously combined all selected employee calculations with `Promise.all`. One tax exception rejected the complete preview, losing healthy employee calculations too. Angular received an ordinary failed request, kept `run` null, hid the employee table behind its run condition, and rendered missing KPI amounts with `?? 0`. Thus the four displayed zeros were unavailable calculations masquerading as zero payroll.

The restriction is correct for EMP001. Blocking the complete preview and obscuring the affected employee were defects. Historical payroll alone is not a reason to exclude an employee: same-period finalized employees stay locked, while earlier payroll with consistent tax inputs can continue. Enabling TDS after payroll without TDS still requires reconciliation outside Version 1.

## Implemented behavior

Preview mode collects expected employee eligibility, salary and tax business-validation errors, identifies each employee and calculation stage, and retains successful calculations from the established annual engine and TDS service. Unknown infrastructure/programming errors still propagate. Foreign/missing IDs, inactive organization, invalid period and absent statutory settings remain whole-request errors.

The preview endpoint retains HTTP 409 when employee review is required. Its response now includes `code: PAYROLL_EMPLOYEE_REVIEW_REQUIRED` and `payrollPreview`, containing normal preview metadata, successfully calculated checks, and `validationIssues` with employee ID/code, name, stage and reason. Healthy responses and other API contracts are unchanged. No new endpoint or database schema is required.

Angular recognizes only this structured, matching-period conflict. It retains blocked employees in the selected set, displays their rows with Needs Review and the reason, and labels the totals as calculated-employee subtotals. A blocked-only selection or unavailable preview displays unavailable amounts rather than false zero payroll. Failed refreshes clear the unavailable preview. Navigation restoration uses current validation results instead of cached financial amounts for blocked employees.

Save and Submit remain unavailable while review issues exist. Users may explicitly deselect blocked employees and recalculate the remaining selection. The backend does not accept a mixed-selection partial preview hash as a valid-only draft. Save and Submit always run strict calculations and existing version, hash, eligibility, tenant, duplicate, payment-date, idempotency and finalization checks. Partial preview issues are not stored as payroll drafts.

Annual CTC, component formulas, annual-to-monthly derivation, Gross, statutory amounts, TDS liability/allocation, employer contribution treatment and Net Pay equations were not changed. Employee/tax/payroll records in the existing database were not edited. No reconciliation override or hardcoded production tax rules were added.

## Files for this fix

Backend:

- `src/run-payroll/run-payroll.service.ts`: per-employee preview review results and structured blocking response; strict writes preserved.
- `src/run-payroll/run-payroll-review.integration.spec.ts`: isolated MongoDB/API and optional real-browser regressions.
- This report.

Frontend (`D:/projects/payroll-frontend`):

- `src/app/features/run-payroll/models/payroll-run.ts`: validation issue response type.
- `src/app/features/run-payroll/run-payroll.service.ts`: recognize structured partial-preview conflict.
- `src/app/features/run-payroll/run-payroll.component.ts`: preserve selection, issue rows, write guards, unavailable totals and current restore results.
- `src/app/features/run-payroll/run-payroll.component.html`: identified review notices, reasons, subtotal labels and unavailable amounts.
- `src/app/features/run-payroll/unified-payroll.spec.ts`: blocked/mixed selections, explicit deselection and failed API display.
- `src/app/features/run-payroll/run-payroll-review.service.spec.ts`: structured conflict, ordinary conflict and wrong-period handling.

Other changes already present in both workspaces were preserved. Nothing was committed or pushed.

## Verification

The new regression failed before the fix: the HTTP 409 had no employee preview and no healthy checks. It passes after the fix.

| Requested scenario | Verification |
| --- | --- |
| Active employee with no payroll history | Isolated New Regime employee calculates and persists correctly |
| Multiple eligible employees | Mixed TDS-enabled and explicitly disabled employees produce two checks and summed totals |
| Earlier-period historical payroll | Edge December payroll succeeds after the same employee's November TDS submission |
| Earlier payroll without TDS | Named blocking review; mixed preview retains healthy checks; strict save rejects blocked selection |
| New Regime | Real published synthetic test configuration, profile, annual TDS and monthly allocation |
| Old Regime, when configured | Existing real-module income-tax integration suite publishes Old Regime and verifies payroll snapshots/submission |
| TDS applicability No | Existing disabled profile equality checks plus new isolated disabled-TDS payroll check |
| Missing/invalid tax configuration | Missing published regime gives employee-specific reason while another employee remains calculated |
| History warning scope | Compatible earlier TDS payroll proceeds; incompatible history remains blocked |
| Four KPIs | Assertions on monthly CTC, employer contributions, deductions including TDS, and Net Pay |
| Selection changes | Angular component tests and real Edge check mixed, blocked-only, then explicitly valid-only selection |
| Draft save/reopen | Real API persistence and Edge reload, select saved month, restored selection and payment date |
| Submit | Real finalized MongoDB record and successful confirmation page |
| Duplicate finalized employee | Strict backend save rejection and locked historical preview; existing concurrency/idempotency suite |
| Individual PDF | Generated PDF signature verified after API and browser submissions |
| Historical preservation | Original check history and PDF bytes unchanged |

Synthetic review fixture: annual CTC ₹24,00,000, monthly Gross ₹2,00,000, existing configured monthly deduction ₹5,000, TDS ₹24,375, final Net ₹1,70,625. Employer contributions are deliberately zero in this fixture; existing payroll integration tests independently exercise nonzero employer and employee statutory amounts and confirm employer amounts are separate from employee Net. These fixture rules are test data, not production statutory advice or configuration.

All tests write only to isolated test databases; cleanup verifies the exact generated database name and prefix. The Edge test serves the production Angular build, supplies a test identity and employee-directory response from the isolated database, and proxies payroll endpoints to the actual Nest application. It checks uncaught browser errors, real preview conflicts, selection/KPIs, draft persistence, submission and PDFs. It is not a production login or end-to-end authentication test; existing authorization/isolation regressions run separately.

Commands:

Final results: the combined run with MongoDB and Edge enabled passed all 22 backend suites and all 210 tests, including the saved-draft review regression and real browser submission. All 29 Angular test files and 189 tests passed. Both production builds passed. Backend lint passed with existing unrelated warnings. Backend and frontend diff whitespace checks passed.

```powershell
$env:RUN_PAYROLL_MONGO_TESTS='1'
$env:RUN_TAX_MONGO_TESTS='1'
npm.cmd test -- --runInBand src/run-payroll src/income-tax src/tax-configuration src/employee-tax-profile src/payroll-generator
npm.cmd run build

# Optional Windows Edge + sibling production Angular build
$env:RUN_PAYROLL_BROWSER_TESTS='1'
npm.cmd test -- --runInBand src/run-payroll/run-payroll-review.integration.spec.ts

# In D:/projects/payroll-frontend
npm.cmd test -- --watch=false
npm.cmd run build
```

Frontend production build retains the existing initial-bundle warning (approximately 701.5 kB against a 500 kB warning budget) and existing PDF dependency CommonJS warnings. Build succeeds.

## Remaining limitation and operational result

EMP001 cannot finalize November under its current enabled TDS profile because October was finalized without TDS. The UI now explains this instead of implying zero payroll. Review and an approved reconciliation capability are still required; changing history, disabling TDS to evade the guard, or bypassing backend validation is not part of this fix. Healthy employees can be explicitly selected, calculated, saved and submitted without that employee's preview failure losing their results.

No matching configured year or no applicable employee tax profile continues the existing legacy payroll behavior. An enabled profile whose year/regime configuration is incomplete produces a validation issue; this fix does not introduce a new compulsory-profile policy.
