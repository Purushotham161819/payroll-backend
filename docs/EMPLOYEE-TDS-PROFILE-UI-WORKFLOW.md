# Employee Details: Income Tax / TDS UI and profile workflow

## Employee tabs and cards

The employee profile now uses the existing tab ribbon in this order:

1. Employee Details
2. Employment History
3. Income Tax / TDS
4. Pay Checks

The TDS tab retains the existing administrator-only access. Non-administrators do not receive a new route to tax information. Its selected state uses the existing employee route with `?tab=tax`; direct navigation and browser refresh restore the tab. Existing employee URLs remain valid. Switching tabs does not refetch employee records. The tax component is created when first opened and remains mounted while switching tabs, preserving its loaded data and unsaved fields.

The tax screen has three separate responsive cards:

- **Employee Tax Profile**: Financial Year, read-only Annual CTC, Payroll Frequency and backend Calculation Status; derived read-only Tax Regime; all existing applicability/eligibility confirmations and Reason / Review Note. Edit is at the top right; Save and Cancel are at the bottom right in edit mode.
- **Saved Annual Tax Breakdown**: all existing gross, taxable salary, standard deduction, taxable income, tax, rebate, surcharge, relief, cess, annual/monthly/final-month TDS, submitted allocations, remaining estimate, version/source information and slab breakdown. Explicit history loading allows viewing earlier immutable calculations.
- **Salary Taxability Breakdown**: actual Payroll Generator component names/codes, saved taxability classification, annual value, exemption and taxable amount. Before a calculation exists, current component names and configured mappings are shown without inventing monetary amounts. Saved calculations retain their own mappings and names.

All money uses INR formatting. Saved controls are visibly read-only; labels, keyboard navigation, native confirmation dialogs and narrow-screen table scrolling are preserved.

## Financial year and regime

Available years come from the existing Tax Configuration registry, not hardcoded options. Initial loading resumes the employee's most recently updated saved profile year, if present; otherwise it uses the configured active year or first available year.

The backend returns `regimeSelection` in the employee tax summary. It resolves only published configurations for that year. The same resolution is enforced when saving:

- A new profile with one published regime automatically uses that regime.
- No published regime prevents an invalid save and gives a clear configuration message.
- **The user explicitly selected this rule:** if both Old and New Regimes are published, a new profile requires a single configured regime. No default regime is chosen arbitrarily.
- An existing profile retains its saved regime while that regime has a published configuration. An unavailable saved regime requires configuration review; the application does not silently switch it.
- A submitted client regime that differs from the derived regime is rejected.

After saving, Financial Year remains locked in both read-only mode and ordinary Edit mode. The profile's year is its existing employee/year key, not an editable field.

**Change Financial Year** is a separate confirmed action. It validates the current source profile/version and the target year's configuration. It opens an existing target profile or allows creation of a distinct target-year profile through the existing employee/year collection and unique key. It never rewrites the source profile's year, calculations, audit history or payroll records. Cancelling an unsaved new-year profile returns to the source; cancelling an edit to an already-saved target restores that target's saved values.

## Edit, Save, Cancel and calculation

Saved profiles load read-only. Clicking Edit explicitly obtains a backend permission and enables only editable profile facts. Year and regime remain locked. Cancel restores the last saved values and discards the client-held editing permission. A successful Save increments the existing profile version and appends the existing audit entry; failures retain the entered values for review or retry.

An ordinary HTTP update to a saved profile is rejected without a valid explicit-edit permission. The permission is signed, expires after ten minutes, and is bound to the organization, employee, year, profile version and authenticated actor. A successful version increment makes the old permission unusable. Financial-year changes use a separate permission bound to the source version and target year. Client payloads cannot use these permissions for a different actor or context.

These are short-lived stateless permissions. No edit collections, persisted edit locks or schema migration were added. Production uses the application's existing `SESSION_SECRET`; isolated test applications without the HTTP security bootstrap use a process-local random signing key. A restart/secret change invalidates outstanding permissions, requiring Edit again. Merely entering Edit does not change the profile version or stale a calculation.

Existing explicit calculation behavior is retained. Opening the tab, reading history, switching tabs, selecting a year and clicking Edit do not calculate tax. Calculate Annual TDS calls the existing calculation endpoint only after the profile is saved. Saving changed facts advances the existing profile version, so the existing status resolver marks prior calculations stale. Payroll continues to apply zero TDS for missing/stale records and the authoritative saved amount only for current Calculated status.

## API and backend changes

Existing summary, profile, calculation and history URLs remain. The following additive endpoints support the explicit workflow:

