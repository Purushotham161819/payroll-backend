# Employee annual TDS eligibility investigation

This report describes the original restriction and diagnostic fix. The later [mid-year TDS enhancement](MID-YEAR-TDS-IMPLEMENTATION.md) supersedes that restriction for explicitly selected employment scenarios.

## Root cause

Read-only inspection of the local tenant data identified the employee with annual CTC 1,440,000. The saved payroll frequency is `Monthly`, hire date is **2026-10-06**, and the selected financial year starts **2026-04-01**. The existing `IncomeTaxService.project` guard rejects employment beginning after the financial year start, independently of `fullYearEmployment`. This is the exact condition responsible for the generic Version 1 warning. The rule was already documented in `INDIAN-INCOME-TAX-TDS-ENGINE.md`.

The matching saved profile has `tdsApplicable`, `resident`, `salaryOnly`, `panOperative`, and `fullYearEmployment` all true; `exemptionConditionsConfirmed` is false. This differs from the reported UI selection. No missing-field or checkbox conversion defect was found in the source workflow. The exemption flag is required only if a published salary mapping is not fully taxable. The hire-date condition blocks independently of that flag.

The employee therefore does not meet the existing full-year rule. Checking the confirmation cannot make a partial-year employment period eligible. Production employment dates and saved profiles were not changed. Supporting this employee's actual partial-year period would require separately scoped allocation/calculation work; this fix does not fabricate a full-year result.

## Workflow and mapping trace

All six template checkboxes use boolean `ngModel` bindings. The component sends the profile object on Save, waits for persistence, and reloads summary data. Calculation is disabled during editing. `TaxApi.calculate` sends an empty body to the employee/year calculation endpoint. The controller passes employee ID and financial year to `project`; calculation reloads the employee and saved per-year profile rather than trusting request checkbox values.

| UI meaning | Angular, API, MongoDB and eligibility field |
| --- | --- |
| TDS applicable | `tdsApplicable` |
| Indian tax resident | `resident` |
| Salary-only income | `salaryOnly` |
| Operative verified PAN | `panOperative` |
| Full-year confirmation | `fullYearEmployment` |
| Documented exemption verification | `exemptionConditionsConfirmed` |

There is no request DTO for this endpoint: the save controller accepts `any`, and `saveLocked` explicitly requires boolean values for all six properties. String booleans and omitted confirmations are rejected. Schema fields are Boolean. Saved values are retrieved by trusted organization, employee ID and year; regime is derived from published configuration. Editor tokens, optimistic versions and year locking remain unchanged.

Eligibility additionally checks the saved employee's `payFrequency`, hire/rehire date, published configuration and configured age band. The existing salary calculation then supplies annual inputs to the existing `calculateAnnualTax` engine. The calculation snapshot and input hash are persisted; summary derives `calculated` from the current version/hash. Run Payroll uses only a current calculated snapshot and the existing month allocation. No tax rates, component formulas, revisions, payroll snapshots or historical payslips were changed.

## Changes

- `src/income-tax/income-tax.service.ts`: replace the combined unsupported-case error with explicit messages for each missing confirmation, frequency, employment start and exemption confirmation. Date failures show the actual hire/rehire date and year start. Report multiple eligibility failures together using the existing string error contract. Normalize frequency case/whitespace for comparison without rewriting data. Reject invalid employment dates explicitly.
- `src/income-tax/income-tax-eligibility.spec.ts`: add eligibility regression tests, including the reported hire date, monthly variants, individual flags, rehire, conditional exemptions and disabled TDS.
- `src/employee-tax-profile/employee-tax-workflow.integration.spec.ts`: add an HTTP/MongoDB regression exercising saved profile values, rejection, reload and successful persisted calculation after correcting only the isolated fixture's employment date. Request booleans cannot override saved facts.
- Frontend files modified: none. Existing error handling displays the backend's specific message.
- API/DTO/schema changes: none.

## Verification

- NestJS production build: passed.
- Angular production build: passed, with existing bundle-budget and CommonJS dependency warnings.
- Frontend tax-management tests: 6 files, 97 tests passed.
- Backend targeted run with `RUN_TAX_MONGO_TESTS=1` and `RUN_PAYROLL_MONGO_TESTS=1`: 7 suites, 60 tests passed; one optional browser payroll test skipped.
- Real MongoDB suites cover profile persistence, annual calculation, status, authoritative payroll deduction, disabled/unconfigured TDS, stale estimates, tenant isolation and historical snapshot/PDF preservation.
- `git diff --check`: passed.

Eligible saved profiles successfully execute the existing engine and persist a `calculated` result in the HTTP/MongoDB test. The complete interactive browser workflow was not manually exercised. The reported production employee correctly remains ineligible under the existing partial-year limitation and now receives the precise explanation. No commit or push was made. Pre-existing unrelated working-tree changes were left intact.
