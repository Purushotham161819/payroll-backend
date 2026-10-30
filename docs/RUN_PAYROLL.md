# Run Payroll implementation report

For the current feature locations and module boundaries, see [RUN_PAYROLL_ARCHITECTURE.md](RUN_PAYROLL_ARCHITECTURE.md). The workflow was subsequently relocated out of Payroll Generator with its API and storage contracts preserved.

> Latest Run Payroll layout and draft Payment Date behavior: [Unified Run Payroll UI](RUN_PAYROLL_UNIFIED_UI.md).

> This records the initial implementation. The profile UI and one-submission-per-month behavior were subsequently enhanced. See [Employee Profile and Run Payroll UI enhancements](PROFILE_PAYROLL_UI.md) for the current behavior, changed files, and verification results. The earlier restriction on processing omitted employees after a submission has been superseded by additional immutable submissions for unprocessed employees.

Implemented on October 30, 2026 in the existing backend and frontend repositories. No commits, pushes, branch changes, destructive migrations, or changes to existing customer records were made. Integration tests created and cleaned up their own uniquely named disposable databases.

**Workflow**

Employees now supports selecting Active employees and opening Run Payroll. The preview offers the twelve months of the current year, employee selection editing, recalculation, currency totals, saved drafts, and submission confirmation with an independent Payment Date. Submission produces an immutable summary and individual downloadable payslips. Employee names link to a profile with Employee Details and Pay Checks. The existing editor retains its fields and adds Pay Checks for saved employees.

The existing annual payroll engine remains unchanged. Monthly aggregate cells follow the established monthly report's derivation exactly once. Component amounts use the engine's existing monthly cells. Employer contributions sum monthly ER EPF, ER EPS, and ER ESI. Employee deductions and final net pay come from the engine's annual deduction/net cells using the established monthly conversion. No additional statutory deductions or employer deductions are invented. Totals use the existing exact Ratio arithmetic and preserve the application's two-decimal numeric storage convention.

**Backend files changed or added**

| File | Change |
|---|---|
| `src/app.module.ts` | Registers the independent payroll-run module. |
| `src/payroll-generator/payroll-run.module.ts` | Wires organization-scoped models and the existing calculation/configuration services. |
| `src/payroll-generator/payroll-run.schema.ts` | Period aggregate, embedded individual pay checks, calculation inputs/results, versioning, audit fields, and indexes. |
| `src/payroll-generator/payroll-run.service.ts` | Eligibility, preview, stale-input detection, drafts, finalization, retries, history, and protected PDF retrieval. |
| `src/payroll-generator/payroll-run.controller.ts` | Authenticated API routes using the existing global security rules. |
| `src/payroll-generator/payslip.ts` | Individual PDF layout using saved calculation snapshots. |
| `src/payroll-generator/payroll-run.controller.spec.ts` | Authentication, Super Admin isolation, write-origin protection, and PDF headers. |
| `src/payroll-generator/payroll-run.integration.spec.ts` | Eleven real MongoDB tests, including actual module/API wiring and tenant model isolation. |
| `src/payroll-generator/payslip.spec.ts` | Visibility, monetary snapshot output, component order, wrapping, and multiple pages. |
| `package.json`, `package-lock.json` | Adds the same `jspdf` and `jspdf-autotable` libraries already used by the frontend. |
| `docs/RUN_PAYROLL.md` | This report and manual verification instructions. |

The annual engine, legacy monthly/annual reports, existing statutory formulas, employee lifecycle service, and existing payroll-generator module were preserved.

**Frontend files changed or added**

Paths below are relative to `D:\projects\payroll-frontend`.

| File | Change |
|---|---|
| `src/app/app.config.ts` | Adds preview, submitted-summary, and employee-profile routes. |
| `src/app/employees/employee-list.ts`, `employee-list.html` | Active-only selection, Run Payroll action, and employee profile links. |
| `src/app/employees/employee-form.ts`, `employee-form.html` | Adds profile tabs while preserving the existing form and its values. |
| `src/app/employees/employee-profile.ts` | Dedicated employee profile, existing editor access, lifecycle history, and Pay Checks. |
| `src/app/employees/pay-checks.ts` | Submitted history, monetary columns, and authenticated PDF downloads. |
| `src/app/payroll/run-payroll.service.ts` | API contracts and authenticated PDF download. |
| `src/app/payroll/run-payroll.ts`, `run-payroll.html`, `run-payroll.css` | Preview, selection changes, recalculation, save, native modal confirmation, payment date, and submission summary. |
| `src/app/payroll/run-payroll.spec.ts` | Five workflow and request-contract tests. |
| `e2e/run-payroll.spec.ts` | Complete browser workflow with mocked business APIs, refresh, downloads, and narrow-screen verification. |

