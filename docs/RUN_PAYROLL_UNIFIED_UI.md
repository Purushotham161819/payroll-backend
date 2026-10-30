# Unified Run Payroll UI

See [FINAL_PAYROLL_UX.md](FINAL_PAYROLL_UX.md) for the subsequent Monthly CTC, icon actions, contextual navigation and transition changes. Its monthly payroll-cost behavior supersedes the annual presentation below.

Implemented October 30, 2026. Existing modifications and untracked files were preserved. No commits, pushes, branch changes, destructive migrations, new dependencies, or changes to customer records were made. MongoDB tests created and cleaned up their own uniquely named disposable database.

**UI changes**

Run Payroll now has a single employee table with selection, First Name, Last Name, Annual CTC, Employer Contributions, Deductions, NET Pay, Payment Status, and Pay Check columns. The separate historical-payroll table, expandable employee-selection section, and Remove actions are gone. Save and Submit remain below the table.

An accessible back-arrow control replaces the text return link. Employees passes its status filter into Run Payroll, and the arrow restores it from either preview or confirmation. The existing listing has no search or pagination controls to preserve; no unrelated listing functionality was introduced.

Pay Period, Payment Date, and four compact KPI cards share the header. Controls/cards wrap into responsive columns. Monetary values are aligned right in the table. Desktop and 390 px mobile screenshots were inspected; the table scrolls within its container instead of widening the page. The existing employee-profile Pay Checks stylesheet was separated from the compact payroll table styles to retain that screen's presentation.

**Unified table and selection**

Rows merge eligible employees, the current saved/preview selection, and historical checks by employee ID. A historical row takes precedence over current employee data, so it appears once with its original saved names, CTC, payroll amounts, and PDF reference. Historical employees remain visible even if their current employment status has changed.

Only eligible unprocessed employees can be included through Select All. Individual checks update the backend preview with a short debounce. A saved draft restores its selection when its month is reopened, including when the launching employee was previously processed. Unchecking a row updates only the draft selection. An existing empty selection can be saved; it generates no PDF and cannot be submitted.

Unprocessed, unchecked rows show their existing Annual CTC and Not Processed status. Monthly amounts appear after selection and backend calculation; unavailable amounts are shown as a dash. Saved selections show Draft. Historical rows show Submitted / Payment Pending, or the literal Paid status if supplied by the API. Their checkboxes are disabled and explain that finalized payroll cannot be submitted again. When every displayed row is historical, the page explains that the records are read-only and disables Submit.

View Pay Check opens the existing authenticated historical PDF bytes in a modal viewer. Download PDF remains available. Viewing never recalculates or regenerates a payslip. Temporary viewer URLs are released on close or component destruction.

**KPI scope and calculations**

All preview KPIs cover only selected, unprocessed employees in the current draft. Historical rows are excluded. Confirmation KPIs cover that specific successful submission.

| KPI | Source |
|---|---|
| Total Payroll Cost | Decimal-safe sum of selected employees' Annual CTC values from payroll calculation snapshots. This remains annual. |
| Employer Contributions | Existing monthly ER EPF + ER EPS + ER ESI results. |
| Total Employee Deductions | Existing engine deduction totals using the established monthly derivation. |
| Total NET Pay | Existing engine final net-pay results using the established monthly derivation. |

The UI labels the annual/monthly distinction and selection scope. No salary formula, statutory formula, net-pay calculation, or extra annual-to-monthly conversion was added. The existing Ratio helper performs the Annual CTC aggregation. Historical Annual CTC comes from the original annual result or original stored employee calculation inputs, never from today's employee salary. A legacy snapshot without either source displays an unavailable value instead of an invented CTC.

**Payment Date, API, and persistence**

The existing `paymentDate` field now persists on initial drafts and later pending drafts. It is restored on reopening a month. Selection recalculation preserves an unsaved header date; changing months restores that month's saved date or clears the field. Date edits require Save before the UI permits submission. The confirmation dialog displays the saved header date.

`POST /payroll/runs/draft` accepts optional `paymentDate` in `YYYY-MM-DD` format. Explicit null clears it. Older clients that omit the property retain the saved date. Save may keep a draft without a Payment Date; Submit still requires a valid date. Backend validation rejects invalid dates, rollover dates such as February 30, and timestamp strings. A submitted date must match the saved nonempty draft date. The server records Submission Date separately.

Preview and summary responses add `annualCtc` to displayed checks and `totalPayrollCost` at the top level. Preview also supplies `draftSaved` to distinguish stored selections. These display values are derived from existing snapshots and do not rewrite stored check calculations. Existing monetary totals retain their original structure. No new route, collection, index, or data migration was required.

Organization scoping, authenticated PDF routes, backend employee eligibility checks, calculation fingerprint checks, aggregate version checks, employee-period duplicate predicates, and submission idempotency remain in force. Save changes only the current draft; submitting a later batch preserves all earlier payroll snapshots, dates, and PDFs.

**Files changed for this task**

Backend paths are relative to `D:\projects\payroll-backend`:

