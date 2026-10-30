# Employee Profile and Run Payroll UI enhancements

> The Run Payroll layout described here was subsequently consolidated into one table, with header KPIs and draft Payment Date persistence. See [Unified Run Payroll UI](RUN_PAYROLL_UNIFIED_UI.md) for the current layout, API additions, and verification results. The employee-profile enhancements in this report remain applicable.

Implemented October 30, 2026 as an extension of the existing workflow. Existing uncommitted and untracked work was preserved. No commits, pushes, branch changes, destructive migrations, new dependencies, or changes to customer records were made. MongoDB tests used only their own uniquely named disposable database.

**Employee Profile**

The profile and existing employee editor now share a horizontal ribbon with Employee Details, Employment History, and Pay Checks. The active tab has a subtle background and bottom indicator. Tabs expose tablist/tab/tabpanel semantics, selected state, roving focus, Arrow Left/Right and Home/End navigation, and horizontal scrolling on narrow screens.

Employee Details uses a small reusable card component for Employment Information, Compensation Information, Organization Information, and Personal Information. Only existing fields are displayed. No designation, department, employment type, client, or project fields were invented. The existing editing form remains intact; changing tabs does not discard entered form values.

Employment History is a separate tab. Its structured timeline retains original hire date, latest rehire, prior employment periods, termination reasons, explanations, and recorded timestamps where available. Legacy employees without a stored history array still show the original hire date. Existing terminate/rehire actions remain available through the Employees listing.

An accessible SVG back arrow replaces the profile's text return link. Its tooltip and accessible name are Back to Employees. The existing status filter is carried in the profile URL and restored on return, including after refresh. The current Employees listing has no existing search or pagination controls; those were not added or changed.

**View Pay Check**

Every submitted Pay Check now offers View Pay Check and Download PDF. View fetches the existing protected PDF endpoint with the authenticated HttpClient, creates a temporary blob URL, and opens the stored bytes inside a native modal PDF viewer. The viewer also provides a download option. Viewing invokes no preview, calculation, submission, or PDF-generation endpoint.

The viewer uses the selected employee ID and historical pay period. Missing and forbidden PDFs show useful errors. Blob URLs are revoked on close, employee changes, and component destruction. A late response for an employee who is no longer selected is discarded. URL sanitization is limited to the blob URL created from the authenticated PDF response. No runtime placeholder PDF or mock business data is used.

**Run Payroll**

Opening an already submitted month now stays in the normal preview flow, with the Pay Period selector and two distinct groups:

- Current payroll draft contains only unprocessed employees. Its totals come from the existing payroll engine.
- Previously submitted payroll contains read-only historical snapshots. Its checked, disabled controls and Submitted / Payment Pending indicators explain why those employees cannot be processed again. These amounts are excluded from current draft totals.

A selection containing only finalized employees opens as a read-only historical review and creates no draft. A different existing pending draft is preserved. When an eligible unprocessed employee is selected, the normal calculate, Save, and Submit flow becomes available. Existing saved drafts continue to restore their selections and saved amounts.

Preview row checkboxes replace Remove buttons. A header checkbox selects/deselects the displayed draft rows; additional eligible employees can be selected in Edit employee selection. Selection changes are briefly debounced and recalculated by the backend. Unchecked rows remain available for reselection and clearly show Excluded from draft. Save persists the updated selection, including deselecting every employee from an existing draft. Submit requires at least one unprocessed employee and a saved, reviewed calculation. No employee or historical record is deleted when a box is unchecked.

Changing months carries the originally requested employees forward while excluding unrelated historical employees from that selection. A new submission's confirmation page and refresh show that specific submission using its submission ID.

**Persistence, API, and duplicate protection**

The existing organization-scoped `payroll_runs` period aggregate is retained. Optional `pendingDraft` and `additionalSubmissions` fields allow later submissions without replacing the original finalized fields. Existing documents without these fields remain readable; no data migration is required. Calculation amounts, employee/component names, statutory/configuration snapshots, payment dates, and original PDF bytes remain unchanged after finalization. The aggregate's coordination version and update timestamp can advance as later drafts/batches are stored.