Pre-existing changes in backend `src/auth/account-storage.spec.ts`, backend `test/startup-lock.e2e-spec.ts`, and frontend `src/app/shared/delete-confirmation.ts` were preserved and are outside this feature's changes.

**Persistence and indexes**

The new `PayrollRun` model uses `payroll_runs` for existing legacy accounts and the existing tenant-specific collection convention, such as `org000001_payroll_runs`, for organization accounts. Each period document contains the draft or finalized submission, all individual employee Pay Check records, calculation input/result snapshots, summary totals, and finalized PDF bytes encoded as base64.

| Index | Purpose |
|---|---|
| `{ organizationId: 1, period: 1 }`, unique | One authoritative draft/submission per organization and month. |
| `{ organizationId: 1, 'checks.employeeId': 1, status: 1, period: -1 }` | Submitted employee history lookup. |

Indexes are awaited before writes. No existing collection or index is deleted or rebuilt. Periods use `YYYY-MM` together with UTC period-start and period-end dates. Submission time is a server timestamp; Payment Date is a separately validated calendar date.

**Drafts and finalization**

Opening an existing month restores its saved employee selection and monetary snapshot. The service compares a SHA-256 fingerprint of the calculation version, relevant employee inputs, salary components, statutory settings, and organization identity. Changed or invalid inputs flag the draft as stale while retaining the saved amounts. Recalculate / Refresh explicitly updates the preview; Save persists the reviewed results.

Every draft save increments an integer version and records the actor and timestamps. Save requires both the expected version and the fingerprint of the reviewed preview. Concurrent edits return a conflict. Drafts contain no PDFs, have no payment confirmation, and are excluded from employee Pay Checks.

Submit requires a saved version, Payment Date, and idempotency key. The backend validates employee ownership, Active status, employment start/rehire date, Monthly pay frequency, organization state, current inputs, and saved calculation results. It rechecks inputs after PDF generation. The entire submission, including every individual's PDF, commits in one conditional MongoDB update. This atomic aggregate works on standalone MongoDB and replica sets without a multi-document transaction. Generation or persistence failure leaves no partial finalized employee records. An ambiguous network result can be retried with the same key.

The unique period index, duplicate-free employee selection, and Draft/version condition prevent duplicate employee processing for a period. Identical concurrent retries return the winning submission. Other repeated submissions return a conflict. Finalized periods cannot be changed through Save or Recalculate.

Submitted records display **Payment Pending**. A Payment Date does not confirm disbursement; no funds-transfer or unsupported Paid claim is introduced.

**Payslips and authorization**

PDFs contain organization identity, a readable pay period, Payment Date, employee name/ID, earnings, deductions, and summary totals. Department/designation are absent from the current employee schema, so no invented fields are displayed. Components retain their configured order, saved names, and existing monthly calculated values. Only components whose saved `showInPayslip` value is explicitly true appear as component lines. Hidden deductions still contribute to the engine's total deductions/net pay. Employer contributions have a separate summary line.

Long component labels wrap and tables continue onto additional pages. PDFs are generated from the validated saved snapshot and stored with the finalized period. Downloads return these persisted bytes; later salary, component-name, visibility, or statutory changes do not regenerate historical documents.

All endpoints inherit session authentication, write-origin verification, and Super Admin business-data isolation. Existing Admin/User access is preserved. Trusted tenant context selects both employee and payroll models; client-supplied organization IDs, statuses, or monetary values do not determine stored payroll. PDFs use authenticated routes with private/no-store headers and have no public storage URL.

| API | Purpose |
|---|---|
| `POST /payroll/runs/preview` | Restore a saved period, or calculate with `recalculate: true`. |
| `POST /payroll/runs/draft` | Save employee IDs, reviewed input hash, and expected version. |
| `POST /payroll/runs/:period/submit` | Finalize with expected version, Payment Date, and idempotency key. |
| `GET /payroll/runs/:period` | Read an immutable submitted summary, including historical years. |
| `GET /payroll/employees/:id/checks` | Submitted employee history, newest period first. |
| `GET /payroll/runs/:period/checks/:id/pdf` | Retrieve the persisted individual PDF. |

**Verification results**

