# Mid-year joiner and job-change TDS

## Supported workflow

The Employee Tax Profile now offers `first_job` and `job_change` under Employment During Current Financial Year. Mid-year employment no longer fails the old full-year hire-date check when either scenario is saved. Residency, salary-only scope, operative PAN, configuration age limits and applicable exemption verification still apply.

The scenario starts unselected. Existing full-year profiles without a scenario retain their full-year confirmation workflow; a mid-year profile without a scenario receives an explicit instruction to select and save one. Financial-year locking, configuration-derived regime, Edit permissions, optimistic versions and organization ownership remain in place.

Job Change requires numeric previous-employer gross wages, exempt wages and TDS, each non-negative, limited to two decimal places and the existing supported amount range. Exempt wages cannot exceed gross. Nonzero previous exemptions require explicit documented verification. These employee-provided amounts and verification are saved and audited in the existing employee/year profile and captured in the calculation snapshot. Choosing First Job clears the UI amounts and normalizes them to zero on the backend; hidden previous values cannot affect tax.

## Projection and tax

The joining month and financial-year end month are included. Employment before the year start produces twelve eligible months. The current employment start is the existing rehire date when present, otherwise hire date. A start after year end is rejected.

For September 6 in an April–March financial year, there are seven eligible months. Annual CTC 1,600,000 becomes projected CTC **933,333.33**. This is passed through the existing annual salary solver; it is not treated as gross wages.

Per the user's confirmed choices:

- Fixed annual/monthly component amounts and annual EPF/ESI caps are prorated to the same employment period. Percentages and formula expressions remain unchanged and are evaluated through the existing solver with period inputs. Monthly fixed values are prorated on their annual total to avoid multiplying a rounded monthly amount into a larger rounding error.
- Previous-employer gross is reduced by separately recorded, verified previous-employer exempt wages. Previous income is not passed through current-employer component formulas or mappings.

The existing tax engine applies current salary mappings, adds prior salary with its verified exemptions, applies the standard deduction **once** to combined taxable salary, and retains its progressive slabs, rebate, marginal relief, surcharge, cess and rounding sequence. No tax rates or tax configuration revisions were changed.

Previous TDS is a credit after annual liability, not an income reduction. Current-employer submitted TDS is also credited on recalculation. Remaining liability is clamped at zero. Excess credit and previous TDS greater than prior gross produce review warnings; neither creates a refund or negative payroll deduction.

## Allocation, snapshots and payroll

Allocation remains a twelve-element financial-year month array for API/payroll compatibility. Months before joining and months already submitted for this employee receive zero. The unpaid balance is divided over the eligible unsubmitted months, floored to paise; the final eligible check receives the remainder. Submitted payroll without TDS still consumes that payroll month. A positive balance with no eligible checks left produces an explicit error instead of silently losing the liability.

`annualEstimatedTax` is total annual tax before credits; `annualTds` is annual current-employer liability after previous-employer credit; `remainingAnnualTds` additionally subtracts submitted current-employer TDS. The allocation sums to the latter. The snapshot records projected salary, original annual salary, employment dates/scenario, prior amounts, profile/configuration versions and the submitted-period/TDS baseline used at calculation.

The current-input hash covers the employment facts and projection as well as annual salary and profile/configuration versions. The settlement baseline stays attached to the saved calculation so normal payroll submission does not invalidate future allocations. Explicit recalculation reads current submitted history and produces a new allocation. Calculation and submission use the existing tax write lock.

Hire-date, CTC, profile, previous wages/credits, configuration or projection changes invalidate the saved calculation. Snapshots created before this expanded input-hash format require explicit recalculation before use; they are retained as history. Run Payroll still uses zero for missing, disabled or stale TDS and applies a valid calculated monthly amount once using the existing deduction integration. Finalized checks and PDFs are never rewritten.

## Files and storage

Backend implementation:

- `src/employee-tax-profile/employee-tax-profile.service.ts`: schema extension, save validation and audited values.
- `src/income-tax/employment-scenario.ts`: scenario and previous-employer validation/normalization.
- `src/income-tax/employment-period.ts`: inclusive month counting and submitted-period filtering.
- `src/income-tax/income-tax.service.ts`: eligibility, projection orchestration, credits, snapshots, allocation and freshness.
- `src/income-tax/tax-engine.ts`, `tax.types.ts`: prior salary/exemptions within the existing engine and generalized monthly allocation.
- `src/payroll-generator/salary-calculation.service.ts`: TDS-only period-input adapter into the existing annual solver. Ordinary payroll calls are unchanged.

Frontend implementation in the sibling `payroll-frontend` repository:

- `src/app/features/tax-management/employee-tax.ts`: scenario state and clearing prior values.
- `src/app/features/tax-management/employee-tax.html`: radios, monetary inputs, verification, descriptions, saved breakdown and review warnings.
- `src/app/features/tax-management/employee-tax-workflow.spec.ts`: form/save/read-only/switching/breakdown regression coverage.

The existing employee tax profile schema gains `employmentScenario`, `previousEmployerGrossWages`, `previousEmployerExemptWages`, `previousEmployerTds`, and `previousEmployerExemptionsVerified`. The existing calculation snapshot stores expanded inputs/results. There are no new collections, migrations, routes, DTOs or indexes; existing API fields and twelve-month allocation indexing remain available.

Backend tests added/updated:

- `src/income-tax/mid-year-tds.integration.spec.ts`
- `src/income-tax/employment-period.spec.ts`
- `src/income-tax/remaining-period-allocation.spec.ts`
- `src/income-tax/income-tax-eligibility.spec.ts`
- `src/payroll-generator/salary-projection.spec.ts`
- `src/run-payroll/run-payroll-review.integration.spec.ts`

The preceding eligibility investigation's HTTP regression in `employee-tax-workflow.integration.spec.ts` remains applicable: a mid-year employee without an explicit scenario is prompted to select one.

## Verification and scope

- NestJS production build passed.
- Angular production build passed; the existing bundle budget and CommonJS dependency warnings remain.
- Backend targeted suite: 21 suites and 155 tests passed, with one optional browser test skipped. A subsequent focused run passed all six mid-year HTTP/MongoDB tests after adding zero-credit and prior-gross-change coverage (one additional test).
- Frontend tax suite: 6 files and 100 tests passed.
- Salary projection tests assert seven-month fixed allowances, prorated employer caps, gross distinct from CTC, unchanged source settings and exact full-year parity.
- Real MongoDB/HTTP tests cover both scenarios, saved/reloaded profiles, one standard deduction, zero/equal/excess prior credit, stale prior-input edits, hire-date invalidation, payroll deductions, processed-period exclusion, current-employer credit, and preservation of finalized snapshots/PDFs. Existing suites cover optional TDS, salary changes and organization isolation.
- `git diff --check` passed.

This is month-based projection, including the full joining month; it does not introduce daily proration. Only Monthly payroll exists in the current supported frequency configuration. Other frequencies remain explicitly unsupported. Previous-employer totals are employee-provided and require documentary review; there is no Form 12B import, claims adjudication or refund workflow. Custom formula expressions, including literal constants, are preserved and evaluated against the prorated inputs. This feature does not reconstruct actual historical gross earnings or salary-rate changes; annual CTC/configuration is the current projection basis. Broader termination/re-employment reconciliation remains outside this two-scenario workflow.

Verification used isolated MongoDB databases and Angular component tests, not changes to production employee records. An interactive browser session was not manually exercised. No commit or push was made. Unrelated pre-existing backend and frontend working-tree changes were left intact.