Each organization/month still has one unique database period record. Save uses the expected aggregate version. A later submission atomically appends its complete finalized snapshot and PDFs, clears only its pending draft, and advances the version. Database predicates require all submitted employee IDs to be absent from both the original checks and additional submissions. The version condition serializes simultaneous requests; duplicate or overlapping attempts cannot create independent employee-period payroll records. Identical retries return the same winning submission.

Eligibility, current calculations, and saved fingerprints are revalidated for the unprocessed employees. Finalized employees are read from historical snapshots without recalculating their current salaries. Generating a later PDF or persisting a later batch can fail without changing the original payroll or leaving a partial new submission.

The existing unique `{ organizationId: 1, period: 1 }` index and original history index remain. One non-unique history index is added:

```text
{ organizationId: 1, 'additionalSubmissions.checks.employeeId': 1, status: 1, period: -1 }
```

The existing endpoints are reused. Preview responses add `historicalChecks`, `processedEmployeeIds`, and `readOnly`. `GET /payroll/runs/:period` accepts an optional `submissionId` query parameter; without it the original submitted summary remains the default. Existing history and PDF endpoints now find checks in both the original and later submissions. Nested persisted PDF data and pending drafts are stripped from summary responses.

Authentication, origin verification, existing Admin/User permissions, Super Admin business-data restrictions, and organization-scoped model selection are retained. Tests verify that another organization cannot read a later submission or its PDF. Submission still means Payment Pending; no payment confirmation or bank transfer is claimed.

**Files changed for this enhancement**

Backend paths are relative to `D:\projects\payroll-backend`:

| File | Purpose |
|---|---|
| `src/payroll-generator/payroll-run.schema.ts` | Optional pending/later submission fields and additional history index. |
| `src/payroll-generator/payroll-run.service.ts` | Historical previews, unprocessed selections, later drafts/submissions, atomic duplicate checks, and historical retrieval. |
| `src/payroll-generator/payroll-run.controller.ts` | Optional submission ID for summary retrieval. |
| `src/payroll-generator/payroll-run.integration.spec.ts` | Mixed selections, empty saved selections, immutable history, later-batch failures, concurrent retries, summary routing, and tenant isolation. |
| `docs/PROFILE_PAYROLL_UI.md`, `docs/RUN_PAYROLL.md` | Current report and a pointer from the initial implementation report. |

Frontend paths are relative to `D:\projects\payroll-frontend`:

| Files | Purpose |
|---|---|
| `src/app/employees/profile-tabs.ts` | Reusable accessible ribbon. |
| `src/app/employees/profile-card.ts` | Reusable card container. |
| `src/app/employees/employment-history.ts` | Separate structured lifecycle history. |
| `src/app/employees/employee-profile.ts`, `.html`, `.css` | Profile cards, ribbon, back arrow, supported information, and status context. |
| `src/app/employees/employee-form.ts`, `.html` | Shared ribbon/history while preserving the existing editor. |
| `src/app/employees/employee-list.ts`, `.html` | Preserve status-filter context through profile navigation. |
| `src/app/employees/pay-checks.ts`, `.css` | Stored PDF modal, download, loading/errors, and URL cleanup. |
| `src/app/payroll/run-payroll.ts`, `.html`, `.css` | Checkboxes, automatic calculation, historical group, and confirmation behavior. |
| `src/app/payroll/run-payroll.service.ts` | Expanded preview contract, selected-submission lookup, and shared authenticated PDF fetch. |
| `src/app/employees/profile-enhancements.spec.ts` | Ribbon, cards, history, back link, viewer errors, cleanup, and late-response protection. |
| `src/app/payroll/payroll-selection.spec.ts` | Checkbox totals, empty drafts, finalized protection, and month-change selection. |
| `src/app/payroll/run-payroll.spec.ts` | Existing repeated-submit test accounts for pending automatic recalculation. |
| `e2e/profile-payroll-ui.spec.ts` | Profile/editor/PDF/back-navigation and mixed historical/new payroll browser flows. |
| `e2e/run-payroll.spec.ts` | Existing flow updated for checkboxes and tab semantics, retaining its assertions. |

