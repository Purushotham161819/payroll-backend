# Dynamic salary components in payroll reports

The configuration service already persists and retrieves optional components, and the annual engine already resolves their configuration and returns annual/monthly amounts keyed by componentId. The frontend discarded that array: annual and monthly reports enumerated only twelve aggregate cells, and the PDF assumed twelve money columns. No calculation-engine change was necessary.

The dialog retrieves active salary components from GET /salary-components on every opening. Required system components remain checked and disabled. Optional components default to selected; Select All and Deselect All affect optional selections. Loading failures prevent generation. Empty optional selection is valid.

POST /payroll/annual accepts { selectedComponentIds: string[] }. IDs must identify active configured components. The service returns ordered reportComponents metadata, always including required components. Omitted selection includes all active components. GET /payroll/annual remains compatible, with additive metadata. All calculations still use the complete configuration, independent of selection; calculation.components is deliberately not filtered.

The frontend joins reportComponents.componentId to calculation.components.componentId. Optional columns follow the mandatory component columns in configuration creation order, before Core Wages. Names are labels only. Missing, duplicate or invalid calculated cells fail generation rather than appearing as zero. Totals sum reported paise. Monthly optional columns use the annual engine's existing monthly values; aggregate monthly conversion remains unchanged. PDF column widths use the actual heading count within the original landscape A4 layout.

Files changed in backend:
- src/payroll-generator/payroll-generator.service.ts
- src/payroll-generator/payroll-generator.controller.ts
- src/payroll-generator/payroll-generator.controller.spec.ts
- src/payroll-generator/component-selection.spec.ts (new)

Files changed in sibling payroll-frontend:
- src/app/payroll/annual-payroll-report.ts
- src/app/payroll/monthly-payroll-report.ts
- src/app/payroll/payroll-report.service.ts
- src/app/payroll/payroll-generator.ts
- src/app/payroll/payroll-generator.html
- src/app/payroll/payroll-generator.css
- src/app/payroll/component-selection.spec.ts (new)
- src/app/payroll/payroll-generator.spec.ts (new)
- e2e/annual-payroll-pdf.spec.ts
- e2e/monthly-payroll-pdf.spec.ts
- e2e/dynamic-components-pdf.spec.ts (new)

Validation:
- Backend production build: passed.
- Payroll-generator tests: 5 suites, 30 tests passed, including HTTP selection validation, dependent/fixed component mapping and calculation invariance.
- Full backend src suite: 12 suites passed, 1 failed, 5 skipped; 52 tests passed, 4 failed, 7 skipped. The four failures are in untouched src/salary-components/salary-calculation.service.spec.ts; its fixtures fail mandatory BASIC/DA/RA validation. No payroll formulas were changed to accommodate those fixtures. Database-dependent suites remain skipped under their existing conditions.
- Frontend production build: passed with CommonJS dependency optimization warnings from PDF dependencies.
- Frontend unit tests: 8 files, 25 tests passed.
- Playwright PDF tests: 7 passed, including existing annual pagination/download checks, monthly results and selected/empty dynamic columns in both frequencies. Dynamic checks include six optional columns and page bounds.

Annual formulas, dependency resolution, exact-ratio arithmetic, rounding, statutory contributions and employee CTC are unchanged. Browser tests use intercepted saved-data API fixtures; a live MongoDB end-to-end run was not performed.
