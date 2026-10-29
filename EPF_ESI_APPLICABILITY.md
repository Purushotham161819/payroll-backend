# EPF ceiling applicability and employer ESI eligibility

## Agreed scope and defaults
The new checkbox uses isEpfCeilingApplicable consistently in the UI, DTO, schema, settings service and annual engine. It defaults to false because the existing engine calculated employer EPF/EPS on uncapped Core Wages. Existing records without the property are read as false. Saving an omitted property preserves an existing saved choice; first-time omitted values initialize to false. No migration or employee-record change is required.

The user clarified that Employee ESI is out of scope and remains configurable through Add Salary Component. No automatic employee deduction, employee-component identification, rate change or eligibility override was added. Existing salary-component deductions continue following their own configuration.

The user also specified that when both an eligible and an ineligible employer ESI solution are mathematically self-consistent, the eligible employer ESI solution takes priority.

## Employer contribution rules
With isEpfCeilingApplicable=true, both EPS and EPF use MIN(exact annual Core Wages, saved wageCap), multiplied by their existing configured employer rates. With false or an absent property, EPS and EPF retain their previous uncapped Core Wages base. No rate or ceiling amount is hardcoded.

When an Annual ESI Wage Ceiling Limit is configured, employer ESI uses the existing Compliance Wage Base and employer percentage only when Compliance Wage Base <= saved annualEsiCeilingLimit. Above the limit, employerEsiContribution is numeric zero. The comparison is inclusive and uses exact annual values before reporting-only paise rounding. The EPF checkbox does not control ESI eligibility. Existing records without an ESI ceiling retain their previous employer ESI behavior until a ceiling is configured, rather than inventing a limit.

## Exact annual dependency resolution
EPF/EPS caps and ESI eligibility affect employer contribution amounts, which affect Gross Wages, Core Wages and Compliance Wage Base. The existing exact-ratio annual equations therefore solve the capped/uncapped EPF, eligible/ineligible ESI and positive/zero excess-allowance branches together. Each solution is checked against its own cap and eligibility conditions and existing MIN/MAX formula constraints.

As approved, eligible ESI solutions take precedence across all valid formula and statutory branches. Other remaining ambiguity still fails rather than choosing arbitrary amounts. Diagnostics expose employerEsiEligible and epfCeilingApplied. Existing formula parsing, salary-component rules, annual rounding, monthly conversion, column selection/order and PDF code are unchanged.

Monthly values continue to derive from the completed annual results. Employee deductions remain independent of employer ESI eligibility; zero employer ESI values are valid in report cells and totals.

## Files changed for this request
Backend:
- src/payroll-generator/annual-payroll.ts
- src/payroll-generator/statutory-eligibility.spec.ts (new)
- src/statutory-deductions/statutory-deductions.dto.ts
- src/statutory-deductions/statutory-deductions.schema.ts
- src/statutory-deductions/statutory-deductions.service.ts
- src/statutory-deductions/statutory-contribution.service.ts (exclude the boolean setting from the contribution-rate key type; its arithmetic remains unchanged)
- src/statutory-deductions/statutory-settings-compatibility.spec.ts
- EPF_ESI_APPLICABILITY.md (this document)
Sibling payroll-frontend:
- src/app/statutory-deductions/statutory-deductions.ts
- src/app/statutory-deductions/statutory-deductions.html
- src/app/statutory-deductions/statutory-deductions.css
- src/app/statutory-deductions/statutory-deductions.spec.ts
- e2e/statutory-deductions.spec.ts
- e2e/statutory-payroll-pdf.spec.ts (new)
- e2e/fixtures/statutory-payroll.json (new; generated using the actual annual engine)

Earlier uncommitted Formula/MIN/MAX work is preserved. No branches, Git history, statutory values or employee records were reset, and no commit or push was performed.

## Actual validation
- Backend production build passed.
- Payroll-generator tests: 9 suites / 64 tests passed, including EPF cap below/equal/above thresholds, uncapped compatibility, ESI below/equal/above ceiling, eligibility preference, formula interactions, numeric zero and unchanged manual employee ESI deductions.
- Full backend src suite: 20 suites passed, 1 failed, 5 skipped; 144 tests passed, 4 failed, 7 skipped. The same four pre-existing failures remain in untouched salary-components/salary-calculation.service.spec.ts, whose fixtures fail mandatory-component validation. Database-dependent suites remain skipped.
- Backend statutory tests passed for checkbox validation, defaulting, save/reload, existing values and old-client compatibility.
- Frontend production build passed with existing PDF-dependency CommonJS optimization warnings.
- Frontend unit tests: 11 files / 41 tests passed, including checkbox load/save/reset and legacy defaults.
- Browser tests: 17 scenarios passed (13 existing settings/formula/order/PDF checks plus 4 new statutory PDF checks). New tests use real-engine fixtures to verify capped EPF/EPS and eligible/noneligible employer ESI in both annual and monthly reports, with exact header/value/total alignment and numeric-zero contributions.

Settings persistence tests use an in-memory model stub, and browser requests use intercepted API fixtures. No live MongoDB end-to-end test was performed. No remaining scope questions: employee ESI is deliberately unchanged per the user's clarification; the approved employer ESI tie-break is implemented.
