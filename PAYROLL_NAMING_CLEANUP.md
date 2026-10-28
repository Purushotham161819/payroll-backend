# Payroll naming cleanup audit

## Results

Initial genuine spreadsheet-coordinate occurrences: **162**, across eight files. Removed or renamed: **162**. Remaining genuine occurrences: **0**. No production calculation identifier, internal business-data key, API key, test fixture or maintained documentation uses spreadsheet coordinates.

| Modified file | Initial occurrences |
| --- | ---: |
| Backend: `src/salary-components/annual-payroll.ts` | 12 |
| Backend: `src/salary-components/annual-payroll.spec.ts` | 96 |
| Backend: `src/salary-components/payroll.controller.spec.ts` | 2 |
| Backend: `ANNUAL_PAYROLL_ENGINE.md` | 14 |
| Backend: `ANNUAL_PAYROLL_PDF.md` | 12 |
| Frontend: `src/app/payroll/annual-payroll-report.ts` | 12 |
| Frontend: `src/app/payroll/annual-payroll-report.spec.ts` | 2 |
| Frontend: `e2e/annual-payroll-pdf.spec.ts` | 12 |

This report is the ninth added/modified file. Roots are `D:/projects/payroll-backend` and `D:/projects/payroll-frontend`.

## API migration

The annual payroll endpoint now returns descriptive properties within `calculation.annual`: `annualCtc`, `employerEpsContribution`, `employerEpfContribution`, `employerEsiContribution`, `annualGrossWages`, `annualBasicSalary`, `annualDearnessAllowance`, `annualRetainingAllowance`, `annualCoreWages`, `annualTotalAllowances`, `annualExcessAllowance`, and `annualComplianceWageBase`.

All repository consumers were updated together, including the PDF data mapping and fixtures. No external consumer or published external compatibility requirement was identified in either repository. The former compatibility mapping was removed. This is an explicit response-key migration: deploy the backend and frontend together; any separately maintained consumer must adopt the properties above. No database schema or saved record migration is required.

## Search scope and remaining broad-pattern matches

Both repositories were recursively searched, including hidden maintained files, source, controllers, DTOs, interfaces, settings, fixtures, tests, configuration, PDF code and documentation. The broad pattern checks one to three uppercase column letters followed by a positive row number, including an optional absolute-row marker; spreadsheet coordinates outside the original examples were reviewed too. Dependencies, Git internals, generated builds/caches, lockfiles, binary assets and generated test artifacts were excluded from maintained-code counts.

There are no remaining genuine references, so no compatibility exceptions or genuine-reference file/line entries remain. The following broad-pattern matches are unrelated and intentionally unchanged:

| File and line | Classification | Reason retained |
| --- | --- | --- |
| `D:/projects/payroll-backend/ANNUAL_PAYROLL_PDF.md:7` | Documentation | Paper-size designation |
| `D:/projects/payroll-backend/ANNUAL_PAYROLL_PDF.md:19` | Documentation | Paper-size designation |
| `D:/projects/payroll-backend/tsconfig.json:13` | Configuration | ECMAScript compilation target |
| `D:/projects/payroll-frontend/tsconfig.json:14` | Configuration | ECMAScript compilation target |
| `D:/projects/payroll-backend/src/employees/employees.http.spec.ts:37` | Test | MongoDB duplicate-key error identifier |
| `D:/projects/payroll-backend/src/employees/employees.service.spec.ts:50` | Test | MongoDB duplicate-key error identifier |

## Regression verification

- Before changes: all 42 backend tests passed with MongoDB integration enabled.
- After changes: all 42 backend tests passed across 14 suites, including Employee Management and Settings integration tests.
- All 16 Angular unit tests passed across five suites.
- All 10 existing browser tests passed, including Employee Management, Settings, and PDF download, annual values, totals, headings, page dimensions and text bounds for 20 and 70 employees.
- NestJS and Angular production builds passed. Angular retains dependency CommonJS optimization warnings from PDF libraries.
- A temporary differential check compared 288 before/after cases. Every monetary amount, component result, diagnostic and error matched after applying only the response-key rename.
- Existing tests and expected numeric results were retained. Formulas, contribution rates, allowance classification, bases, annual/monthly arithmetic, rounding, dependency handling, database records and PDF rendering/styling were not changed.