| File | Change |
|---|---|
| `src/payroll-generator/payroll-run.service.ts` | Snapshot Annual CTC and KPI output, draft date persistence/validation, saved-selection restoration, and submitted date consistency. |
| `src/payroll-generator/payroll-run.schema.ts` | Allows the existing optional draft Payment Date to be explicitly cleared. |
| `src/payroll-generator/payroll-run.integration.spec.ts` | Decimal KPI scope, date save/restore/update/clear, legacy-client compatibility, invalid-date rejection, and historical preservation. |
| `docs/RUN_PAYROLL_UNIFIED_UI.md` | Current report. |
| `docs/RUN_PAYROLL.md`, `docs/PROFILE_PAYROLL_UI.md` | Pointers from earlier reports to the current layout. |

Frontend paths are relative to `D:\projects\payroll-frontend`:

| Files | Change |
|---|---|
| `src/app/payroll/run-payroll.ts`, `.html`, `.css` | Unified rows/selection, header date and KPIs, status handling, back arrow, responsive layout, and stored PDF viewer. |
| `src/app/payroll/run-payroll.service.ts` | Expanded response types and optional date in the existing Save request. |
| `src/app/employees/employee-list.ts` | Passes the existing status-filter context to Run Payroll. |
| `src/app/employees/pay-checks.ts`, `.css` | Retains its original table styling independently of the new payroll layout. |
| `src/app/payroll/unified-payroll.spec.ts` | Five unified-layout, KPI, eligibility/date, status, and PDF-viewer tests. |
| `src/app/payroll/run-payroll.spec.ts`, `payroll-selection.spec.ts` | Existing assertions updated for list context and the unified selection source. |
| `e2e/unified-payroll.spec.ts` | Date/selection restoration across periods, annual/monthly KPI scope, historical rows, Select All, PDF viewing, narrow layout, submission, and back navigation. |
| `e2e/run-payroll.spec.ts`, `profile-payroll-ui.spec.ts` | Existing workflows updated for the single table and header Payment Date, retaining functional assertions. |

The annual/monthly engines, statutory settings/formulas, PDF generator, employee data/lifecycle services, authentication, organization provisioning, and existing indexes were not changed.

**Actual verification results**

| Check | Result |
|---|---|
| Backend production build | Passed. |
| Frontend production build | Passed. The existing initial-bundle and PDF-dependency CommonJS warnings remain; no stylesheet-budget warning remains. |
| Backend payroll feature tests with `RUN_PAYROLL_MONGO_TESTS=1` | All 19 passed: 14 MongoDB/module/HTTP tests, 3 authorization/controller tests, 2 PDF tests. |
| Full backend regression suite with `RUN_PAYROLL_MONGO_TESTS=1` | 253 passed, 4 failed, 14 skipped; 32 suites passed, 1 failed, 7 skipped. |
| Frontend regression suite | All 99 tests passed across 22 files. |
| Headless Edge workflows against the production build | All 4 passed across the existing and unified-payroll browser files. |
| Type-aware lint of changed backend files | Passed without warnings. |
| Git whitespace checks | Passed in both repositories. |

The four backend failures are the same pre-existing failures in unchanged `src/salary-components/salary-calculation.service.spec.ts`. Legacy fixtures conflict with the existing mandatory BASIC/DA/RA configuration validation. That file and its calculation implementation are unchanged from Git HEAD. Other opt-in suites retain their existing skipped status. Tests and formulas were not weakened to hide these failures.

Browser tests use mocked business APIs and valid generated PDF fixtures. Real payroll calculations, draft persistence, date validation, immutable stored PDF bytes, concurrent submission protection, and organization isolation were exercised separately with real MongoDB in the disposable test database. The Paid-label behavior was tested with an explicit Paid API fixture; it was not inferred from a date.

**Remaining boundaries**

- This repository has no payment-confirmation/disbursement service. Its actual submitted records remain Payment Pending. The UI preserves a supplied Paid status but does not introduce a payment-confirmation workflow or infer that money moved from a Payment Date.
- The existing complete-period aggregate has a 12 MiB safety limit, including all PDFs, submissions, and a pending draft.
- Adjustments to already finalized employees remain separate future work. A new submission can process only employees not already finalized for that month.
- Unchecked unprocessed employees are not calculated until selected; their monthly cells show a dash.

**Manual checks**

1. Open Employees, choose All, select Active employees, and click Run Payroll. Confirm the back arrow returns to the same filter and the page has exactly one employee table, no expandable selection panel, and no Remove actions.
2. Choose a month, select employees, enter Payment Date, and Save. Refresh or reopen the month. Confirm the same selection and date return. Change the date, Save, and reopen again. Change to another month and confirm it restores its own date without creating a draft merely from navigation.
3. Check the four KPI cards. Total Payroll Cost must sum selected Annual CTC values; the other cards must match the established monthly report. Select/deselect employees and use Select All. Previously processed employees must remain locked and excluded from these totals.
4. For a month with existing payroll, confirm those employees appear once in the same table with their original Annual CTC, amounts, status, and Pay Check links. Open and download an older PDF. Current salary changes must not change its bytes or historical CTC.
5. Save and Submit a selected unprocessed employee with a valid header date. The confirmation must show the independent Payment Date, server Submission Date, and only the new submission's employees/totals. Reopening the month must not allow those employees to be processed again.
6. At a narrow viewport, confirm the header becomes responsive columns, cards remain readable, and only the table scrolls horizontally. Verify missing PDFs display an error and unauthorized requests remain rejected.
