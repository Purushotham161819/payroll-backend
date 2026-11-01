# Employee and salary component deletion

## API behavior
DELETE /employees/:id and DELETE /salary-components/:id use the existing MongoDB IDs, require no request body, and return HTTP 200 JSON:

    { "message": "Employee deleted successfully.", "deletedId": "<MongoDB ID>" }
    { "message": "Salary component deleted successfully.", "deletedId": "<MongoDB ID>" }

Both routes return 400 for malformed IDs, 404 for valid IDs that no longer exist, and a sanitized 503 on database failures. Salary component protection/dependency conflicts return 409 with an explanatory message. CORS now includes DELETE. Existing create, list, update and status routes are unchanged.

## Employee deletion and history
Employee deletion uses findByIdAndDelete for exactly the requested document. Inspection found three managed collections: employees, salary_components and statutory_deductions. The only schema reference is a salary-component calculation-base reference to another SalaryComponent. There is no persisted payroll-result, report-history, timesheet or audit model referencing employees. Reports are calculated on demand and PDFs are downloaded independently.

Accordingly, employee deletion is hard deletion, with no cascade or file removal. No other collection or historical document is queried or modified by the delete operation. Previously downloaded PDFs remain unchanged. This decision reflects the current managed data model; externally maintained/unmodeled records were not inspected. If persistent payroll/audit records are introduced later, employee retention rules should be revisited before depending on hard deletion.

## Salary component integrity
The service checks the stored record, not request-supplied flags or names. BASIC, DA and RA are protected by the existing mandatory code mapping, and any isSystemDefined record is also protected. Renaming a display name, sending a different code/flag in a DELETE body, or using uppercase ObjectID input does not bypass protection.

All other components, including inactive ones, are inspected before deletion:
- Existing salary_component calculation-base references block deletion.
- Formula definitions are parsed with the existing safe parser and stable component_<ID> references are checked. Parser collection covers IF conditions, both IF branches, MIN/MAX and arithmetic, including unselected branches.
- Conflicts identify dependent component names and codes. Formulas and dependent records are never rewritten or deleted.
- An unparseable saved formula blocks deletion with an instruction to repair it, rather than skipping dependency verification.

Only the requested component is deleted after these checks. Dynamic aggregate references such as Total Allowances do not create dangling component IDs when an allowance is removed; their sums continue to follow the remaining configuration. Explicit references must be resolved first.

Delete operations share the existing SalaryComponentsService pending-write queue with create/update/status changes, preventing same-process graph-write races. Existing cross-process/direct-database edits are not protected by a global transaction; multi-instance deployment would need database-level coordination for stronger concurrency guarantees.

## Frontend
Employees and optional Salary Components now have Delete actions. Mandatory rows hide the action and display Deletion unavailable with an explanation. A shared native modal identifies the exact employee or component and explains that deletion is permanent. Cancel is initially focused; Escape cancels, focus returns after closing, and the dialog traps focus using the existing native dialog behavior.

Cancel sends no request. Confirm sends one DELETE request, disables duplicate submission/cancellation while pending, and shows errors within the confirmation without a false success or closing it. Success closes the modal, shows a notification and reloads the appropriate list. Employee selection is pruned by the existing list refresh logic. Creation/edit forms, salary calculations, formula evaluation, statutory settings, Net Pay, annual/monthly conversion and PDF implementation were not modified in this task.

## Files created or modified for this request
Backend:
- src/employees/employees.controller.ts
- src/employees/employees.service.ts
- src/employees/employees-delete.spec.ts (new)
- src/salary-components/salary-components.controller.ts
- src/salary-components/salary-components.service.ts
- src/salary-components/salary-components-delete.spec.ts (new)
- src/main.ts
- DELETE_APIS.md (this document)
Sibling payroll-frontend:
- src/app/employees/employee.service.ts
- src/app/employees/employee-list.ts
- src/app/employees/employee-list.html
- src/app/employees/employee-list.css
- src/app/settings/settings.ts
- src/app/settings/settings.html
- src/app/settings/settings.css
- src/app/shared/delete-confirmation.ts (new)
- src/app/management-delete.spec.ts (new)
- e2e/management-delete.spec.ts (new)

Earlier uncommitted changes were preserved. No live employee/component deletions, database migrations, Git commits or pushes were performed.

## Actual validation
- Backend production build passed.
- Delete API tests: 2 suites / 19 tests passed. Covers exact-target deletion, invalid/missing IDs, repeat deletion, mandatory codes/system flags, manipulation attempts, inactive calculation bases, IF/MIN references, uppercase IDs, malformed formulas, failed database writes, queue recovery and serialized concurrent creation/deletion.
- Full backend src suite: 24 suites passed, 1 failed, 5 skipped; 197 tests passed, 4 failed, 7 skipped. The same four pre-existing failures remain in untouched salary-components/salary-calculation.service.spec.ts, whose legacy fixtures fail mandatory-component validation. Database-dependent suites remained skipped.
- Frontend production build passed. Initial bundle is 500.25 kB, 250 bytes above the configured 500 kB warning threshold; existing PDF CommonJS optimization warnings also remain. No budget was changed.
- Frontend unit tests: 13 files / 47 tests passed. New tests cover DELETE URLs, single submission, selected-ID pruning, optional component refresh, protected actions and retained server errors.
- Browser scenarios: all 24 relevant scenarios passed across runs. The 22 existing settings, IF/MIN/MAX, statutory, ordering, annual/monthly PDF, pagination and download scenarios passed in the combined run; both new delete scenarios passed after correcting test selectors/error expectations in their rerun. New coverage includes cancellation, identity text, modal errors, no misleading success, dependency repair, mandatory action hiding, selection cleanup, list refresh and mobile layout.

API tests use model stubs, and browser tests intercept HTTP requests. No live MongoDB persistence/deletion end-to-end test was run.
