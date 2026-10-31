# Optional employee TDS in Run Payroll

This implements the latest approved request, “Fix Run Payroll TDS Review Blocking Issue and Implement Optional TDS Deduction.” It supersedes the previous policy described in `RUN-PAYROLL-REVIEW-FIX.md`.

## Root cause and revised integration

Payroll previously called `IncomeTaxService.project` automatically for every TDS-enabled employee. It then compared the resulting input hash with all submitted checks in that financial year. Any earlier check without TDS, or with different inputs, raised the mid-year reconciliation conflict. The preview marked that employee Needs Review, excluded their check from totals and disabled Save/Submit for the selection. Disabling TDS after earlier TDS payroll also raised a conflict. These rules conflicted with the newly approved optional-deduction behavior.

The employee calculation collection already stores an explicit `snapshot.status: calculated`. Employee Details nevertheless displayed “Estimate saved” whenever any saved record existed, even immediately after successful calculation. The display did not distinguish a current calculation from an outdated one.

Payroll now reads the authoritative saved calculation. It does not call the annual tax calculator or create calculation records during preview, draft save or submission. The shared backend status resolver checks explicit stored status and matches its input hash against the current year, published regime revision, profile version and existing annual salary-engine output. Invalid or missing allocations cannot be applied. The latest record is selected deterministically by creation time and ID.

| Backend status | Employee Details / payroll status | Payroll TDS |
| --- | --- | --- |
| `not_configured` | TDS not configured | ₹0.00 |
| `disabled` | TDS disabled | ₹0.00 |
| `not_calculated` | Not calculated | ₹0.00 |
| `estimate_saved` | Estimate saved — recalculate after input changes in Income Tax/TDS. | ₹0.00 |
| `calculated` | Calculated | Authoritative saved allocation for the selected financial-year month |

The employee summary API returns `calculationStatus` and `calculationStatusLabel`. Run Payroll uses the same resolver and stores `tdsCalculationStatus` and its label alongside the applied amount in each new check. It never infers a valid calculation merely from the existence of an amount or a record. No stored historical statuses were migrated or relabeled.

## Blocking conditions modified

- Removed the cross-period hash/no-TDS conflict from new payroll calculations.
- Removed the conflict for disabling TDS after an earlier submitted deduction.
- Missing year/profile, missing calculation, inactive/outdated configuration and stale inputs produce zero optional TDS rather than excluding the employee or blocking the batch.
- The annual tax calculation endpoint still validates supported tax inputs and configuration when the administrator explicitly calculates TDS. A failed calculation does not manufacture a current record.
- Genuine payroll validation remains: employee eligibility, required salary/statutory data, unavailable Net Pay for an applied deduction, organization ownership, period/payment-date rules, saved-draft freshness, version checks, duplicate prevention and atomic finalization.

Saved drafts with different financial inputs still require the ordinary Recalculate → Save workflow. This ensures that a draft created while TDS was current cannot deduct its old amount after the calculation becomes stale. The refreshed draft applies zero TDS and can be submitted. This is a draft-integrity rule, not a requirement to configure or calculate TDS.

## Financial presentation and persistence

The payroll table now has ten columns including its selection checkbox. The visible financial columns are Monthly CTC, Employer Contributions, TDS, Deductions and NET Pay. TDS always displays an INR amount, including ₹0.00 for optional states. The Deductions column and its footer show only employee deductions excluding TDS. The deductions KPI continues to include employee deductions plus TDS once.

The original annual salary engine produces Gross, employer contributions, statutory deductions and baseline Net. The existing `applyPayrollTax` function subtracts an authoritative applicable amount once from baseline Net and adds it once to total deductions. Annual CTC, Gross, component dependency formulas, employer contribution treatment and annual-to-monthly derivation were not changed.

New checks explicitly persist zero TDS when not applicable. Applied TDS retains its saved calculation ID, input hash, configuration/profile versions, annual allocation and selected month in the immutable payroll tax snapshot. The existing PDF renderer shows the separate Income Tax / TDS component for applied deductions, total employee deductions and final Net. Zero optional deductions do not add a misleading deduction component. Historical finalized checks and PDF bytes are returned unchanged; there is no migration or historical recalculation.

The server ignores financial amounts supplied by the client. Save and Submit resolve the same backend state independently, with the existing lock, strict recalculation comparisons and period compare-and-swap.

## Files changed for this request

Backend:

- `src/income-tax/income-tax.service.ts`: shared authoritative status resolution, saved-record payroll assessment, removal of historical TDS blockers, summary status fields and deterministic record order.
- `src/run-payroll/run-payroll.service.ts`: optional assessment and explicit zero/status snapshot fields.
- `src/run-payroll/schemas/payroll-run.schema.ts`: optional status metadata on check type; the existing Mixed check storage requires no migration.
- `src/income-tax/income-tax.integration.spec.ts`: expectations updated to the approved zero-on-stale policy while preserving finalized-history assertions.
- `src/run-payroll/run-payroll-review.integration.spec.ts`: optional TDS API/persistence/PDF regressions and production Angular/Edge workflow.
- `docs/INDIAN-INCOME-TAX-TDS-ENGINE.md` and `docs/RUN-PAYROLL-REVIEW-FIX.md`: current integration policy and supersession notice.
- This report.

