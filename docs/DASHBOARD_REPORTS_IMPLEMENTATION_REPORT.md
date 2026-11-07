# Dashboard personalization, KPIs, reports and login landing

Implemented 7 November 2026. Existing unrelated work preserved. No staging, commits or pushes.

## Dashboard
The existing greeting retains its local-time boundaries and 30-second refresh, and adds the authenticated user's trimmed firstName plus punctuation when available. Empty/missing names retain the existing greeting alone. Existing typography and layout classes are unchanged.

GET /reports/dashboard aggregates the existing tenant-specific employee collection in MongoDB. It sums stored annualCtc for Active employees, including legacy records with missing/null status under the existing application semantics. Other statuses are excluded. Monthly run rate is that sum divided by 12; empty collections return zero. Values are fetched again when the Dashboard loads or its employee data is refreshed, including after adding an employee. No employee documents are downloaded for these KPIs. The lightweight active employee ID list is returned alongside the summary to preserve the existing Run Payroll link behavior. The existing contractor card and its loading mechanism remain unchanged.

The two cards use the current Dashboard card classes and the shared psInr currency formatter. No organization currency configuration exists in the inspected organization model/settings; reports and KPIs use the existing application INR convention. These are salary commitments, expressly labelled separately from processed/paid payroll.

## Reports navigation and viewing
Reports is added to customer workspace navigation using the existing table icon and active-link styling. The lazy-loaded /reports landing page contains Workforce and Payroll categories. Existing session guards and roles apply: normal business users/admins can view their organization's data; platform-only Super Admin users retain their own portal and cannot read customer reports. The Reports API is protected by the existing global AuthGuard. Tenant-aware business model providers resolve employees and payroll runs to each organization's physical collections; payroll queries additionally constrain organizationId from the server tenant context, never a client-supplied organization.

Total Workforce Report reads existing employee fields only: ID, name, designation, original hire date, status and stored Annual CTC. It supports status and inclusive joining-date filters, deterministic database pagination, and counts for the selected filtered population. Department is not present in the existing model, so no invented field/filter was added. Inactive is supported as a report filter/summary for completeness; the current employee lifecycle model normally uses Active/Terminated. Empty results are handled normally.

Historical Payroll Report lists only periods with Submitted payroll records. It reads the finalized checks in the primary submission and finalized additional submissions, excluding pending drafts and PDF payloads. It never queries today's employee records or invokes salary/tax calculations. Inclusion, names, component amounts, totals and available designation/Annual CTC come from the saved processing snapshot. Checks are deduplicated by employee ID within the selected month under the existing one-finalized-check-per-employee-period rule. The table identifies each processing run and processing date and displays saved components, gross earnings, total deductions, TDS, net pay and payment status. Summary totals are derived from the same deduplicated saved checks; historical employee termination or current CTC changes do not alter the amounts or inclusion. Paid/Pending reflects persisted payment status on the check.

GET /reports/workforce and GET /reports/payroll/:period return paginated rows (50 by default, maximum 100). Payroll checks are projected from the bounded existing monthly aggregate, with PDF fields/pending draft excluded, and then paginated. GET /reports/payroll-periods projects only period/run metadata. Reads do not mutate payroll snapshots.

## PDF export
Reports reuse PayrollReportService's existing font loader and jsPDF/autoTable dependencies via a new exportSnapshot method. PDF export fetches every page for the selected report/filter, exports the exact supplied report columns and saved amounts, and includes summary totals/counts. The visible first page is refreshed to the exported source data. Page/summary inconsistencies encountered during export cause a refresh-and-retry message. Currency formatting uses the same formatInr helper as psInr; dates use PsDatePipe with UTC. No spreadsheet library or Excel exporter exists in the current architecture, so no dependency or synthetic Excel format was introduced.

## Login
safeDestination now falls back to /dashboard when no safe intended destination exists. Fresh login and login after logout therefore land on Dashboard for customer roles. Explicit protected deep links, including an explicit / to Employees, remain honored. Existing temporary-password and Super Admin portal redirects remain unchanged. The current access model has no separate Dashboard permission bit: both business roles can access it; platform-only accounts go to their authorized portal dashboard.

## Files
Backend modified:
- src/app.module.ts
- src/organizations/tenant.interceptor.ts

Backend created:
- src/reports/reports.module.ts
- src/reports/reports.controller.ts
- src/reports/reports.service.ts
- src/reports/reports.controller.spec.ts
- src/reports/reports.service.spec.ts
- docs/DASHBOARD_REPORTS_IMPLEMENTATION_REPORT.md

Frontend modified:
- src/app/app.html
- src/app/app.config.ts
- src/app/auth/auth.ts
- src/app/auth/auth.spec.ts
- src/app/dashboard/dashboard.ts
- src/app/dashboard/dashboard.html
- src/app/dashboard/dashboard.spec.ts
- src/app/payroll/payroll-report.service.ts

Frontend created:
- src/app/reports/reports.ts
- src/app/reports/reports.html
- src/app/reports/reports.css
- src/app/reports/reports.spec.ts

## Focused verification
13 backend tests passed across reports.service.spec.ts (8) and reports.controller.spec.ts (5). Tests cover the July A/B-only example, August excluding B, no current-employee query for historical reporting, finalized additional submissions, duplicate prevention, snapshot Annual CTC and component values, totals, pagination, workforce field projection/filter/date validation, active-only aggregation pipeline/zero/division and refreshed results, organization-scoped finalized periods, physical collection isolation, and existing role/session protections. Authentication tests use the real Nest AuthGuard with a test session stand-in; database reads/aggregation responses are mocked, and collection routing uses disconnected Mongoose models. No live database integration was run.

29 frontend tests passed: Dashboard (10), Reports (3), Auth (16). Covers local greeting boundaries/timer/name fallback, backend KPI consumption without employee population downloads, independent loading/error/retry behavior, processed month selection, snapshot report rendering, workforce filters/pagination, exporting all filtered pages with matching columns/amounts, default Dashboard landing, intentional deep links, existing session behavior and platform-only routing. The final Reports suite was rerun after export/retry refinements and passed all 3 tests.

Backend production build passed on its single run. Frontend production build passed after correcting a missing standalone currency-pipe registration found in the initial compilation attempt. Final build warnings: initial bundle above the warning threshold (877.73 kB, under the 1 MB error threshold), existing component style budgets, and CommonJS dependencies in the existing PDF stack. No application-wide browser automation, unrelated salary calculation comparisons, or broad regression suites were run. Diff whitespace checks passed.

## Limits and deployment
No schema migration, new database configuration or dependency installation is required. Deploy/restart the backend and serve the rebuilt frontend to load the new routes/features. Existing payroll calculations, employee screens, finalized records and processing workflows were not changed.

Older checks may lack designation, Annual CTC or TDS metadata. Those fields remain unavailable; reports do not reconstruct them from current employee records. Missing run identifiers are labelled Legacy submission. PDF export is supported; Excel is not currently supported. Browser visual review and live MongoDB aggregation/export verification remain manual checks. Workforce is a live report; concurrent employee edits across separate export-page requests cannot be treated as a transactional historical workforce snapshot.

Existing shared cards, tables, form fields, select controls, buttons, typography and spacing tokens are reused. The Reports styles are local and token-based. No global design tokens or shared visual components were restyled, and no design-system deviation was introduced.
