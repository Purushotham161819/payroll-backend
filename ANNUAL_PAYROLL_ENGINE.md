# Annual payroll through Compliance Wage Base

`GET /payroll/annual` reads employees, Salary Components and Statutory Deductions without writing them. `SalaryCalculationService.calculateAnnual` is the reusable entry point. PDF generation requests these saved-data calculations; the existing columns and provisional totals remain.

## Equations and solution

All rates below are saved percentages divided by 100. Let C be saved Annual CTC, G Gross Wages, b BASIC rate, d DA rate, r RA rate, e EPS employer rate, f EPF employer rate and s ESI employer rate.

* annualCtc = C
* annualBasicSalary = B = bG
* annualDearnessAllowance = D = dB
* annualRetainingAllowance = R = rB
* annualCoreWages = W = B + D + R = wG, where w = b(1+d+r)
* annualTotalAllowances = A = aG + h, the sum of active components explicitly categorized `allowance`
* annualExcessAllowance = X = max(0, A - G/2)
* annualComplianceWageBase = Q = W + X
* employerEpsContribution = eW; employerEpfContribution = fW; employerEsiContribution = sQ
* annualGrossWages = G = C - eW - fW - sQ

The component dependency graph is resolved symbolically before solving. Each configured component is an affine expression in G. Supported bases are Annual CTC, Gross Wages, Core Wages and another salary component. Monthly fixed amounts multiply by 12 before entering the annual equations. BASIC, DA and RA use the Excel bases regardless of their legacy base metadata; stored metadata is preserved.

Both branches are solved:

* Zero excess: G = C / [1 + w(e+f+s)]. Accept only if aG+h <= G/2.
* Positive excess: G = (C-sh) / [1 + w(e+f+s) + s(a-1/2)]. Accept only if aG+h > G/2.

Require exactly one nonnegative valid candidate. Reject invalid graphs, missing values, duplicate identities/codes, singular/ambiguous systems and infeasible solutions. No iterative approximation or partial convergence is used. Every Excel equation is checked with exact rational arithmetic before reporting; residual tolerance is therefore zero. Currency rounds half up to paise at reporting only. Monthly presentation divides unrounded annual values by 12 and rounds once. Independently rounded displayed cells can differ by a few paise when recombined.

## Configuration decision

The pre-existing model has only `earning` and `deduction`; it does not identify allowances. The additional explicit `allowance` category supplies that distinction without guessing names or reclassifying saved settings. Select Allowance for the components that should enter annualTotalAllowances. Other earnings and deductions do not enter annualTotalAllowances. Hidden allowances still count. An empty allowance set has sum zero. Mandatory BASIC/DA/RA remain earnings and are not counted again.

No wage caps, monthly eligibility rules, employee contribution formulas, new net-pay formulas or PDF columns were introduced. Existing configured deductions and provisional PDF totals remain available for compatibility.

## Changed files

Backend calculation and orchestration: `src/payroll-generator/annual-payroll.ts`, `decimal-ratio.ts`, `annual-payroll.spec.ts`, `salary-calculation.service.ts`, `payroll-generator.service.ts`, `payroll-generator.service.spec.ts`, `payroll-generator.controller.ts`, `payroll-generator.controller.spec.ts`, `payroll-generator.module.ts`. Configuration remains in `src/salary-components/` (`salary-component.schema.ts`, `salary-component.dto.ts`, `salary-components.module.ts`).

Frontend: `src/app/payroll/payroll-calculation.ts`, `payroll-calculation.spec.ts`, `payroll-report.service.ts`, `payroll-generator.ts`, `src/app/settings/settings.ts`, `settings.html`, `e2e/annual-payroll-pdf.spec.ts`, `e2e/mandatory-components.spec.ts`, `e2e/settings.spec.ts`.

## Verification

NestJS build passed. All 42 backend tests passed across 14 suites with MongoDB integration enabled, including Employee Management and saved Settings. All 14 Angular unit tests passed. Angular production build passed with dependency CommonJS optimization warnings from the PDF libraries. Headless Edge checks cover the downloaded PDF contents, mandatory components, salary Settings and statutory Settings. No production employee or configuration records were changed during verification.

The supplied pasted formulas are the specification used; no workbook attachment was available for a separate workbook-to-output comparison.
