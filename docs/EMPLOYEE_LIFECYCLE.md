# Employee lifecycle enhancement

Employees now have an accessible row actions menu with Edit, Delete, Employment history, and either Terminate or Rehire. Angular CDK renders the menu in an overlay, supports keyboard navigation and Escape, and dismisses it on outside clicks and action selection. Existing Edit and permanent Delete behavior is retained.

The Employee Status dropdown defaults to Active and offers All, Active, and Terminated. Filtering happens once in the frontend over the existing complete employee response. Counts and row selection follow the filtered records; changing the filter clears selection, and refresh preserves the filter. The existing directory has no search, sorting, or pagination controls to integrate.

## Lifecycle rules

- Status values are `Active` and `Terminated`. MongoDB schema defaults new and legacy hydrated records to Active. Reads do not migrate legacy records.
- Termination Date is required and defaults to today in America/Chicago. It must be a real calendar date on or after the current employment period's start date, and on or before today. The employee becomes Terminated when confirmation succeeds; the selected termination date is the period's inclusive end date.
- Required reasons: Voluntary Resignation, Involuntary Termination, Layoff / Reduction in Force, End of Contract, Retirement, Job Abandonment, Other. Other permits an optional explanation of up to 250 characters. Explanations for other reasons are not stored.
- Rehire Date must be after the previous termination date and on or before today. Rehire changes the same employee record to Active and appends an employment period.
- Future termination and rehire dates are rejected by both the UI and backend. There is no scheduler or pending lifecycle status; users confirm on the effective date.
- Rehire preserves MongoDB ID, human Employee ID, original hireDate, pay frequency, salary components, annual CTC, and statutory settings. `rehireDate` records the most recent rehire separately.
- `employmentHistory` stores each period's startDate, optional endDate, terminationReason, optional explanation, recordedAt, and terminatedAt. Period status derives from whether endDate exists. On the first lifecycle action, legacy history is initialized from the original hireDate. Subsequent cycles retain all periods. History is available in the row menu.
- Original hire date remains editable before lifecycle history exists. Afterward, normal edits may retain that date but cannot change it. Other employee edits remain available.
- A single MongoDB compare-and-swap update writes status, complete preserved history, latest rehire date when applicable, and incremented lifecycleVersion. It checks the previously read version and hire date. Concurrent or repeated lifecycle submissions return HTTP 409. No payroll collection is written by lifecycle actions.
- Recorded timestamps provide event traceability. The application has no existing authenticated actor audit facility, so actor attribution is not introduced.

## APIs

Existing create, edit, delete, and list routes remain available. Employee responses add the lifecycle fields above.

`PATCH /employees/:id/terminate`

```json
{"terminationDate":"2026-10-01","reason":"Retirement"}
```

For Other, optionally add `"explanation":"End of assignment"`.

`PATCH /employees/:id/rehire`

```json
{"rehireDate":"2026-10-02"}
```

Both endpoints use the MongoDB ID and return the updated employee in the existing direct response format. Malformed IDs, dates, reasons, or period conflicts return 400; missing employees return 404; invalid status transitions or concurrent changes return 409; database failures return a safe 503. Global validation rejects unknown payload fields.

## Payroll and historical data

As approved, new annual and monthly reports exclude currently terminated employees by default. The Generate Payroll dialog offers an unchecked “Include terminated employees for historical projections” checkbox. GET `/payroll/annual?includeTerminated=true` or POST `/payroll/annual` with a boolean `includeTerminated: true` explicitly includes them. The flag is validated on both routes. Rehired employees become eligible again.

Salary formulas, statutory calculations, rounding, annual/monthly conversion, and PDF rendering are unchanged. Lifecycle changes do not delete or modify payroll history, timesheets, previously generated reports, or downloaded PDFs. This app calculates reports from current employee/settings data; it does not maintain immutable payroll snapshots or prorate calculations across employment periods. Historical inclusion is a recalculated salary projection, not a reconstruction of prior paid payroll. The dialog explains that limitation. Existing permanent Delete remains a separate, explicitly confirmed action.

## Database deployment

No migration, bulk update, or new index is required. Schema defaults cover legacy reads; a lifecycle operation initializes history and persists the employee's lifecycle state. No production records were terminated, rehired, or migrated during verification. MongoDB write tests use uniquely named disposable test databases and drop only those databases after checking their names.

