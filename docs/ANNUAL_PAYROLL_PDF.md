# Annual payroll PDF layout

The report reads the validated `calculation.annual` cells from `GET /payroll/annual`. No payroll formulas or settings changed. The selected month identifies the report in its header and filename; all monetary figures remain annual.

Columns, in order: Employee Name, Annual CTC (annualCtc), ER EPS (employerEpsContribution), ER EPF (employerEpfContribution), ER ESI (employerEsiContribution), Gross Wages (annualGrossWages), Basic (annualBasicSalary), DA (annualDearnessAllowance), RA (annualRetainingAllowance), Core Wages (annualCoreWages), Total Allowances (annualTotalAllowances), Excess Allowance (annualExcessAllowance), Compliance Wage Base (annualComplianceWageBase).

The green A4 landscape table has 7 mm side margins, a 31 mm name column, equal right-aligned monetary columns, wrapped headings, and a compact header with report title, payroll month and generated date. Body text is 6.5–7 points depending on monetary width, independent of employee count. Additional employees flow vertically with repeated headers rather than splitting columns across pages. The distinct Total row sums the backend's displayed annual paise using integer arithmetic, then applies the existing INR formatter. Missing or invalid annual cells fail explicitly.

The application currently supplies no company name. The existing Payroll Generator header remains the fallback; the renderer also accepts an optional `companyName` in the response without inventing a company or adding a configuration setting.

Frontend files changed:

- `src/app/payroll/payroll-report.service.ts`: annual PDF renderer.
- `src/app/payroll/annual-payroll-report.ts`: annual cell mapping, validation and totals.
- `src/app/payroll/annual-payroll-report.spec.ts`: mapping and totals tests.
- `src/app/payroll/payroll-generator.html`: annual-report description; existing button/month workflow preserved.
- `e2e/annual-payroll-pdf.spec.ts`: downloaded PDF verification.

Verification: Angular and NestJS builds passed. Angular: 16 tests passed. Backend: 42 tests across 14 suites passed with MongoDB integration enabled. Browser: two PDF tests passed, checking all columns, annual amounts, totals, January header, A4 dimensions, successful download and horizontal text bounds. Twenty representative employees fit on one page; 70 continue onto multiple pages. These representative datasets do not establish a one-page guarantee for arbitrary name lengths or monetary magnitudes. Angular reports existing CommonJS optimization warnings in PDF dependencies.