| Endpoint | Purpose |
| --- | --- |
| `GET /employees/:id/income-tax` | Discover saved profile years for that tenant-owned employee |
| `POST /employees/:id/income-tax/:year/edit` | Begin explicit editing with the saved profile version |
| `POST /employees/:id/income-tax/:year/change-year` | Confirm a validated source/target year workflow |

The existing `PUT /employees/:id/income-tax/:year` now derives/validates regime, requires an edit permission for existing profiles, and requires a year-change permission before creating an additional year profile through the UI API. This deliberate tightening enforces the requested lock against ordinary API updates. It preserves all existing fact validation, version/CAS checks, tenant ownership, administrator authorization and audit limits.

No tax formula, allocation algorithm, salary formula, published configuration, payroll schema or finalized snapshot was changed. No customer record was migrated or edited.

## Files changed for this request

Frontend in `D:/projects/payroll-frontend`:

- `src/app/employees/profile-tabs.ts`
- `src/app/employees/employee-profile.ts`
- `src/app/employees/employee-profile.html`
- `src/app/employees/profile-enhancements.spec.ts`
- `src/app/features/tax-management/employee-tax.ts`
- `src/app/features/tax-management/employee-tax.html`
- `src/app/features/tax-management/employee-tax.css` (new)
- `src/app/features/tax-management/tax-api.ts`
- `src/app/features/tax-management/tax-management.spec.ts`
- `src/app/features/tax-management/employee-tax-workflow.spec.ts` (new)

Backend:

- `src/employee-tax-profile/employee-tax-profile.service.ts`
- `src/income-tax/tax.controller.ts`
- `src/income-tax/income-tax.module.ts`
- `src/income-tax/income-tax.service.ts` (summary metadata only; calculation and payroll deduction code unchanged)
- `src/employee-tax-profile/employee-tax-workflow.integration.spec.ts` (new)
- `test/employee-tax-ui.cjs` (new isolated browser verification)
- This report.

Existing unrelated changes were preserved. Nothing was committed or pushed.

## Verification results

- **Frontend:** 31 test files, 211 tests passed. New tests verify initial enabled-year/derived-regime behavior, no automatic calculation, single save, saved lock, explicit Edit, Cancel restoration, year-change confirmation, cancelling a new target and editing/cancelling an existing target, missing/ambiguous configuration, failed saves and explicit calculation.
- **Backend:** 23 relevant suites, 221 tests passed with MongoDB and the existing Edge payroll regression enabled. New API tests reject ordinary-update bypass, year/regime injection, tampered or actor/version-mismatched permissions, missing/unpublished configuration and cross-tenant access. They verify distinct-year creation, retained audit, no calculation on reads/Edit, explicit calculation, stale-after-save behavior and unchanged finalized checks/PDF bytes.
- **Builds:** Angular and NestJS production builds passed. Backend lint passed with existing unrelated warnings. Angular retains the existing initial-bundle warning (approximately 717 kB versus a 500 kB warning budget) and PDF CommonJS dependency warnings.
- **Real Edge workflow:** the production frontend was served against an isolated Nest application/MongoDB database. The test covers direct `?tab=tax` navigation, four-tab order, save/lock, tab switching without another employee fetch, Edit/Cancel, explicit calculation, annual/component breakdowns, stale-after-edit behavior, year-change confirmation/cancellation, refresh, and desktop/mobile layout with no uncaught browser errors.
- The synthetic published test configuration produces ₹2,000 monthly TDS for the fixture. The real payroll API applies ₹2,000 when Calculated, applies ₹0 after a saved edit makes it stale, and leaves the previous submitted payroll and PDF unchanged. This is test data, not a production rate or configuration.
- Browser identity and employee-directory reads are fixture adapters; tax/profile/configuration/payroll endpoints use real backend services. All writes use generated isolated test databases. Cleanup checks each exact database name and test prefix. Customer payroll was not submitted.

Screenshots are generated under `.tmp/employee-tax-ui/`. The browser script also checks that reading calculation history does not invoke the calculation endpoint.

Commands:

```powershell
# Frontend
npm.cmd test -- --watch=false
npm.cmd run build

# Backend
$env:RUN_PAYROLL_MONGO_TESTS='1'
$env:RUN_TAX_MONGO_TESTS='1'
$env:RUN_PAYROLL_BROWSER_TESTS='1'
npm.cmd test -- --runInBand src/run-payroll src/income-tax src/tax-configuration src/employee-tax-profile src/payroll-generator
npm.cmd run build
npm.cmd run lint
node test/employee-tax-ui.cjs
```