## Files changed for this enhancement

Backend (relative to payroll-backend):

- `src/employees/dto/lifecycle.dto.ts` (new)
- `src/employees/schemas/employee.schema.ts`
- `src/employees/employees.controller.ts`
- `src/employees/employees.service.ts`
- `src/employees/employee-lifecycle.spec.ts` (new)
- `src/employees/employee-lifecycle.integration.spec.ts` (new)
- `src/employees/employees.integration.spec.ts` (read expectation includes additive schema defaults)
- `src/payroll-generator/payroll-generator.controller.ts`
- `src/payroll-generator/payroll-generator.service.ts`
- `EMPLOYEE_LIFECYCLE.md` (this document)

Frontend (relative to sibling payroll-frontend):

- `src/app/employees/employee.ts`
- `src/app/employees/employee.service.ts`
- `src/app/employees/employee-list.ts`, `.html`, `.css`
- `src/app/employees/employee-form.html`
- `src/app/employees/lifecycle-dialog.ts` (new)
- `src/app/employees/employee-lifecycle.spec.ts` (new)
- `src/app/payroll/payroll-generator.ts`, `.html`
- `src/app/payroll/payroll-report.service.ts`
- `src/styles.css` (CDK overlay structural styles)
- `e2e/employee-lifecycle.spec.ts` (new)
- `e2e/employee-edit-pay-frequency.spec.ts`, `e2e/management-delete.spec.ts`, `e2e/ui-refinements.spec.ts` (open the menu before existing Edit/Delete assertions)

Pre-existing uncommitted changes in both repositories were retained; this list does not attribute those changes to this enhancement.

## Verification

- Backend production build: passed.
- Backend source suite: 218 passed, 4 failed, 14 skipped (25 suites passed, one failed, seven skipped). The four failures are in unchanged `src/salary-components/salary-calculation.service.spec.ts`: existing fixtures omit mandatory BASIC/DA/RA configuration and hit the existing mandatory-component validation. Neither formulas nor expected values were changed.
- The unscoped backend command also discovers five pre-existing Playwright specs under `.tmp/rate-pdf-format` and fails to resolve `@playwright/test` there. The source-suite command is `npm.cmd test -- --runInBand --roots src test`.
- Targeted lifecycle and existing employee-edit checks against real MongoDB: 24 passed across three suites. Command: `$env:RUN_MONGO_TESTS='1'; npm.cmd test -- --runInBand --runTestsByPath src/employees/employee-lifecycle.integration.spec.ts src/employees/employees-edit.integration.spec.ts src/employees/employee-lifecycle.spec.ts`. Includes invalid payloads, legacy records, concurrent duplicates, multiple cycles, persisted state, original hire date, identity, existing edits/deletion, and unchanged payroll-history documents. Other opt-in database suites were not run.
- Frontend production build: passed; warns about the 500 kB initial-bundle warning budget and existing PDF dependency CommonJS modules. The 1 MB build error budget is satisfied.
- Frontend unit suite: 56 passed across 15 files, including four lifecycle UI tests.
- Selected browser regression suite: 12 passed. Covers lifecycle dialogs/history/filter/refresh, keyboard and outside dismissal, mobile menu clipping, existing add/edit/delete, employee IDs, and annual/monthly PDF downloads, values, totals, and multipage layout. Requests are intercepted in browser tests; MongoDB persistence is covered separately above.
- Final lifecycle browser rerun: two passed, including explicit inclusion reaching the payroll POST payload.

## Rehire design references

Oracle's [Rehire a Worker](https://docs.oracle.com/en/cloud/saas/human-resources/fawhr/rehire-a-worker.html) distinguishes the existing person record from a new employment relationship. SAP's [Explaining the Rehire Process](https://learning.sap.com/courses/sap-successfactors-onboarding-project-team-orientation/defining-the-rehire-process) places a new employment start after the previous termination. This implementation applies those principles within the existing single employee record by retaining each employment period, without introducing another HR subsystem.

Future scheduling, historical salary snapshots, payroll proration, correction/rescission workflows, and actor-level auditing remain outside this enhancement. The existing unrelated salary test failures remain unresolved.
