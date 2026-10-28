# Mandatory BASIC, DA and RA components

Backend startup ensures one record per protected code in the existing `salary_components` collection: BASIC (Basic Salary), DA (Dearness Allowance), RA (Retaining Allowance). The unique code index and duplicate-key retry prevent duplicate records during repeated/concurrent initialization.

Missing records are created as active, system-defined earnings with Percentage type, an initial Annual CTC base and **null calculationValue**. Null means unconfigured, not zero. Users must enter a percentage from 0 through 100 before payroll generation; zero is valid when explicitly saved. Any permitted existing component can be selected as a base; the components need not all use Annual CTC.

Existing IDs, percentages, selected bases and payslip visibility are preserved. Names are canonicalized and mandatory records become active earnings. Existing fixed formulas are backed up in `legacyCalculation` (type, value, period), then changed to Percentage with a null value requiring user configuration. An amount is never interpreted as a percentage. Reinitialization does not overwrite the backup or existing percentages.

## Model and API

Existing APIs are reused. GET includes `isSystemDefined` and nullable calculationValue for unconfigured mandatory records. The schema permits that state only for mandatory components; ordinary components still require numeric values. Both `isSystemDefined` and `legacyCalculation` are managed by the server and rejected as request fields.

Updates reject protected name/code changes, deactivation, Fixed Amount type and deduction category. Reserved codes cannot be created through POST. There is no DELETE endpoint. Ordinary editing and activation/deactivation remain available.

Settings labels the three components Mandatory, displays Configure percentage when blank, and hides Deactivate. Their names/codes are read-only; type, category and status are locked. Percentage, permitted base and existing payslip visibility remain editable.

## Payroll

The backend SalaryCalculationService and frontend PDF calculator require exactly one active percentage-based earning for each mandatory code. Missing/unconfigured/invalid values block generation with the affected code in the error. Existing dependency ordering, base validation, cycle detection, annual/monthly calculations and visibility rules remain. No contribution rates, eligibility, wage definitions or statutory deductions are invented; NET Pay remains provisional.

## Files

Backend additions: `src/salary-components/mandatory-components.ts`, `mandatory-components.integration.spec.ts`.

Backend modifications in that directory: `salary-component.schema.ts`, `salary-components.service.ts`, `salary-calculation.service.ts`, `salary-components.service.spec.ts`, `salary-components.integration.spec.ts`, `salary-calculation.service.spec.ts`.

Frontend modifications: `src/app/settings/settings.ts`, `settings.html`, `settings.css`, `src/app/payroll/payroll-calculation.ts`, `payroll-calculation.spec.ts`, `e2e/payroll-report.spec.ts`. Added `e2e/mandatory-components.spec.ts`. No new dependencies, collections or employee changes.

## Run and verify

Start MongoDB and restart the backend with `npm.cmd run start:dev`. The upgrade runs automatically; no manual seed/migration command is required. Run `npm.cmd start` in the frontend, then configure BASIC, DA and RA in Settings before generating payroll.

- Both projects: `npm.cmd run build`.
- Backend (PowerShell): `$env:RUN_MONGO_TESTS='1'; npm.cmd test -- --runInBand`.
- Frontend: `npm.cmd test -- --watch=false`.
- Browser: start `node node_modules/@angular/cli/bin/ng.js serve --host 127.0.0.1` in the frontend, then run `node node_modules/@playwright/test/cli.js test e2e/mandatory-components.spec.ts e2e/payroll-report.spec.ts e2e/settings.spec.ts e2e/statutory-deductions.spec.ts`.

Verified: both builds, 31 backend tests, 13 frontend unit tests and all six browser scenarios. MongoDB integration tests cover initialization, repeated/concurrent startup, protected fields, rejected flags, deletion/deactivation rejection, restart persistence, preserved percentages, legacy fixed formulas and dependent BASIC/DA/RA calculations. Browser checks cover percentage editing including zero, refresh, protected fields, ordinary editing, payroll PDFs and both Settings sections. The Angular build retains existing optional jsPDF optimization warnings and succeeds.
