# Workforce status filters and reusable employee pagination

Implemented 7 November 2026. No commits or pushes. Existing unrelated work preserved.

## Workforce status filter
Reports now offers exactly All, Active and Terminated. All retains the existing empty status parameter and applies no status predicate. Active includes stored Active and legacy missing/null status records under the existing application semantics; Terminated matches only that status. The explicit Inactive filter is no longer accepted by the report API. All can still include other legacy statuses, and summary counts remain accurate. No employee status records or lifecycle rules were changed.

## Reusable component
New ps-pagination is exported from shared/ui/index.ts. It is independent of EmployeeService, HTTP, routing and employee models. Inputs: totalRecords, currentPage, pageSize, pageSizeOptions, disabled and recordLabel. Outputs: pageChange and pageSizeChange. It renders the range/total, Previous/Next, a bounded set of numbered pages with ellipses, current-page highlight/aria-current, page count and configurable page-size selector. Default sizes are 10, 25 and 50. Empty results show a zero range and disabled navigation. Existing shared buttons, form fields/selects and design tokens provide styling and keyboard/focus behavior; mobile layout wraps.

## Backend-driven directory
The directory now requests only one page from the existing GET /employees endpoint using page, pageSize, status and search. Optional pagination parameters select the response {items,total,page,pageSize}. Requests without pagination parameters retain the original array response, preserving existing getAll consumers. No duplicate endpoint or employee model was introduced.

The server validates parameters, constructs escaped literal case-insensitive substring searches over Employee ID, first name, last name and joined full name, normalizes query whitespace as before, and applies employment status filtering. Stable _id ordering with skip/limit prevents ambiguous page boundaries. The default page size is 10; supported sizes are 10/25/50. A filtered count supplies total metadata. The server clamps out-of-range pages after deletion or other population changes and handles empty populations as page one. Existing tenant-aware model providers and controller authorization remain in effect; query parameters do not select an organization.

The UI resets to page one on search/status/page-size changes, debounces search by 250 ms and cancels obsolete requests. CRUD refreshes use the same paginated request; editing, deletion, creation and lifecycle APIs are unchanged. Account-scoped profile return state now preserves page and page size alongside existing search/status/scroll choices. No pagination state is accepted across accounts.

Run Payroll still selects every active employee independently of the directory page/search/filter. Its launch obtains only active IDs from the existing tenant-scoped Dashboard summary instead of incorrectly using the visible page or downloading all employee records. Payroll calculation and processing workflows were not changed.

## Files
Backend modified:
- src/employees/employees.controller.ts
- src/employees/employees.service.ts
- src/reports/reports.service.ts

Backend created:
- src/employees/employee-page-query.ts
- src/employees/employee-pagination.spec.ts
- docs/EMPLOYEE_PAGINATION_WORKFORCE_FILTER_REPORT.md

Frontend modified:
- src/app/employees/employee-list.ts
- src/app/employees/employee-list.html
- src/app/employees/employee.service.ts
- src/app/employees/employee-search.spec.ts
- src/app/employees/employee-list-pilot.spec.ts
- src/app/employees/employee-lifecycle.spec.ts
- src/app/management-delete.spec.ts
- src/app/features/run-payroll/run-payroll.spec.ts
- src/app/shared/navigation-context.ts
- src/app/shared/navigation-context.spec.ts
- src/app/shared/ui/index.ts
- src/app/reports/reports.ts
- src/app/reports/reports.spec.ts

Frontend created:
- src/app/shared/ui/ps-pagination.ts
- src/app/shared/ui/ps-pagination.html
- src/app/shared/ui/ps-pagination.scss
- src/app/shared/ui/ps-pagination.spec.ts
- e2e/employees-pagination.spec.ts

Existing test fixtures that instantiate EmployeeList were adapted to the optional page contract. The former local-search assertions now verify the same search criteria through the backend; data formatting, CRUD and payroll selection assertions remain protected.

## Focused verification
- Backend: 9 tests passed in employee-pagination.spec.ts. Covers legacy API compatibility, optional paged contract, search escaping/normalization and full-name matching query, active/terminated/all predicates, invalid parameters, non-overlapping deterministic pages, filtered totals, deletion/empty page clamping, tenant collection separation and workforce filter options. Database query execution is mocked; tenant routing uses disconnected Mongoose models.
- Frontend core: 23 tests passed across reusable pagination, employee search/paging, Reports and navigation-context tests. Covers ranges/boundaries/events/custom sizes/disabled state, one-page loading, size/status/search changes, totals/empty states, all-active Run Payroll launch, exact report options, unchanged report export data and account-scoped pagination restoration.
- Frontend preservation: 8 focused existing checks passed for employee columns/styles/actions, lifecycle list refresh, successful/failed employee deletion and the two directory-to-Run-Payroll launch scenarios. Unrelated cases in those files were excluded with a test-name filter; no payroll calculation suite ran.
- Browser: 2 focused Playwright checks passed at 1440 and 390 px. Covers actual workforce dropdown options, first-page row count, Previous disabled, Next/page-number navigation, page-size selection, search/count updates and responsive pagination without horizontal overflow. Screenshots were visually inspected.
- Total: 40 unit/service/component checks plus 2 focused browser checks passed.
- Backend production build: passed on one run.
- Frontend production build: passed on one run. Existing bundle/style budget and PDF dependency warnings remain (initial bundle 881.00 kB, below the 1 MB error threshold).
- Whitespace checks passed. No broad application regression or unrelated calculation comparison was run.

## Limits and deployment
No database migration or new dependency is required. Restart/deploy the backend and serve the rebuilt frontend. Legacy API consumers still receive full arrays when they explicitly use getAll; only the Employees directory was moved to server pagination in this task. Offset pagination reflects the current database: concurrent edits can change membership between separate page requests. Live MongoDB integration was not run; browser checks used scoped API mocks. No existing employee records were modified during verification. No global shared design-system styles or unrelated module layouts were changed.
