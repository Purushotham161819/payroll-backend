# MIN/MAX, readable payroll variables and percentages

## Root cause and correction
The initial formula grammar allowed arithmetic with compact internal identifiers only. It intentionally rejected calls, commas and percent signs, had no mapping for spaced labels, and did not expose statutory ceiling settings. Its affine evaluator also could not correctly choose MIN/MAX alternatives before Gross Wages was solved.

The exact requested expression is now supported:

    MIN(Annual Core Wages, Annual EPF Ceiling Limit) * 12%

It resolves to MIN(annualCoreWages, annualEpfCeilingLimit) * 0.12. Annual Core Wages comes from the existing exact annual calculation. Annual EPF Ceiling Limit comes from the saved statutory wageCap value, in its existing annual INR units. No default ceiling, rate or implicit annualization is introduced. Missing settings cause a named validation error rather than zero.

## Supported syntax and variables
MIN and MAX are case-insensitive, accept 2 to 8 arguments, and can be nested. Percentage literals such as 12%, 0.75% and .5% are divided by 100 exactly. Percent is a numeric-literal suffix, not a modulo operator; use an explicit /100 for compound percentage expressions. Existing arithmetic, parentheses, decimal literals and unary +/- remain supported.

Explicit stable variable mapping (labels and internal keys are case-insensitive; extra whitespace between label words is accepted):

| Readable label | Internal key | Existing source |
| --- | --- | --- |
| Annual CTC | annualCtc | Employee annual CTC |
| Annual Basic Salary | annualBasicSalary | BASIC calculation |
| Annual Dearness Allowance | annualDearnessAllowance | DA calculation |
| Annual Retaining Allowance | annualRetainingAllowance | RA calculation |
| Annual Gross Wages | annualGrossWages | Solved annual Gross Wages |
| Annual Core Wages | annualCoreWages | Existing annual Basic + DA + RA |
| Annual EPF Ceiling Limit | annualEpfCeilingLimit | Statutory wageCap |
| Annual ESI Wage Ceiling Limit | annualEsiCeilingLimit | Statutory annualEsiCeilingLimit |

Custom salary components continue to use component_<MongoDB ID>, preserving references through display-name changes. Arbitrary component display names are not guessed. Unknown identifiers, unsupported functions and unavailable values fail clearly. Final aggregates such as Net Pay remain unavailable as formula inputs to avoid implicit dependency cycles.

## Integration and safety
The same parser, dependency graph and exact-ratio evaluator are extended. Calls are AST nodes with a strict MIN/MAX allowlist; no eval, Function, property access, objects or dynamic application access is used. Configuration validation includes every function argument when checking references, inactive bases, mixed dependency cycles, arity and nonlinear arithmetic.

MIN/MAX produce piecewise-affine expressions in Gross Wages. Each possible function branch is fed into the existing annual equations, including the existing zero/positive excess-allowance branches. Every resulting solution must satisfy all MIN/MAX comparisons at the exact solved Gross Wages. Equal values select the first equal argument deterministically, avoiding duplicate solutions at boundaries. Missing or multiple valid solutions are rejected. The wrapper performs at most 256 branch evaluations; the existing parser, numeric and dependency limits remain. Same-slope alternatives can be resolved directly without exploring branches.

The existing equations, statutory settings, existing component rules and paise rounding are preserved. Formula allowances affect allowance/compliance sums according to existing category rules. Formula deductions affect Total Deductions and Net Pay once. Monthly values continue to derive from annual results; the formula is not evaluated again on monthly inputs. Report selection, ordering, totals, PDF styling and downloading use the existing pipeline unchanged.

General nonlinear arithmetic (multiplying two wage-dependent expressions or dividing by a wage-dependent expression) remains unsupported. Validation is conservative about cancellation. Highly complex MIN/MAX graphs exceeding the branch limit fail with an instruction to simplify the formula. Singular/ambiguous payroll systems fail instead of selecting an arbitrary answer.

## Files changed for this correction
Backend:
- src/salary-components/formula-parser.ts
- src/salary-components/formula-evaluator.ts
- src/salary-components/formula-graph.ts
- src/salary-components/formula-configuration.spec.ts
- src/salary-components/formula-minmax.spec.ts (new)
- src/payroll-generator/annual-payroll.ts
- src/payroll-generator/formula-minmax-payroll.spec.ts (new)
- FORMULA_SALARY_COMPONENTS.md
- MIN_MAX_FORMULA_SUPPORT.md (this document)
Sibling payroll-frontend:
- src/app/settings/settings.ts
- src/app/settings/settings.html
- src/app/settings/formula-settings.spec.ts
- e2e/formula-components.spec.ts
- e2e/fixtures/formula-payroll.json (regenerated from the backend annual engine with the exact requested formula and configured wageCap)

Prior Formula enhancement changes remain intact and uncommitted. No database migration or changes to persisted statutory settings were performed. No commits or pushes were made.

## Actual validation
- Backend production build: passed.
- Formula-focused backend tests: 5 suites / 63 tests passed. Includes exact requested syntax, above/below ceiling values, statutory units, aliases/case/whitespace, MIN/MAX/nesting/percentages, invalid arity/functions, unavailable settings, dependency cycles, allowance/compliance equations, tie handling and bounded branch exploration.
- Full backend src suite: 19 suites passed, 1 failed, 5 skipped; 127 tests passed, 4 failed, 7 skipped. Four failures remain in the same untouched legacy salary-components/salary-calculation.service.spec.ts whose fixtures fail mandatory-component validation. Database-dependent suites remain skipped.
- Frontend production build: passed with existing PDF-dependency CommonJS optimization warnings.
- Frontend unit tests: 11 files / 40 tests passed, including save/edit payloads using the requested MIN expression and a readable MAX expression.
- Browser tests: 14 passed. Includes entering/saving/editing the exact expression, annual/monthly formula values and totals in PDFs, column selection and ordering, existing payroll downloads, pagination, statutory settings and mobile layouts. PDF fixtures were generated by the real annual engine; browser requests use intercepted fixtures. No live MongoDB end-to-end run was performed.
