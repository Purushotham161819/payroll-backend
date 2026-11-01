# Employees and Run Payroll UI refinements

## Changes

Removed the Employees directory row/header checkboxes, selected-row decoration, selected-count footer and obsolete directory selection state. The Run Payroll button remains enabled, including when the directory is empty or loading. It uses the existing route and employees query parameter with all loaded active employee database IDs, independently of the displayed status filter; absent status retains the previous Active default. This replaces manual directory selection without inventing another selection UI. Run Payroll retains its existing table selection and backend eligibility/duplicate checks. Saved draft restoration remains authoritative. With no loaded active employees the existing empty-selection payroll screen remains accessible.

Run Payroll warning indicators sit immediately before First Name in an inline flex wrapper with an 8px gap, 16px glyph and compact 26px button. Existing employeeWarnings generation and complete messages are unchanged.

Replaced this page's large shared detail dialog with the existing Angular CDK connected overlay and accessibility primitives. The content-sized popover has a maximum width of 340px, natural wrapping, separately listed warnings, minimal padding and viewport-aware fallback positions. It can scroll if unusually long content exceeds the viewport. Escape, outside click and the close button dismiss it; keyboard focus returns to the opener. Focus stays within the open popover. The other shared detail dialogs are unchanged.

First/last name links retain the existing Employee Details destinations, return context and modified-click behavior. Run Payroll links now use one color across normal/visited/hover/active states, with no underline and with visible keyboard focus and a restrained hover background. The Employees page already had matching non-underlined link styling, which is preserved.

Removed the highlighted panel's full employee warning list. A small text-only review summary directs users to row icons and explains that Save/Submit are blocked. Existing general API errors, stale-input notices and backend validation remain present. No warning predicates or processing guards changed.

The shared existing refresh glyph now uses a standard rotate path. The Run Payroll button tooltip and accessible name are Refresh Payroll. Its existing recalculate() handler, busy disabling, refreshing spinner and calculation workflow are unchanged.

## Files changed in this task

Frontend production files:
- src/app/employees/employee-list.ts
- src/app/employees/employee-list.html
- src/app/employees/employee-list.css
- src/app/features/run-payroll/run-payroll.component.ts
- src/app/features/run-payroll/run-payroll.component.html
- src/app/features/run-payroll/run-payroll.component.css
- src/app/shared/action-icon.ts

Frontend unit tests:
- src/app/employees/employee-lifecycle.spec.ts
- src/app/management-delete.spec.ts
- src/app/features/run-payroll/run-payroll.spec.ts
- src/app/features/run-payroll/unified-payroll.spec.ts

Frontend browser tests:
- e2e/run-payroll.spec.ts
- e2e/final-ui.spec.ts
- e2e/employee-modal-selection.spec.ts
- e2e/payroll-ui-refinements.spec.ts (new)

Backend test-only change:
- src/run-payroll/run-payroll-review.integration.spec.ts: wait until the reopened popup is visible before clicking outside. No production backend files changed for this task.

Documentation: docs/FINAL-EMPLOYEES-PAYROLL-UI.md (this file).

Earlier uncommitted work is preserved. Git diffs against HEAD also include that earlier work.

## Verification

- Angular production build passed. Existing initial-bundle and CommonJS warnings remain; the enlarged payroll stylesheet also exceeds the 4KB warning budget (5.09KB). No build errors.
- NestJS production build passed.
- Full frontend unit suite: 32 files, 232 tests passed.
- After the final outside-click change, affected payroll frontend suite: 4 files, 22 tests passed.
- Backend tax/profile/payroll regression: 14 suites, 112 passed, 2 optional browser cases skipped in that broad run.
- Separate real-backend Edge payroll-review suite: all 8 passed, including blocked employees, selection/recalculation, Save, Submit, warning dismissal/focus return, historical PDF viewing and byte-for-byte download preservation.
- Frontend Edge browser run: 8 tests passed across payroll refinements, saved-draft/submission/download, profile/payroll UI, and existing final UI flows. The new desktop/mobile refinement check was rerun successfully after the final outside-click change.
- Browser assertions cover absence of directory checkboxes, active Run Payroll launch, status filtering, preserved link destinations/no underlines, warning-only indicators, 8px icon gap/vertical alignment, multiple complete warnings, bounded popover dimensions, all dismissal methods, keyboard focus return, compact review summary, disabled Save/Submit, unchanged refresh request/loading state and unchanged net KPI after refresh.
- Desktop/mobile screenshots were inspected: payroll-frontend/test-results/payroll-refinements-desktop.png and payroll-refinements-mobile.png. Table remains horizontally scrollable on mobile; popover stays inside the viewport.
- Final scoped diff reviewed and git diff --check passed (line-ending normalization notices only).

The directory has no existing search, sorting or pagination controls to modify; its existing columns, status filter, refresh, employee actions and navigation are preserved. No unrelated search/sort/pagination implementation was added.

No APIs, database structures, eligibility rules, payroll/tax/contribution/net formulas, KPI calculations, draft versioning, submission guards, historical records, organization isolation, or Pay Check PDF generation were modified. No commit or push was made.
