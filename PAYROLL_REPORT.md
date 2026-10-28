# Component-based monthly payroll PDF

Generate Payroll calculates saved active Salary Components instead of using Annual CTC divided by twelve as NET Pay. It now requires configured BASIC, DA and RA percentages; see [MANDATORY_WAGE_COMPONENTS.md](MANDATORY_WAGE_COMPONENTS.md). The earlier requirement for merely one active component is superseded. The Employees button, current-year month picker, API, filename and report metadata are preserved.

## Calculation

For the investigation of DA's missing column and the saved visibility correction, see [DA_PDF_FIX.md](DA_PDF_FIX.md). Component visibility remains driven by the saved Show in Payslip setting.

The existing employee and SalaryComponentService APIs are read afresh for every report. Components resolve their Annual CTC or component-ID base in dependency order. Percentages use the annual base. Fixed annual amounts divide by twelve for monthly display; fixed monthly amounts retain their configured monthly amount and annualize by multiplying by twelve. Missing/inactive bases, cycles, invalid rates, invalid categories, incomplete periods and unsafe amounts reject generation with an error.

Decimal ratios use BigInt arithmetic with half-up rounding to paise. Annual component amounts are rounded to paise before dependent calculations; monthly amounts then round independently. Totals sum monthly paise, matching the displayed component amounts. The report does not infer a balancing allowance or force earnings to equal CTC.

All active components participate in calculations. `showInPayslip` only controls whether an individual component column appears. Hidden earnings/deductions remain in totals and can be dependency bases. Inactive components are excluded.

Earning and deduction categories are summed separately. Supported explicitly configured deduction formulas use the same percentage/fixed calculation rules. NET Pay is configured earnings minus configured deductions and is labelled **provisional**, never verified take-home pay. When deductions exceed earnings, NET Pay displays **Not available** for that employee and the overall net total.

No statutory rules are inferred from component names, codes or the five contribution rates. Statutory settings alone do not define wage bases, eligibility, allocations or exemptions. Unconfigured PF, EPS, ESI, Professional Tax, TDS and other deductions remain uncalculated. Their absence does not imply a verified zero liability. Both the dialog and PDF explain this limitation.

## PDF layout

The embedded font, Indian currency formatting, metadata, repeated table headers, row pagination and page counts remain. The layout is landscape. Up to three visible components appear alongside employee names, Total Monthly Earnings, Total Monthly Deductions and provisional NET Pay. Larger configurations use a summary followed by groups of up to four component columns on separate page sections, with names repeated for each employee. Long headings and values wrap within their columns. Footer totals include all employees and monetary column totals.

## Files changed

In `D:\projects\payroll-frontend`:

- `src/app/payroll/payroll-calculation.ts`: annual component dependency resolver and exact monetary arithmetic.
- `src/app/payroll/payroll-report.service.ts`: existing salary component API integration, dynamic report columns and grouped layout.
- `src/app/payroll/payroll-generator.html` and `payroll-generator.ts`: explanation of provisional pay and errors covering either API.
- `src/app/payroll/payroll-calculation.spec.ts`: component calculation regression tests.
- `e2e/payroll-report.spec.ts`: downloaded PDF parsing, broad configurations and existing workflow checks.

No new dependencies are required. Existing jsPDF, AutoTable, Noto Sans and PDF.js continue to be used. This document supersedes the earlier simplified payroll report description.

## Run and test

Start MongoDB, then `npm.cmd run start:dev` in the backend and `npm.cmd start` in the frontend. Configure active Salary Components in Settings, then generate a report from Employees. A configuration with no active components returns a clear error rather than reverting to CTC divided by twelve.

- Both projects: `npm.cmd run build`.
- Frontend: `npm.cmd test -- --watch=false`.
- Backend integration checks (PowerShell): `$env:RUN_MONGO_TESTS='1'; npm.cmd test -- --runInBand`.
- Browser checks: start `node node_modules/@angular/cli/bin/ng.js serve --host 127.0.0.1` in the frontend; then run `node node_modules/@playwright/test/cli.js test e2e/payroll-report.spec.ts e2e/settings.spec.ts e2e/statutory-deductions.spec.ts`.

Verified: both builds, 12 frontend unit tests, 29 backend tests including MongoDB integration, and five browser tests. Downloaded PDFs cover 85 employees, reverse-ordered BASIC/HRA dependencies, fixed annual/monthly amounts, hidden earnings, explicitly configured deductions, employee counts, rupee values, nine visible components, multiple pages, and rejected missing/circular bases. Settings and Add Employee workflows remain covered. Compact and grouped PDF pages were rendered and visually inspected.

The frontend build retains the existing CommonJS optimization warnings from optional jsPDF HTML-rendering dependencies and completes successfully.