| Check | Actual result |
|---|---|
| Backend `npm.cmd run build` | Passed. |
| Frontend `npm.cmd run build` | Passed. Initial bundle 658.05 kB; warning above the 500 kB warning budget, below the 1 MB error budget. PDF dependencies also emit CommonJS warnings. |
| All new backend tests with `RUN_PAYROLL_MONGO_TESTS=1` | 16 passed: 11 MongoDB/module/HTTP scenarios, 3 security/controller tests, 2 PDF tests. |
| Full backend `npm.cmd test -- --runInBand` with `RUN_PAYROLL_MONGO_TESTS=1` | 250 passed, 4 failed, 14 skipped; 32 suites passed, 1 failed, 7 skipped. |
| Frontend `npm.cmd test -- --watch=false` | All 86 tests passed across 19 files. |
| Playwright `e2e/run-payroll.spec.ts` in headless Edge against the production build | Passed; business APIs were mocked. Real database finalization and API wiring were tested separately by backend integration tests. |
| Backend `npm.cmd run lint` | Passed with warnings in existing code; a subsequent type-aware lint check of all new backend files passed without warnings. |
| Git diff whitespace checks in both repositories | Passed. |

The four full-suite failures are all in unchanged `src/salary-components/salary-calculation.service.spec.ts`. Its legacy fixtures expect calculations without valid mandatory BASIC/DA/RA configurations, while the existing implementation requires those configurations. Both that test file and its service are unchanged from Git HEAD. Tests and formulas were not weakened to hide the failures. Other opt-in integration tests remain skipped because they require their separate environment flags or existing-account credentials.

Dependency installation reported 11 repository dependency audit findings (8 low, 1 moderate, 2 high). No forced dependency upgrades or audit remediation were performed as part of this feature.

**Known boundaries**

- A single finalized run covers one organization/month. Omitted employees cannot be appended after finalization. Corrections, adjustments, and additional finalization batches are future work.
- The complete submitted document, including base64 PDFs and snapshots, must fit the 12 MiB safety limit. Oversized submissions are rejected before writing and retain their draft. Large organizations may need external PDF storage or a staged multi-document design.
- Expected Payment Date is recorded; bank disbursement, payment confirmation, and a transition to Paid are future work.
- New and editable previews are restricted to the current calendar year. Historical submitted summaries and employee PDFs remain readable.
- Existing monthly rounding is intentionally preserved; aggregate cells follow annual totals while component lines use the engine's monthly component cells.

**Manual verification**

1. Ensure MongoDB is running and use the repositories' existing environment/authentication configuration. In the backend run `npm.cmd run start:dev`; in the frontend run `npm.cmd start`. Open `http://localhost:4200` and sign in with an organization Admin or User account.
2. Ensure statutory settings and the mandatory salary components are configured. Choose Active test employees whose hire/rehire dates precede the selected month end. Use an unused month in the current year.
3. Open Employees. Confirm Run Payroll is disabled without a selection. Switch Employee Status to All and confirm terminated employees cannot be selected. Select two Active employees and click Run Payroll.
4. Confirm all twelve current-year months appear. Select the test month. Compare employer contributions, deductions, and net pay with the existing monthly report; check the totals row and Not Paid statuses.
5. Click Save. Return to Employees, select an employee, and run the same month again. Confirm the saved selection and amounts return. Open Edit employee selection, add/remove an employee, click Recalculate / Refresh, and Save again.
6. To test stale detection, change a selected employee's salary or a statutory/component setting, then reopen the saved month. Confirm the saved amounts remain visible with a stale warning. Explicitly recalculate, review, and Save.
7. Click Submit. Confirm the modal requires Payment Date. Enter a date distinct from today and confirm. Verify Payroll Submitted Successfully, organization, period, independent submission/payment dates, employee count, totals, employee rows, and Payment Pending wording.
8. Refresh the confirmation page. Download each PDF. Verify organization/name/ID, visible component names, employer contributions separately, and summary amounts. A component with Show this component in the employee payslip disabled must be absent as a line item.
9. Click either employee name. Open Pay Checks and download the same period. Also open an employee's existing Edit dialog from Employees and verify its Pay Checks tab while the original Employee Details form remains available.
10. Reopen the finalized month through Run Payroll. Confirm it is read-only and cannot be submitted again. Change current salary/component settings and download the old PDF again; the historical bytes and amounts must remain unchanged.
11. Sign out and back in to confirm persistence. An unauthenticated PDF request must be rejected. A different organization's account must not retrieve the original organization's summary, employee checks, or PDF.

To rerun the new backend tests in PowerShell:

```powershell
$env:RUN_PAYROLL_MONGO_TESTS = '1'
npm.cmd test -- --runInBand src/payroll-generator/payroll-run.controller.spec.ts src/payroll-generator/payroll-run.integration.spec.ts src/payroll-generator/payslip.spec.ts
```

The MongoDB suite uses only its own `payroll_run_test_<pid>_<timestamp>` database and verifies that exact name before cleanup. For the browser test, serve the frontend and run `npx.cmd playwright test e2e/run-payroll.spec.ts` from the frontend repository. `TEST_BASE_URL` can select a different local frontend server.
