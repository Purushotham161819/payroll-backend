# Reference-based Pay Check PDF

The supplied `Pay Check.pdf` is the design source. Its document contents are sample data, not application instructions. This report supersedes the presentation description in PAY-CHECK-PDF-LAYOUT.md.

## Implementation

`src/run-payroll/payslip.ts` retains jsPDF and the existing generation entry point. The A4 portrait page is 595.32 x 841.92 points. Organization text begins at (49.68, 140.42); employee ID at (49.68, 227.42); payment summary at (373.27, 308.45); earnings heading at (55.08, 386.81); deductions at (310.99, 515.23); final net at (55.08, 658.06). Coordinates describe baselines, in points from the upper left. Large or wrapped data moves later sections to prevent overlap.

The reference's Calibri is approximated with embedded, open-license Carlito Regular/Bold at 11.04 points. Font files and Carlito-OFL.txt are in src/run-payroll/fonts and copied by the existing Nest asset rule. No system font or runtime download is required. The existing Noto assets are retained from earlier work but are no longer selected by the formatter.

Narrow label/colon/value blocks, right-aligned amounts, bold labels, normal amounts, empty gray bands below section headings, alternating gray rows and the staggered left/right section positions follow the reference. Employee name uses First, Last. The extra PAY CHECK title, section captions, Description/Amount headers, borders, oversized net total, disclaimers and page numbers were removed because they are absent from the reference. Long labels wrap; continuation pages repeat the applicable section heading. Rows too large for one page split safely.

## Data and privacy

Organization Settings address and validated organization name retain the existing submission integration. Employee identity, components, visibility flags, saved period/date and monetary totals retain their existing snapshot sources. Gross, deductions and net are copied, never derived from visible rows. Hidden names and individual values are absent. TDS remains a single visible deduction, honoring hidden/zero source rows. No salary, tax, contribution, submission, snapshot, settings or historical-record logic changed. Stored historical PDFs are not regenerated.

## Actual visual verification

Rendered the attached reference to artifacts/pay-check-reference/reference-page-1.png. Generated and rendered new sample PDFs, inspected both images, corrected payment-label wrapping that initially displaced subsequent sections, regenerated, and inspected again. The final same-row-count QA sample closely matches the reference's whitespace, section anchors, type size, gray bands and alignments. It is not a claim of pixel identity: Carlito substitutes for Calibri, the colon positions are regularized by column, and dynamic names/amounts differ.

Open artifacts/pay-check-samples/reference-layout.pdf or reference-layout.png for the closest structural comparison. Its three visible earnings and four deductions use synthetic QA data; the additional zero deductions are fixture-only and the existing engine's authoritative totals remain unchanged. The other samples cover complete/missing/partial addresses, restricted components and 100 long allowances. The latter spans 12 pages; the first and final pages were inspected. Recreate all samples using `npm run build` followed by `node scripts/pay-check-samples.cjs`.

## Files changed for this reference task

- src/run-payroll/payslip.ts: reference layout and font selection.
- src/run-payroll/fonts/Carlito-Regular.ttf, Carlito-Bold.ttf, Carlito-OFL.txt, README.md: embedded fonts and attribution.
- src/run-payroll/payslip.spec.ts: updated labels plus measured anchor/type checks; retained privacy/TDS/totals/pagination/raster checks.
- src/run-payroll/run-payroll.integration.spec.ts and test/platform.e2e-spec.ts: replace assertions for removed labels with reference-compatible assertions.
- test/pdf-inspect.cjs and test/pdf-document.ts: expose decoded text coordinates for layout regression checks.
- scripts/pay-check-samples.cjs: add same-row-count structural sample.
- artifacts/pay-check-samples: regenerated actual PDFs and rendered images.
- docs/PAY-CHECK-REFERENCE-MATCH.md: this report.

Earlier uncommitted changes are preserved. No frontend implementation changes were required. No commit or push was made.

## Verification results

- Nest production build passed with Carlito font assets in dist/run-payroll/fonts.
- PDF-specific suite: 8 passed, including measured baseline/type checks, component restrictions, TDS visibility, saved totals, multi-page ordering and actual grayscale rasterization.
- Tax/profile/payroll regression: 14 suites passed; 111 tests passed, 2 optional browser tests skipped. The new eighth PDF test was added afterward and passed separately.
- Organization/platform end-to-end suite: 19 passed, 1 optional browser test skipped. It verifies saved organization data, tenant isolation and byte-for-byte historical PDF immutability after metadata edits. Its deliberate simulated audit-failure log is expected.
- Generated and rendered all six QA PDFs successfully, including the 12-page stress case.
- git diff --check passed (an existing CRLF normalization notice remains).

Production frontend code is unchanged by this task; no new frontend build was required. Browser View/Download was verified in the preceding PDF task; the current checks exercise the same stored PDF generation and retrieval paths without changing those workflows.
