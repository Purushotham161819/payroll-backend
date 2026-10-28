# Net Pay and custom payroll report column ordering

## Calculation and current business-rule limits
Annual Net Pay = reported annual Gross Wages - sum of reported annual active deduction component amounts. The engine returns annualTotalDeductions and annualNetPay in calculation.annual. It reuses each calculated component once, identified by its stable ID and category. Payslip visibility and report selection do not affect deductions. Earnings, allowances, inactive components and the separately calculated employer EPS/EPF/ESI contributions are excluded from employee deductions. Employee statutory deductions manually configured as active Salary Components with category deduction are included.

All pre-existing equations, exact dependency resolution, component values, rounding, employer contribution calculations and diagnostic verification are unchanged. The new arithmetic follows completed annual reporting values using exact decimal ratios, so displayed Gross Wages minus displayed deductions reconciles to displayed Net Pay. Monthly Net Pay uses annualNetPay / 12 with the existing monthly conversion and paise rounding. Totals sum displayed amounts in paise. Negative net pay remains negative; it is not silently clamped.

The existing configuration has no per-employee deduction assignments or separate employee-specific statutory eligibility mechanism. Active components currently apply to every employee according to their configured formula. This enhancement follows that existing rule. It does not infer employee deductions from legacy statutory settings, names or employer rates, which would invent amounts or risk double-counting. If per-employee eligibility/exemptions are required, that remains a separate business-rule gap.

## Selection and ordering
Net Pay is an optional report column. Basic Salary, Dearness Allowance and Retaining Allowance retain checked/disabled checkboxes. Core Wages remains required in annual and monthly reports, is reorderable, and has no checkbox. Required fields are enforced by the report mapper independently of UI state.

Angular CDK ^22.2.0 supplies drag handles, touch support, drag previews and drop placeholders. Move up/down buttons support keyboard users and announce the resulting position. The ordered ReportComponent array is kept in the dialog's components signal. Moving a row does not modify checkbox selection. Select All/Deselect All change optional selections without changing row order. Each dialog opening reloads configuration and restores the default order, matching the existing selection-reset workflow; order is not persisted across sessions.

The dialog passes a separate ordered list of stable column IDs to PayrollReportService.download/create and then annualReport/monthlyReport. Result IDs use result:<annual-field-key>; optional configured component columns use component IDs. Employee Name stays first, as indicated in the dialog. A single ID-indexed permutation is applied to headers, employee values, columnIds and totals. Selected component IDs continue through the existing backend validation; order is a frontend display preference and does not alter calculations or API persistence. Existing PDF landscape A4 layout, colors, fonts, width fitting and download behavior remain.

## Files created or modified for this enhancement
Backend:
- src/payroll-generator/annual-payroll.ts
- src/payroll-generator/annual-payroll.spec.ts
- src/payroll-generator/net-pay.spec.ts (new)
- NET_PAY_COLUMN_ORDERING.md (this document)
Sibling payroll-frontend:
- package.json and package-lock.json (Angular CDK)
- src/app/payroll/annual-payroll-report.ts
- src/app/payroll/monthly-payroll-report.ts
- src/app/payroll/payroll-report.service.ts
- src/app/payroll/payroll-generator.ts
- src/app/payroll/payroll-generator.html
- src/app/payroll/payroll-generator.css
- src/app/payroll/annual-payroll-report.spec.ts
- src/app/payroll/component-selection.spec.ts
- src/app/payroll/report-columns.spec.ts
- src/app/payroll/payroll-generator.spec.ts
- src/app/payroll/net-pay-ordering.spec.ts (new)
- e2e/annual-payroll-pdf.spec.ts
- e2e/monthly-payroll-pdf.spec.ts
- e2e/dynamic-components-pdf.spec.ts
- e2e/ordered-payroll-pdf.spec.ts (new)
Earlier uncommitted changes are retained.

## Actual validation
- Backend production build: passed.
- Payroll-generator tests: 6 suites / 33 tests passed. Coverage includes employer contributions excluded, active/hidden/dependent employee deductions counted once, inactive deductions excluded, no deductions, paise reconciliation, negative net pay and preservation of previous annual fields.
- Full backend src suite: 14 suites passed, 1 failed, 5 skipped; 64 tests passed, 4 failed, 7 skipped. The same four pre-existing failures remain in untouched salary-components/salary-calculation.service.spec.ts, whose legacy fixtures fail mandatory component validation. Live MongoDB suites remain skipped under existing conditions.
- Frontend production build: passed; existing PDF CommonJS dependency warnings remain. Initial bundle is approximately 481 kB.
- Frontend unit tests: 10 files / 38 tests passed, including duplicate display names, annual/monthly Net Pay, selected/omitted Net Pay, mandatory Core Wages, reversed orders with matching values/totals and unchanged checkbox state.
- Browser PDF tests: all 9 passed. Includes real CDK drag-and-drop, keyboard move button activation, exact selected PDF header order, annual/monthly Net Pay values and totals, mobile width, required checkbox rules, existing pagination, landscape bounds and downloads. Browser tests use intercepted API fixtures rather than a live MongoDB-backed application.
