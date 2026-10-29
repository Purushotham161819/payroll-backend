# Contribution rate terminology and payroll PDF presentation

> PDF update: the secondary Component Code row has subsequently been removed. See UI_EMPLOYEE_IDS_FORMULA_HELP.md for the current presentation. Codes remain in configuration.

## Labels and compatibility
Statutory Deductions now displays EPF Employer Contribution Rate (%), EPS Employer Contribution Rate (%) and ESI Employer Contribution Rate (%), retaining the existing percent input suffixes, validation and numeric values. The formula variable registry/dropdowns already used the Rate wording and continue to distinguish decimal rate inputs from monetary Employer EPF/EPS/ESI Contribution variables.

Underlying epfEmployerContributionPercentage, epsEmployerContributionPercentage and esiEmployerContributionPercentage fields, schema/API keys, internal formula identifiers, saved values and calculated amount fields were not renamed or changed. No backend implementation or calculation changes were needed for this request.

## Component identification in the PDF
Payroll reports use employees as rows and salary components as columns. The existing component-name header row is retained, and a second header row begins with Component Code in the employee-description column. Each selected salary component's actual configured code is shown directly beneath its name. Aggregate columns such as Gross Wages or ER EPS have blank code cells because they are calculated results, not configured salary components.

The presentation helper joins configuration metadata from components/reportComponents to the report's final columnIds after selection and ordering. Mandatory result columns are linked using the existing mandatoryResultByCode mapping and configured records. Optional columns use their stable MongoDB component IDs. No new list of hardcoded component codes is introduced. Duplicate display names, renaming, reordered optional columns, long codes and special characters remain safe because labels are not join keys.

The response typing adds an optional components metadata property already present in the API response; it does not change the API contract. Legacy responses without component metadata receive blank code cells rather than invented codes. The Component Code row is repeated with the existing table header on subsequent pages.

## Alignment and layout
Every cell in both PDF header rows is centered. Explicit didParseCell alignment takes precedence over per-column styles, preventing monetary-column right alignment from overriding header centering. Numeric body and totals cells are right-aligned; Employee Name values and the descriptive Total label remain left-aligned.

Existing totals, reported paise, annual/monthly conversion, selected/required columns, ordering, fonts, font sizes, colors, column widths, landscape A4 format and downloads remain unchanged. Codes use the existing line-break overflow behavior inside their cell, allowing longer codes to wrap without overlapping adjacent columns. The second header row naturally adds header height; no unrelated layout redesign was performed.

## Files created or modified for this request
Sibling payroll-frontend:
- src/app/statutory-deductions/statutory-deductions.ts
- src/app/statutory-deductions/statutory-deductions.html
- src/app/statutory-deductions/statutory-deductions.spec.ts
- src/app/payroll/annual-payroll-report.ts (metadata typing only)
- src/app/payroll/payroll-report.service.ts
- src/app/payroll/payroll-report-presentation.ts (new)
- src/app/payroll/payroll-report-presentation.spec.ts (new)
- e2e/statutory-deductions.spec.ts
- e2e/ordered-payroll-pdf.spec.ts
- e2e/formula-components.spec.ts
- e2e/conditional-formulas.spec.ts
- e2e/statutory-payroll-pdf.spec.ts
- e2e/pdf-presentation.spec.ts (new)
Backend workspace:
- CONTRIBUTION_RATE_PDF_FORMATTING.md (this document)

Existing uncommitted enhancements remain intact. No Git commit, push, database write or settings migration was performed.

## Actual validation
- Backend production build passed.
- Full backend src tests: 24 suites passed, 1 failed, 5 skipped; 197 tests passed, 4 failed, 7 skipped. The same four pre-existing failures remain in untouched salary-components/salary-calculation.service.spec.ts, whose old fixtures fail mandatory-component validation. Database-dependent suites remain skipped.
- Frontend production build passed, with existing PDF dependency CommonJS warnings. Initial bundle is 500.74 kB, 740 bytes above the 500 kB warning threshold; the configured budget was not changed.
- Frontend unit tests: 14 files / 50 tests passed. New coverage verifies actual configured codes by ID, duplicate names, reordered columns, blank aggregate/legacy code cells, unchanged report input data, header/body/footer alignment rules and the new settings labels with unchanged payloads.
- Browser scenarios: all 26 relevant scenarios passed across runs. The 24 existing management/settings/formula/statutory/order/PDF/download scenarios passed in the combined run; both new PDF presentation scenarios passed in their rerun after correcting test value-column indices to follow the actual code headers.
- The annual and monthly presentation checks inspect generated PDF text geometry: every header line is centered in its cell, long configured codes wrap within bounds, all currency cells (including totals) share the correct right edge, the Total label stays left, duplicate-name component codes remain associated with their values/totals after reordering, and A4 landscape dimensions are retained.

Browser checks use intercepted API fixtures. No live MongoDB run was performed. Remaining issues are the known legacy backend-test failures and the frontend bundle warning described above.
