# Employee Tax Profile editing and Save validation

## Findings

The Financial Year select was already rendered unconditionally whenever the profile summary existed. No source-level hide condition or CSS rule removing it in Edit mode was found. Its `busy() || yearLocked()` binding intentionally disables a saved year's select. Consequently it cannot be expanded to inspect available years. Edit preserves the locked year; the separate Change Financial Year workflow remains responsible for changing years.

Entering a positive previous-employer exempt amount activates the existing conditional Required checkbox validator on `previousEmployerExemptionsVerified`. This matches the backend's documented-exemption requirement. The old Save button depended on generic `form.invalid`, without explaining which condition failed. Valid numeric input therefore appeared to disable Save for no reason when verification was unchecked. Amount names, numeric conversion and backend field mapping were consistent. Removing that validator would permit unverified exemptions and conflict with the previously confirmed business rule.

## Fix

The year select now has a stable identifier and associated lock explanation in saved and Edit modes. During editing, an expandable list shows every year loaded from Tax Configuration and marks the current profile year. The dropdown stays visible with the saved year selected. Ordinary editing cannot change the employee/year association or tax regime. The existing Change Financial Year confirmation is retained; users are instructed to Save or Cancel editing before invoking it.

The form now explains why positive exempt wages require documentary verification and displays specific previous-employer validation messages. Save requires a valid form, valid previous-employer values, applicable configuration, and actual unsaved changes. A profile-value comparison ignores hidden previous-employer amounts outside Job Change and does not treat server metadata as an editable input. The save handler also checks these rules, so submitting by keyboard cannot bypass them.

Previous-employer values retain their established requirements: gross, exempt and TDS totals must be supplied for Job Change; zero is accepted, negatives/non-finite/out-of-range amounts are rejected, exempt wages cannot exceed gross, and positive exemptions require verification. Currency precision is now explicitly checked in the UI using the existing backend's two-decimal rule. Optional review notes remain optional while TDS is applicable. Switching to First Job clears prior values and removes their controls and validation. No tax treatment or calculation changed.

## Files changed for this follow-up

In `payroll-frontend`:

- `src/app/features/tax-management/employee-tax.html`: year visibility/lock guidance and configured-year list, validation messages, explicit submit button and Save condition.
- `src/app/features/tax-management/employee-tax.ts`: editable-value comparison, previous-employer validation and consistent Save guards.
- `src/app/features/tax-management/employee-tax-workflow.spec.ts`: real Angular form submission tests covering Edit/year/regime, decimal values, verification, zero, required blanks, negatives, precision, scenario switching, reload and Cancel.

In `payroll-backend`:

- `src/income-tax/mid-year-tds.integration.spec.ts`: additional HTTP/MongoDB regression saving decimal prior amounts through the existing edit permission workflow, verifying the stored document and reloaded values, stale status, and successful explicit recalculation.
- This report.

No backend implementation, API, DTO, schema, engine, salary formula, allocation rule or tax configuration changes were made for this follow-up. Earlier task changes remain in the working tree. Unrelated existing modifications were left intact.

## Verification

- Angular production build passed, with the existing initial-bundle and CommonJS dependency warnings.
- NestJS production build passed.
- Frontend tax-management tests: 6 files, 103 tests passed.
- Backend income-tax/profile/payroll regression run: 10 suites, 83 tests passed, one optional browser test skipped. The run used `RUN_TAX_MONGO_TESTS=1`, `RUN_PAYROLL_MONGO_TESTS=1`, `--runInBand` and `--testTimeout=30000`.
- All seven focused mid-year HTTP/MongoDB tests also passed separately.
- An initial combined run exceeded the existing five-second payroll setup-hook timeout under concurrent build/test load. The rerun passed; no persistent timeout setting was changed.
- `git diff --check` passed.

Coverage confirms valid verified exempt amounts can be saved, persisted, reloaded and edited; Cancel restores saved inputs; changed tax inputs require recalculation; and current-calculation-only payroll deduction and finalized historical snapshots/PDFs remain covered by regression tests. Verification used Angular component tests and isolated real MongoDB/HTTP tests, not a manually operated browser session or production employee records.

No commit or push was made.
