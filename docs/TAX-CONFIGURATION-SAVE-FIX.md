# Financial Year save bug fix

Date: 31 October 2026.

## Root cause and reproduction

Both Angular's Code `pattern` validator and NestJS's service validation accepted only `[A-Za-z0-9_-]{3,30}`. The reported code, **FY 2026-27**, contains a space. Angular marked that populated control invalid and disabled Save through `yearForm.invalid`; it provided no field-level explanation. The API independently rejected the same payload with HTTP 400. The rule-version value containing periods was not the cause. Native date inputs correctly produced ISO strings; no date conversion defect was found.

Before changing production code, regression tests reproduced:

- The exact populated form kept Save disabled.
- A direct/keyboard-style submit bypassed the disabled button because the submit handler never checked form validity.
- The real NestJS/MongoDB save endpoint returned 400 for the reported year.

## Correction

- Both layers now accept validated 3–30-character codes containing letters, digits, ordinary spaces, hyphens or underscores. Surrounding code whitespace is trimmed; existing underscore/hyphen codes remain valid. HTML's hyphen is escaped for native browser pattern compatibility.
- Required text must contain non-whitespace content. Relevant field errors, code-format guidance and date-range messages are visible. Required tax-master, slab and mapping errors are listed beside their form. Multiline source URLs/review notes remain supported.
- Financial Year and revision handlers mark invalid controls touched and refuse invalid submissions. All Tax Configuration mutations check the in-progress state, covering keyboard submissions and repeated calls as well as disabled buttons.
- Add Financial Year sends optional `createOnly: true`. The backend rejects an existing code with 409 instead of silently updating it. Existing PUT clients that omit this flag retain the existing year-editing contract and its immutability/audit rules.
- Successful creation updates the displayed registry, selects the new year for rule configuration, displays the success notice and resets the creation form. Failed requests retain edits and release the loading state for retry.
- ISO dates, full twelve-month coverage, chronological order, overlap checks, version checks, organization scoping, administrator authorization and immutable referenced years remain enforced.

No payroll formulas, CTC/Gross calculations, statutory formulas, TDS methodology, legal rates, database structures or unrelated screens were changed.

## Related forms checked

The master, slabs and component taxability are one revision form. Valid copied revisions submit with correct partial-mapping bindings and multiline references. Invalid revisions show meaningful errors instead of sending a request. Financial-year and revision activation preserve encoded identifiers (including spaces), prevent duplicate in-progress operations and surface backend validation conflicts.

Confirmed related defects corrected: missing handler-level validity/in-progress guards, whitespace-only required text being accepted by the form, missing validation explanations, populated creation form after successful save, and duplicate Add operations silently entering the API's existing update path. No separate redesign or new year-editing UI was introduced; existing API editing was verified.

## Files changed for this fix

Backend:

- `src/tax-configuration/tax-configuration.service.ts` — matched code validation, normalization and optional create-only protection.
- `src/tax-configuration/tax-configuration.integration.spec.ts` — new real API/MongoDB regression tests.

Frontend:

- `src/app/features/tax-management/tax-configuration.ts` — validity, pending-operation, date/duplicate checks and successful reset.
- `src/app/features/tax-management/tax-configuration.html` — validated spaced codes, inline errors, revision error summary and submission bindings.
- `src/app/features/tax-management/tax-configuration.spec.ts` — new form, network/error, duplicate, revision-copy and activation regression tests.

This report is the only additional documentation file. All prior local changes in both repositories were preserved. No commits or pushes were made.

## Executed verification

| Check | Result |
| --- | --- |
| Original Angular reproduction | 2 tests failed before the correction, demonstrating disabled valid-input Save and invalid-submit bypass |
| Original real API reproduction | 1 test failed before the correction: expected 200, received 400 |
| New Financial Year real API/MongoDB tests | 22 passed |
| Relevant backend tax, Run Payroll and Net Pay suites | 9 suites / 70 tests passed, with tax/payroll Mongo tests enabled |
| Complete Angular regression suite | 26 files / 126 tests passed; new Tax Configuration suite contains 18 tests |
| Angular production build | Passed; existing initial-bundle warning (701.33 kB versus 500 kB warning budget) and PDF dependency CommonJS warnings remain |
| Backend production build | Passed |
| Backend type-aware lint | Passed with warnings; unrelated existing warnings remain |
| Git whitespace checks | Passed in both repositories |

Real browser verification used Microsoft Edge headless with `en-IN` locale and the production Angular build. Authentication was supplied only by a local browser-test fixture; Financial Year requests reached a real isolated NestJS application and disposable MongoDB database. The test used the exact reported name, spaced code, legislation and rule version, and date inputs corresponding to **01-04-2026** and **31-03-2027**. It verified:

1. Save became enabled and native HTML form validation passed.
2. Clicking Save sent one PUT request with `startDate: "2026-04-01"`, `endDate: "2027-03-31"`, the unchanged code `"FY 2026-27"` and `createOnly: true`.
3. The real API returned 200 and MongoDB retained the exact year values.
4. The success notification and new list entry appeared, and the form reset.
5. Entering the same code again showed a duplicate error and blocked another request.
6. No browser page/console errors occurred.

Only disposable test databases were created and removed; no financial year was inserted into the user's customer database. No remaining Financial Year save defect was found in these checks. Existing whole-project backend test failures documented in `INDIAN-INCOME-TAX-TDS-ENGINE.md` were outside this fix; the relevant 70-test run passed without weakening or skipping its tests.