Frontend in `D:/projects/payroll-frontend`:

- `src/app/features/run-payroll/models/payroll-run.ts`: status fields on checks.
- `src/app/features/run-payroll/run-payroll.component.ts`: separate TDS and other-deduction footer helpers, including old snapshot fallback.
- `src/app/features/run-payroll/run-payroll.component.html`: TDS column, status label, zero formatting, separate deductions and footer alignment.
- `src/app/features/run-payroll/unified-payroll.spec.ts`: ten-column and separate-deduction regressions.
- `src/app/features/tax-management/employee-tax.html`: backend-authoritative status and optional deduction explanation.
- `src/app/features/tax-management/tax-management.spec.ts`: explicit status API fixtures and status rendering tests.

Existing unrelated workspace changes were preserved. No commits or pushes were made.

## Verification

The isolated test database creates EMP001–EMP004; these are disposable test records, not edits to the customer's employee records. A deliberately synthetic published 1% test slab, zero cess, zero standard deduction and monthly Gross ₹2,00,000 produces an authoritative monthly TDS of ₹2,000. No production tax rates were added or changed. All database cleanup checks the exact generated database name and test prefix.

| Requested scenario | Verified result |
| --- | --- |
| EMP001: no TDS configuration, November payroll | TDS ₹0, other deductions ₹5,000, Net ₹1,95,000; included in totals; save, reopen, submit and PDF pass despite earlier October payroll without TDS |
| EMP002: saved estimate after changed inputs | Shared status `estimate_saved`, TDS ₹0; save, submit and PDF pass; payroll creates no new TDS calculation |
| EMP003: current Calculated status | Saved authoritative ₹2,000 applied once; other deductions stay ₹5,000, total deductions ₹7,000, Net ₹1,93,000; calculation ID and PDF deduction verified |
| EMP004: configured, missing calculation | TDS ₹0, normal payroll save/submit; no calculation is manufactured |
| Mixed selection | All four checks included; monthly CTC ₹8,00,000, ER ₹0, total deductions ₹22,000, Net ₹7,78,000; persisted TDS amounts `[0, 0, 0, 2000]` |
| Explicit saved estimate status | Even with a saved positive allocation and matching input hash, non-calculated stored status applies ₹0 |
| Earlier zero-TDS payroll followed by calculation | Current saved calculation applies normally; no reconciliation block |
| Disabling after earlier applied TDS | New preview applies ₹0 and leaves the earlier snapshot unchanged |
| Salary changes after draft | Summary becomes stale, old draft cannot submit the outdated deduction, fresh payroll uses ₹0 and submits normally |
| Client-supplied TDS amount | Injected `tds: 999999` is ignored by server-side draft calculation |
| Historical and duplicate regression | Original October PDF and check history preserved; finalized employee cannot be saved again for the same period |

The real headless Edge test serves the production Angular build and proxies actual payroll API calls to NestJS and isolated MongoDB. It verifies ten-column presentation, visible stale status, zero-TDS inclusion, KPI selection changes, draft save, page reload/month reopening, submission confirmation, finalized MongoDB record and PDF generation. Browser identity and employee directory are test fixtures; authentication and organization isolation are covered separately by existing regressions. No customer payroll was submitted.

The unchanged salary engine and existing tax engine suites continue to cover nonzero statutory contributions, formulas, Old/New regime calculations, annual allocation/rounding, tenant boundaries, authorization, version conflicts, duplicate/concurrent submission and PDF persistence failures.

Commands used:

```powershell
$env:RUN_PAYROLL_MONGO_TESTS='1'
$env:RUN_TAX_MONGO_TESTS='1'
$env:RUN_PAYROLL_BROWSER_TESTS='1'
npm.cmd test -- --runInBand src/run-payroll src/income-tax src/tax-configuration src/employee-tax-profile src/payroll-generator
npm.cmd run build
npm.cmd run lint

# In D:/projects/payroll-frontend
npm.cmd test -- --watch=false
npm.cmd run build
```

Final results: all 22 backend suites and 212 tests passed with MongoDB and Edge enabled; all 29 Angular test files and 194 tests passed. Both production builds pass. Backend and frontend diff whitespace checks pass. Angular retains its existing approximately 701 kB initial bundle warning and PDF CommonJS dependency warnings; backend lint retains unrelated existing warnings.

## Current scope

TDS is an optional deduction from the current saved calculation. This change does not add catch-up reconciliation, recompute earlier deductions or alter the existing twelve-month allocation algorithm. Input changes require explicit tax recalculation to apply TDS again; until then otherwise valid payroll proceeds with ₹0 TDS.
