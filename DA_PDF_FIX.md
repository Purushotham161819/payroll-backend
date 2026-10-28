# DA missing from the payroll PDF

## Root cause and correction

MongoDB and the running GET `/salary-components` API both confirmed one active Dearness Allowance (DA) earning, calculated as 10% of the saved BASIC component. Its `showInPayslip` flag was **false**.

The annual dependency resolver was correctly calculating DA and including its monthly amount in earnings. `monthlyPayroll` deliberately excludes hidden components from `visibleComponents`; the PDF builds its columns dynamically from that list. DA was therefore excluded by configuration before table rendering, not clipped by table width.

The existing PATCH `/salary-components/:id` API was used to set only DA's `showInPayslip` to true. Identity, name, code, calculation type, rate, base, category and status were checked unchanged. No employee record, other component or collection was changed, and no component was created. The saved correction persists normally in MongoDB.

No special DA column, fixed percentage, formula change or PDF layout change was needed. The current landscape/grouped layout handles the newly visible column. If visibility is deliberately disabled again in Settings, the column will be hidden while DA remains in earnings totals, as required by the existing visibility setting.

## Files and verification

Added frontend `e2e/da-payroll.spec.ts` and this investigation document. Existing application calculation and rendering code is unchanged.

The new regression checks parse downloaded PDFs for 24 fixture employees with different CTC values, visible DA in compact and grouped layouts, repeated headers, monetary text staying within page boundaries, correct monthly DA values and totals. At a configured BASIC rate of 40% and DA rate of 10% of BASIC, test CTCs of 12 lakh and 6 lakh yield monthly DA of 4,000 and 2,000 respectively. These are test fixtures, not hardcoded application values. Another test hides DA and verifies the same earnings totals with no individual DA column.

A read-only live-data browser check verifies the saved DA column appears in an actual generated report and compares employee/component records before and after generation to ensure neither changed. That test requires the local backend and at least one employee with a valid payroll configuration. It uses `http://localhost:4200`, matching the existing CORS configuration.

Both Angular and NestJS builds pass, along with 13 frontend unit tests and the combined ten browser scenarios for DA, payroll PDFs, mandatory components, Salary Components and Statutory Deductions. The Angular build retains the pre-existing optional jsPDF dependency optimization warnings.

To rerun: start MongoDB and the backend (`npm.cmd run start:dev`), start Angular (`npm.cmd start`), then in the frontend run `node node_modules/@playwright/test/cli.js test e2e/da-payroll.spec.ts e2e/payroll-report.spec.ts e2e/mandatory-components.spec.ts e2e/settings.spec.ts e2e/statutory-deductions.spec.ts`.
