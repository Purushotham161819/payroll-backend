# Navigation icon, Indian number formatting and employee search

## Implementation

User Management now uses a users/team outline glyph in the existing ActionIcon component. There is no installed Lucide package in this repository; the existing shared SVG approach was reused rather than introducing a library. The 16px icon inherits the sidebar color and existing 1.7px stroke styling. Existing spacing, route, active/hover states and role checks are unchanged.

Application configuration registers Angular en-IN locale data and provides LOCALE_ID=en-IN. All existing Angular CurrencyPipe and DecimalPipe consumers now inherit Indian grouping. Monetary precision remains the existing two-decimal convention; no formatted strings enter calculations, requests or storage. Numeric input fields intentionally retain raw editable numeric values. Existing statutory currency previews, settings fixed amounts, annual/monthly report currency formatting and backend Pay Check PDF formatting already use en-IN and were preserved. No new currency utility or dependency was added. Locale-sensitive date pipes also inherit the application locale; explicit date-format strings are unchanged.

Affected displays include Employee Directory annual CTC; Employee Profile compensation; Run Payroll row amounts, KPIs and footer; Pay Checks history; Employee Income Tax/TDS summary, breakdown, slabs and calculation history; Tax Configuration revision monetary values; and any other Angular number/currency-pipe consumers. Salary component fixed amounts, statutory previews and annual/monthly report PDFs retain their already-correct Indian formatting. Percentages remain percentages and existing rounding/formula logic is untouched. No PDF generation source or layout was changed.

Employee Directory now has a compact labeled search input with an inline search glyph, placeholder and explicit clear button. The search combines with the existing status filter and matches Employee ID, First Name, Last Name or Full Name. Matching is case-insensitive and partial; leading/trailing whitespace and repeated query whitespace are normalized. Clearing restores the current status-filtered list and returns focus to the input. The no-results message describes the search and suggests another name or ID. The toolbar wraps cleanly on mobile.

Search operates on the already-loaded allEmployees signal through the established client-side filtering flow. It does not send per-keystroke requests, change the underlying records or alter their ordering. There is no existing directory pagination/sort UI or server pagination to reset or modify. Run Payroll still uses its existing all-active list independently of the displayed search results, and employee link navigation is unchanged.

## Files changed in this task

Frontend production:
- src/app/app.config.ts: application locale registration/provider.
- src/app/app.ts: import the existing ActionIcon component into the workspace.
- src/app/app.html: replace only the User Management glyph.
- src/app/app.css: icon dimensions/alignment.
- src/app/shared/action-icon.ts: users icon variant.
- src/app/employees/employee-list.ts: query signal and combined local filtering.
- src/app/employees/employee-list.html: search/clear controls and no-results text.
- src/app/employees/employee-list.css: responsive search toolbar styles.

New frontend tests:
- src/app/indian-number-formatting.spec.ts
- src/app/employees/employee-search.spec.ts
- e2e/indian-format-search.spec.ts

Backend tests only:
- src/run-payroll/payslip.spec.ts: decode actual generated PDF and verify requested Indian monetary scales.
- src/run-payroll/run-payroll-review.integration.spec.ts: update display-only expectations to en-IN, including 5,85,000.00. All underlying fixtures and calculations are unchanged.

Documentation: docs/INDIAN-FORMATTING-EMPLOYEE-SEARCH.md (this report).

Previous uncommitted changes are preserved. Git diffs against HEAD include earlier tasks as well as these changes.

## Verification

- Angular production build passed. Existing initial bundle budget, payroll stylesheet budget and CommonJS dependency warnings remain.
- NestJS production build passed.
- Full frontend unit suite: 34 files, 249 tests passed.
- New unit tests cover nine amount scales from 1,000 through 10,00,00,000, including 14,00,000.50, numeric precision preservation, zero/negative/null displays, existing payroll-report currency formatting, ID/name/full-name/partial/case/whitespace searches, combined status filters, no extra API requests, clear/focus restoration, records unchanged and payroll launch independent of search.
- Backend tax/profile/payroll suite: 14 suites passed, 113 tests passed, 2 optional browser cases skipped in that broad run. Actual PDF text verifies 1,000.00; 10,000.00; 1,00,000.00; 10,00,000.00; 1,00,00,000.00; and 14,00,000.50. Existing privacy, totals, grayscale, font/geometry and pagination assertions remain passing.
- Separate production-Angular/isolated-real-backend Edge payroll-review suite: all 8 tests passed, including review restrictions, recalculation, Save/Submit, original historical PDF preservation, viewer and byte-for-byte downloaded PDFs.
- New Edge browser suite: all 4 scenarios passed. It verifies responsive search, directory CTC formatting, numeric CTC editing/saving and profile navigation; icon geometry/stroke/active state and admin-only navigation/route protection; dynamic payroll contributions/TDS/net/KPIs and Pay Checks history; salary component settings, statutory previews, tax revision slabs/rebate/deduction/surcharge/exempt amounts and employee tax summary formatting.
- Existing Edge regression scenarios also passed: final-ui (4), profile-payroll-ui (2), and run-payroll (1), covering draft reopening/submission/downloads, profile return context, Super Admin and existing navigation flows.
- Desktop/mobile screenshots inspected: payroll-frontend/test-results/indian-format-search-desktop.png and indian-format-search-mobile.png. The search control fits at 390px, table scrolling remains inside its container, and the sidebar icon inherits the dark-theme colors.
- Final scoped code diff reviewed. Both repositories pass git diff --check, with existing line-ending normalization notices only.

Two initial browser fixture failures were corrected by restricting mocks to the API host and using the existing /settings/statutory-deductions endpoint; production routing/API behavior was not changed.

No salary, tax, statutory, formula, eligibility, draft/submission, authentication, authorization, tenant isolation, database, API, PDF generation or historical-record logic was modified. Numeric values remain numeric. No commit or push was made.
