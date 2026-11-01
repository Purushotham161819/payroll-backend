# Pay Check PDF layout

## Presentation changes

New pay checks use portrait A4, white paper, black text, subtle grayscale rules, consistent margins and embedded Noto Sans regular/bold fonts. The fonts render the rupee symbol, while INR amounts use Indian grouping and two decimal places.

Organization name and available address lines appear once at the top left. Empty Address Line 2 is omitted. City, state, postal code and country are joined only when present, so missing values do not produce extra commas or null/undefined placeholders.

Employee ID and snapshot employee name appear on the left, alongside right-aligned payment information. The pay period is formatted as a month/year and Payment Date as `DD-MMM-YYYY`. The saved Run Payroll Payment Date is used, not submission time. Net payment appears both in the payment information and prominently at the end.

Earnings/allowances and deductions are separate two-column tables. Component names and amounts come directly from the finalized check input. Long names wrap, tables continue across pages with repeated headings, page numbers are printed, and the deduction total/final net payment are adjacent footer rows on the last page. The existing payment-not-confirmed wording is retained.

## Authoritative values and visibility

Total Earnings and Allowances uses `check.grossPay`, Total Deductions uses `check.deductions`, and Net Payment uses `check.netPay`. The formatter does not sum visible rows, reevaluate formulas or derive a new net payment. Totals remain the finalized aggregate even when a component is hidden; there is no residual/other row exposing a hidden amount.

Components are listed only when their snapshot `showInPayslip` is exactly true. This applies to earnings, allowances and deduction components. Hidden names and individual amounts are not rendered elsewhere. Employer EPF/EPS/ESI aggregate amounts are not rendered as employee deductions; no employer-contribution row is manufactured.

The existing tax postprocessor appends a synthetic `Income Tax / TDS` component. The formatter identifies that appended component using its position/name/category and saved tax amount, removes it from the ordinary deduction list, and displays it once as TDS. Visibility of that source row is respected. The existing zero convention is preserved: a visible calculated zero-TDS row is shown, while an unconfigured zero amount does not create a row. Snapshot deduction/net totals are copied unchanged.

## Organization integration and historical preservation

`RunPayrollService` reads the current active organization's saved address once when generating PDFs for a new submission, using the existing trusted tenant context and shared `organizations` collection. The organization name remains the already validated draft name. Legacy deployments without an organization record retain their existing name behavior and have no fabricated address.

Employee data, salary components, visibility flags, gross, deductions and net are taken from the check snapshot. Only the new PDF's presentation inputs gain the optional address argument. No payroll schema, calculation inputs, hash, status, payment date, organization identifier, employee record or historical calculation is migrated or rewritten.

PDFs remain generated at submission and stored as base64 bytes in the existing atomic payroll aggregate. View/Download still returns those stored bytes. Later organization-name/address, employee-name or salary-configuration changes do not regenerate historical PDFs. Existing historical PDFs keep their original layout.

## Files changed for this task

- `src/run-payroll/payslip.ts`: presentation/layout and optional address input, existing jsPDF/AutoTable pipeline retained.
- `src/run-payroll/run-payroll.service.ts`: trusted scoped address read and forwarding to newly generated PDFs only.
- `src/run-payroll/fonts/`: Noto Sans Regular/Bold, their SIL OFL license and source notice.
- `nest-cli.json`: include font assets in production output.
- `src/run-payroll/payslip.spec.ts`: actual-PDF text, visibility, TDS, address, A4/pagination and raster grayscale assertions.
- `src/run-payroll/run-payroll.integration.spec.ts`, `run-payroll-review.integration.spec.ts`: decode PDF streams for assertions and verify browser View/Download.
- `test/platform.e2e-spec.ts`: real organization-scoped PDF generation, cross-tenant denial and byte immutability after subsequent metadata changes.
- `test/pdf-document.ts`, `test/pdf-inspect.cjs`: isolated PDF.js decoding/raster checks; compressed/font-encoded streams are not treated as plain text.
- `package.json`, `package-lock.json`: PDF.js development dependency for self-contained backend tests and sample rendering; it is not used by production payroll generation.
- `scripts/pay-check-samples.cjs`: reproducible synthetic samples using the existing annual salary engine and TDS postprocessor.
- `artifacts/pay-check-samples/`: generated QA PDFs, preview images and summary JSON.

No frontend source changes were made for this task. Earlier uncommitted organization/TDS/UI work and unrelated edits remain preserved.

## Sample PDFs and inspection

Run `npm run build`, then `node scripts/pay-check-samples.cjs` to recreate the synthetic samples.

| Sample | Pages | Verified |
| --- | ---: | --- |
| `pay-check.pdf` | 1 | Complete address, dynamic earnings/deductions, separate TDS, INR formatting |
| `without-address-line-2.pdf` | 1 | No empty second address line |
| `partial-address.pdf` | 1 | Missing locality fields produce no redundant commas/placeholders |
| `restricted-components.pdf` | 1 | Hidden deduction still affects authoritative totals but its name/individual value is absent |
| `many-components.pdf` | 7 | 100 long dynamic allowance names wrap; headings repeat; final deduction/net totals remain together |

The samples are synthetic QA records, not production employee statements. Standard sample gross is 118,200.00, deductions 8,326.56 and net 109,873.44. The restricted-component sample retains its engine-calculated deduction total 8,404.33 and net 109,795.67 without showing the hidden deduction itself. Applied sample TDS is a fixture value passed through the existing postprocessor, not a hardcoded production tax rule.

Actual PDF bytes were decoded and rasterized. The one-page PDF and last page of the seven-page PDF were visually inspected. Pixel assertions confirm equal red/green/blue channels throughout the rendered sample: no colored headers, backgrounds or text.

## Verification

- NestJS production build passed; font and license assets verified in `dist/run-payroll/fonts`.
- Angular production build passed, with the existing initial-bundle/CommonJS warnings.
- Backend tax/profile/payroll regression: 14 suites, 111 tests passed, two optional browser tests skipped in that broad run.
- A separate run enabled the real Edge payroll workflow: all 8 payroll-review tests passed, including Save, Submit, PDF viewing and byte-for-byte download comparison, and original PDF preservation.
- Platform/Super Admin/organization isolation suite: 19 tests passed, one optional organization browser test skipped. The new test verifies the saved organization address appears in its new PDF, Organization B cannot download Organization A's check, and subsequent name/address/employee changes leave stored bytes and submitted snapshot unchanged.
- Relevant frontend employee/pay-check/payroll suite: 6 files, 31 tests passed.
- PDF-specific tests cover dynamic component order, restricted names and individual values, saved totals, separate/zero/hidden TDS, address omissions, A4 dimensions, multi-page output and actual grayscale rendering.
- `git diff --check` passed.

Existing raw-stream text assertions were updated to inspect decoded PDF text because embedded fonts and compression encode those streams. PDF.js worker processing is isolated from Jest VM teardown; this affects test tooling only. The npm audit reports 26 advisories in the broader dependency tree and none for `pdfjs-dist`; no unrelated dependency remediation was performed.

Payroll formulas, CTC/gross calculations, contributions, TDS, net pay, component visibility configuration, payment dates/statuses, submission protection and historical records were not changed. No commit or push was made.
