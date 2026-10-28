# Statutory deduction settings

Open Settings → Statutory Deductions (`/settings/statutory-deductions` in Angular). All six fields start blank when no record exists. Wage Cap accepts non-negative INR amounts with up to two decimal places; the five percentage fields accept finite numbers from 0 through 100. Zero is a valid explicit configuration, never an assumed default. Reset Changes restores the last loaded or successfully saved values. Failed requests retain edits and leave the stored configuration unchanged.

## API and database

- `GET /settings/statutory-deductions`: current settings, or an empty response (parsed as null by Angular) when not configured.
- `PUT /settings/statutory-deductions`: saves all six required numeric fields. Returns the saved record. Unknown fields, omitted fields, null, numeric strings, negative values, and percentages above 100 return HTTP 400. Database availability failures return HTTP 503 with a retry message.
- Fields: `wageCap`, `epfEmployerContributionPercentage`, `epsEmployerContributionPercentage`, `epfEmployeeContributionPercentage`, `esiEmployerContributionPercentage`, `esiEmployeeContributionPercentage`.
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