The annual/monthly calculation implementations and PDF generator were not modified. Pre-existing changes in account-storage tests, startup-lock tests, shared delete confirmation, dependency files, and other earlier feature work were preserved.

**Executed verification**

| Check | Actual result |
|---|---|
| Backend production build, `npm.cmd run build` | Passed. |
| Frontend production build, `npm.cmd run build` | Passed; initial bundle 685.83 kB. |
| Backend payroll feature tests with `RUN_PAYROLL_MONGO_TESTS=1` | All 18 passed: 13 real MongoDB/module/HTTP tests, 3 authorization/controller tests, 2 PDF tests. |
| Full backend regression suite with `RUN_PAYROLL_MONGO_TESTS=1` | 252 passed, 4 failed, 14 skipped; 32 suites passed, 1 failed, 7 skipped. |
| Full frontend suite, `npm.cmd test -- --watch=false` | All 94 tests passed across 21 files. |
| Headless Edge, `e2e/run-payroll.spec.ts` and `e2e/profile-payroll-ui.spec.ts` | All 3 passed against the production build. |
| Type-aware lint of changed backend files | Passed without warnings. |
| Git whitespace checks in both repositories | Passed. |

Browser tests mock business APIs and use a valid generated PDF test fixture, verifying that its exact bytes reach the viewer. Real payroll calculation, stored PDF immutability, subsequent submission failures, database concurrency, API wiring, and organization isolation are covered by the isolated MongoDB tests. The mobile profile screenshot was also inspected at 390 px width.

The same four pre-existing failures remain in unchanged `src/salary-components/salary-calculation.service.spec.ts`. Its old fixtures conflict with the existing mandatory BASIC/DA/RA validation. The test file and calculation implementation are unchanged from Git HEAD; no tests or formulas were weakened to mask them. Other opt-in integration suites retain their existing skipped status.

The frontend build retains the existing 500 kB warning budget and CommonJS warnings from PDF dependencies. The bundle remains below its 1 MB error budget.

**Remaining boundaries and manual checks**

The 12 MiB safety limit now applies to the complete month aggregate, including all batches, PDFs, and any pending draft. Actual payment confirmation and adjustments to finalized employees remain future work. The PDF viewer uses the browser's PDF capability; Download PDF remains available.

1. In Employees, choose All or Terminated, open an employee by name, and use the back arrow. Confirm the same status filter returns. Open an Active employee again and inspect all supported information in the cards.
2. Move between Employee Details, Employment History, and Pay Checks with clicks and keyboard arrows. Check older termination/rehire periods. Open Edit employee, change a field without saving, switch to Employment History and back, and confirm the entered value remains.
3. In Pay Checks, click View Pay Check for an older month. Verify the original PDF opens and can be downloaded. Close the viewer and confirm focus returns to the control. Refresh and open the same check again.
4. Submit a test employee for an unused current-year month. Run that month again for the same employee: normal preview should show a historical snapshot, zero new-processing totals, and no enabled Submit action.
5. Run the same month for that employee plus an unprocessed Active employee. Confirm the historical checkbox is disabled, the new employee is selectable, and draft totals include only the new employee.
6. Save the new draft, uncheck the new employee, wait for zero totals, Save, and reopen. Confirm the empty selection persists and historical payroll remains. Add the employee again, wait for recalculation, Save, and submit with a Payment Date.
7. Refresh the later submission's confirmation page. Confirm it shows only that new submission. Both employees should now have one Pay Check for the month, each with their original payment date and PDF. Reopening the month must show both as historical and prevent duplicate processing.
8. Repeat at a narrow viewport. Confirm cards stack, the ribbon can scroll horizontally, and payroll/PDF tables do not widen the whole page. Verify an unauthenticated or other-organization account cannot fetch the stored PDF.
