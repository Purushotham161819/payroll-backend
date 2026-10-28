# Employee editing and pay frequency

`PATCH /employees/:id` accepts any subset of the creation fields: `firstName`,
`lastName`, `email`, `dateOfBirth`, `hireDate`, `annualCtc`, and `payFrequency`.
It returns the updated employee with HTTP 200. Omitted fields are preserved.
Email normalization and uniqueness rules also apply to edits. Invalid IDs,
invalid values, null values, and unknown properties return 400; missing employees
return 404; duplicate emails return 409. Database failures return a safe 503.

`Monthly` is the only supported pay frequency. Creation defaults to Monthly,
and Mongoose supplies that default when reading older documents without the
field. Existing records do not require a migration or a bulk write.

The employee directory now has an Edit action. Creation and editing share the
existing dialog, including a Pay Frequency dropdown with one option, Monthly.
The directory displays the frequency, using Monthly for older API records.

The payroll dialog offers Annual Payroll (the default) and Monthly Payroll.
Both retrieve completed annual results from the unchanged `/payroll/annual`
endpoint. Monthly conversion divides each of the 12 annual monetary outputs by
12, rounds once to two decimals using the existing report formatting convention,
and creates separately named monthly fields. Totals sum displayed paise using
BigInt. Annual results are never mutated, and payroll inputs are never divided
before calculation. Unsupported frequencies are rejected rather than silently
mixed in a monthly report. Future frequencies need an explicit conversion rule.

Annual PDF titles, monetary values, headings, filename convention, and layout
remain unchanged. Monthly PDFs use Monthly Payroll Report, Monthly CTC, a monthly
amounts label, and a `Monthly_Payroll_Report_...pdf` filename.

## Changed files

Backend (`src/employees/`):

- `pay-frequency.ts`
- `dto/create-employee.dto.ts`
- `dto/update-employee.dto.ts`
- `entities/employee.entity.ts`
- `schemas/employee.schema.ts`
- `employees.controller.ts`
- `employees.service.ts`
- `employees.integration.spec.ts`
- `employees-edit.integration.spec.ts`

Frontend (`D:/projects/payroll-frontend/`):

- `src/app/employees/employee.ts`
- `src/app/employees/employee.service.ts`
- `src/app/employees/employee-form.ts`
- `src/app/employees/employee-form.html`
- `src/app/employees/employee-form.css`
- `src/app/employees/employee-list.ts`
- `src/app/employees/employee-list.html`
- `src/app/payroll/annual-payroll-report.ts` (response type only)
- `src/app/payroll/monthly-payroll-report.ts`
- `src/app/payroll/monthly-payroll-report.spec.ts`
- `src/app/payroll/payroll-report.service.ts`
- `src/app/payroll/payroll-generator.ts`
- `src/app/payroll/payroll-generator.html`
- `e2e/employee-edit-pay-frequency.spec.ts`
- `e2e/monthly-payroll-pdf.spec.ts`

## Verification

- Backend production build: passed.
- Backend tests with `RUN_MONGO_TESTS=1`: 51 passed, 4 failed; 16 suites passed,
  1 failed. New employee edit integration tests passed against an isolated
  database that is removed after the suite. Application startup and existing
  annual payroll tests passed.
- The four failures are in the unchanged
  `src/salary-components/salary-calculation.service.spec.ts`. They also reproduce
  using service, test, and mandatory-component files extracted from HEAD. Those
  fixtures omit mandatory components required by their existing calculator.
  No changes were made to that unrelated service or its tests.
- Frontend unit tests: 19 passed across 6 files.
- Browser tests: 4 passed (existing annual PDF reports for 20 and 70 employees,
  employee creation/editing with mocked HTTP, and monthly PDF values/totals).
- Frontend production build: passed with existing PDF dependency CommonJS
  optimization warnings.
- Backend lint: passed with warnings.
- Git comparison confirms both annual calculation engines and the decimal
  utility are unchanged.
