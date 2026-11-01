# Statutory deduction settings

Open Settings → Statutory Deductions (`/settings/statutory-deductions` in Angular). All seven fields start blank when no record exists. Annual EPF Ceiling Limit (stored as `wageCap`) and Annual ESI Wage Ceiling Limit (`annualEsiCeilingLimit`) accept non-negative INR amounts with up to two decimal places; the five percentage fields accept finite numbers from 0 through 100. Zero is a valid explicit configuration, never an assumed default. Reset Changes restores the last loaded or successfully saved values. Failed requests retain edits and leave the stored configuration unchanged.

## API and database

- `GET /settings/statutory-deductions`: current settings, or an empty response (parsed as null by Angular) when not configured.
- `PUT /settings/statutory-deductions`: saves the six existing required numeric fields and the optional `annualEsiCeilingLimit`. Omitting the ESI ceiling preserves its existing value. No default ESI amount is assigned. Returns the saved record. Unknown fields, omitted required fields, null, numeric strings, negative values, and percentages above 100 return HTTP 400. Database availability failures return HTTP 503 with a retry message.
- Fields: `wageCap`, optional `annualEsiCeilingLimit`, `epfEmployerContributionPercentage`, `epsEmployerContributionPercentage`, `epfEmployeeContributionPercentage`, `esiEmployerContributionPercentage`, `esiEmployeeContributionPercentage`.
- New MongoDB collection: `statutory_deductions`, using the fixed string primary key `current`. Atomic upserts update the same record; concurrent inserts cannot create duplicates. Mongoose supplies `createdAt` and `updatedAt` timestamps. Requests do not include database metadata.
- Uses the existing MongoDB connection and environment settings. No migration, seeds, credentials, or new dependencies are required. CORS now permits PUT.
- Authentication and audit behavior follow the existing application, which currently has neither an authentication/role system nor an audit logging facility.

## Future payroll foundation

`StatutoryContributionService.calculate(contributionBase, rateField)` reads persisted rates on each call. EPF employer, EPS employer, EPF employee, ESI employer, and ESI employee rates are selected independently. The caller explicitly supplies the applicable base; the service does not automatically use or apply Wage Cap. Its result includes the saved cap for future rule evaluation.

This arithmetic foundation introduces no eligibility, exemption, allocation, wage-definition, effective-date, or rounding rules. Saving settings never changes employee payroll. No statutory rate is seeded or hardcoded into the service.

## Files

Backend additions in `src/statutory-deductions/`: DTO, schema, controller, service, module, contribution calculation service, MongoDB HTTP integration tests, and contribution service tests. Modified `src/app.module.ts` and `src/main.ts`.

Frontend additions in `src/app/statutory-deductions/`: TypeScript component/API service, HTML, CSS, and unit tests. Added `e2e/statutory-deductions.spec.ts`. Modified `src/app/app.config.ts` and the existing Salary Components component's TypeScript, HTML, and CSS to add Settings tabs. Updated `src/app/app.css` so sidebar navigation wraps on narrow mobile screens. Salary Component and Employee behavior is preserved.

## Run and verify

Start MongoDB. In `D:\projects\payroll-backend`, run `npm.cmd run start:dev`. In `D:\projects\payroll-frontend`, run `npm.cmd start`.

- Both projects: `npm.cmd run build`.
- Backend unit tests: `npm.cmd test -- --runInBand`.
- Backend MongoDB integration tests (PowerShell): `$env:RUN_MONGO_TESTS='1'; npm.cmd test -- --runInBand`. Statutory and salary tests use uniquely named temporary databases and remove only their own test data. Employee persistence checks are read-only.
- Frontend unit tests: `npm.cmd test -- --watch=false`.
- Frontend browser tests: start Angular with `node node_modules/@angular/cli/bin/ng.js serve --host 127.0.0.1`, then run `node node_modules/@playwright/test/cli.js test e2e/statutory-deductions.spec.ts e2e/settings.spec.ts`. These UI tests use API fixtures only; backend integration tests verify actual MongoDB persistence and restart behavior.

## Annual ceiling configuration enhancement

The EPF field is renamed in the UI only: the existing `wageCap` property remains
the sole stored/API value, preserving all saved amounts and existing consumers.
The independent `annualEsiCeilingLimit` is stored on the same singleton. No
migration or settings reset is needed. Monetary inputs show the rupee symbol
and Indian currency previews, such as INR 15,000.00 with the rupee symbol.
Blank ESI input means preserve its saved value; an unset ceiling remains unset.

As confirmed by the user, these ceilings are for upcoming calculations. Neither
the current annual engine nor the contribution helper applies ceiling rules.
The Payroll Generator already retrieves the complete settings object, including
both ceilings, and passes it to its calculator. No annual formulas, monthly
conversion, or PDF layout changed. Future calculation work must define ceiling
bases, eligibility, and cap behavior explicitly.

Files changed for this enhancement:

- Backend: `src/statutory-deductions/statutory-deductions.dto.ts`,
  `statutory-deductions.schema.ts`, `statutory-deductions.service.ts`,
  `statutory-contribution.service.ts` (rate-key type only),
  `statutory-deductions.integration.spec.ts`;
  `src/payroll-generator/payroll-generator.service.spec.ts`.
- Frontend: `src/app/statutory-deductions/statutory-deductions.ts`,
  `statutory-deductions.html`, `statutory-deductions.spec.ts`;
  `e2e/statutory-deductions.spec.ts`.
- Documentation: this file.

Verification: both production builds pass; frontend unit tests: 20 passed;
browser tests: 4 passed (statutory settings and annual/monthly PDF checks).
Backend with MongoDB integration enabled: 52 passed, 4 pre-existing failures in
the unchanged Salary Components calculation tests, previously reproduced from
HEAD. Ceiling persistence, restart, independent edits, validation, omitted-field
compatibility, and complete-settings delivery to the calculator pass. Frontend
build retains existing PDF dependency CommonJS optimization warnings.
