# PayStream employee tax-access removal and conservative cleanup

Completed 10 November 2026 in the existing PayStream backend/frontend repositories. Both repositories remain on their original `main` branches. Previous local changes were preserved. No Signum access, `.env` changes, account/payroll data migration, commits, pushes or deployment were performed.

## Completed access change

Employee My Profile now exposes exactly **Employee Details** and **Pay Checks**. Income Tax / TDS is absent from the employee tab list. An employee's `?tab=tax` deep link selects Employee Details, never instantiates the shared tax component and makes no tax API requests. Permissions remains hidden from employees and follows its existing administrator/employee-manager rules.

The backend employee endpoint allowlist no longer permits any Income Tax/TDS route. The tax controller's employee-owned-read exception was removed as an independent second layer of protection. Employee list/summary/history requests and tax edit/save/calculate/change-year requests are rejected, including after successful Private Mode OTP verification and when changing the employee identifier. An OTP grant continues to authorize only the existing permitted sensitive employee profile/paycheck/PDF data; it cannot restore tax-module access.

Employee-facing profile and paycheck responses are projected from explicit field allowlists even when Private Mode is unlocked. Unknown employee tax-profile fields and embedded paycheck tax/calculation/snapshot objects are not returned. Staff responses bypass this employee-only projection and retain their original payloads.

**Paycheck distinction:** the existing finalized paycheck's TDS deduction amount and saved PDF are retained as part of Pay Checks, along with gross pay, employer contributions, deductions and net pay. Detailed income-tax profiles, regimes, declarations and calculation/history snapshots are unavailable to employees. Removing the saved payslip's existing deduction information would change the Pay Checks/PDF functionality that this task explicitly protects.

## Staff permissions preserved

The inspected application currently grants dedicated Income Tax/TDS screen/API access to the `admin` role. The ordinary `user` role was already denied by `TaxAdministratorGuard` and already lacked the tax tab. This work preserves those exact rules; it does not introduce a new entitlement or broaden/narrow staff roles.

Administrators retain the tax tab and existing read/write workflows. Regular users retain their existing Employee Details, Pay Checks and Permissions tabs. Shared tax configuration routes, services, models, APIs and calculations remain intact. Organization ownership still comes from the persisted authenticated account, never a caller-selected organization/employee parameter.

## Unnecessary code removed

Dependency tracing established that the only production consumer of EmployeeTax's `readOnly` input was the employee branch in EmployeeProfile. With employee tax access removed, the following became demonstrably unused:

- Employee-specific tax endpoint allowlist entries and tax-controller read exception.
- Private Mode's tax-unlock guard/response branch; employees are now denied outright rather than unlocked into tax access.
- Employee tax-tab selection/visibility and employee-only Private Mode tax explanation.
- EmployeeTax's `readOnly` input, employee-only saved-year loading path, empty-state message and seven mutation/year-lock guards that existed only for that mode.
- Employee-only template conditions around shared tax actions. The retained staff behavior matches the original `readOnly = false` behavior.
- Unused EmployeeTax/TaxApi imports in the employee portal test after its obsolete access expectation was retargeted.
- Employee dashboard/welcome-email copy promising dedicated income-tax access. Only the obsolete wording changed; dashboard behavior, invitation delivery and Graph configuration did not change.

No components, services, APIs, models, routes, tests, documentation or whole files were deleted. No broad refactoring, renaming, dependency change or unrelated cleanup was performed.

## Shared functionality intentionally retained

- EmployeeTax component, templates/styles, TaxApi and its `employeeProfiles` method: still used by the administrator tax view and its tests.
- EmployeeProfile's EmployeeTax import, ViewChild, saved-tab state and unsaved-change checks: still needed by administrator tax editing.
- TaxConfigurationService, EmployeeTaxProfileService, IncomeTaxService, tax guards/controllers/modules and database models.
- Existing tax configuration routes and role guards.
- PayChecks, saved TDS deduction popover, PDF services, Private Mode and OTP workflow.
- Permissions/account lifecycle services, invitations, password setup, login and tenant enforcement.
- Previous implementation reports and useful tests; they remain historical evidence. This report supersedes their earlier employee-tax-access descriptions.

No payroll/CTC/tax/statutory calculations, saved paycheck records, PDF generation, payment statuses, Mark as Paid, email-provider configuration or bank functionality was changed.

## Files modified for this task

Backend paths relative to `D:\projects\payroll-backend`:

- `src/auth/employee-access.ts`: remove tax routes from the employee allowlist.
- `src/income-tax/tax.controller.ts`: remove the employee exception; retain the existing staff guard and all endpoints.
- `src/auth/auth.guard.ts`: remove obsolete employee tax unlock handling; PDF protection remains.
- `src/auth/private-mode.interceptor.ts`: remove unreachable tax handling and restrict employee profile/paycheck payloads to consumed fields.
- `src/auth/invitation-mail.ts`: remove the obsolete employee tax-access promise from welcome copy.
- `src/auth/invitation-mail.spec.ts`: verify corrected employee copy and unchanged shared branded email behavior.
- `src/auth/private-mode.integration.spec.ts`: test employee denial with/without OTP, staff baseline permissions, actual second-organization isolation and alternate-response protection.
- `src/auth/employee-portal.integration.spec.ts`: retain the useful existing fixture/test while changing its obsolete tax-success assertions to denial.
- New `EMPLOYEE_TAX_ACCESS_CLEANUP_REPORT.md`: this report.

Frontend paths relative to `D:\projects\payroll-frontend`:

- `src/app/employees/employee-profile.ts`: reject employee tax-tab selection.
- `src/app/employees/employee-profile.html`: staff-only tax visibility/mounting and removal of employee tax/Private Mode branching.
- `src/app/features/tax-management/employee-tax.ts`: remove the now-unused employee read-only extension; retain staff editing logic.
- `src/app/features/tax-management/employee-tax.html`: remove obsolete read-only-mode markup/conditions; retain the shared staff layout/actions.
- `src/app/employees/employee-dashboard.ts`: remove obsolete tax wording only.
- `src/app/employees/employee-portal.spec.ts`: retarget obsolete employee tax-access tests to exact two-tab navigation, deep-link rejection and retained staff tab rules.

**Files deleted: none.** No design-system styling changes or deviations were introduced. Files whose employee-only extensions now match their original repository version may no longer appear as modified against Git HEAD; the list above records changes made during this task relative to the preceding working tree.

## Focused testing

**Backend: 11 unique tests passed** across:

- `src/auth/private-mode.integration.spec.ts`: 9 passed. Includes the directly affected profile/paycheck/Private Mode protection and the new tax-access security case.
- `src/auth/invitation-mail.spec.ts`: 2 passed.

The new security case checks all employee tax reads and writes for own/peer/foreign IDs, before and after OTP unlock; administrator reads; unchanged regular-user denial; employee profile/paycheck availability; absence of detailed tax data from alternate payloads; and unchanged staff paycheck snapshots. After adding a real second-organization fixture, just this case was rerun with `--testNamePattern`: 1 passed, with the other 8 already-passed cases filtered out. No unrelated cases were repeated for that fixture refinement.

**Frontend: 39 tests passed** across:

- `src/app/employees/employee-portal.spec.ts`: 13 passed.
- `src/app/features/tax-management/employee-tax-workflow.spec.ts`: 22 passed, exercising the retained shared tax presentation/editing/year workflow using mocked API responses, not payroll comparison calculations.
- `src/app/employees/pay-checks.spec.ts`: 4 passed.

Checks cover exact employee tab order, absence of Permissions/tax, tax deep-link rejection without API calls, unchanged staff tab permissions, Employee Details presentation/read-only restrictions and retained Pay Checks/PDF controls.

Each application build ran once:

- Backend `npm.cmd run build`: **passed**.
- Frontend `npm.cmd run build`: **passed**. Initial bundle 910.90 kB exceeds the 500 kB warning budget but remains below the 1 MB failure budget. Unchanged shared/app/payroll stylesheet warnings and existing jsPDF/canvg CommonJS warnings remain. No warning thresholds or dependencies were changed.
- `git diff --check`: **passed** for both repositories.

The complete backend suite, complete Angular suite, full pre-existing employee/Permissions integration suite, full browser regression, broad E2E automation, payroll comparison suites and unrelated tests were intentionally not run. Real browser acceptance and live Graph delivery were not exercised for this access/copy change.

## Remaining limits and cleanup opportunities

The requested employee tax-access removal and conservative cleanup are complete. No database/configuration changes are required. There are no partially implemented access changes.

No additional service/component deletion could be justified after tracing shared dependencies, so those files were retained. Broader refactoring, a new granular staff permission model, and removal/redesign of saved payslip deduction information are not implemented or authorized by this task. Existing build warnings remain outside this cleanup scope.
