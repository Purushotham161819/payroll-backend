# Conditional salary component formulas

> Editor update: the optional condition-builder UI has subsequently been removed in favor of the formula text editor and a concise help icon. IF support and the centralized registry remain unchanged. See UI_EMPLOYEE_IDS_FORMULA_HELP.md.

## Editor and syntax
Formula mode now includes an optional Build IF / ELSE panel plus the existing advanced Annual Formula text editor. Users choose a first variable, a comparison operator and a second variable or number, then enter THEN and ELSE expressions. Additional variable selectors insert stable identifiers into either expression. Use condition in formula generates reviewable IF text; Save Component uses the existing save workflow. Switching to or loading Formula fetches backend variable metadata. Metadata failures show a retry action while retaining the advanced editor and existing text.

Supported syntax:

    IF(condition, THEN_expression, ELSE_expression)

Example:

    IF(Compliance Wage Base <= Annual ESI Wage Ceiling Limit,
       Compliance Wage Base * ESI Employee Contribution Rate,
       0)

Comparisons: =, !=, <, <=, >, >=. Arithmetic has higher precedence than comparisons. A comparison is permitted only as the condition of IF; monetary expressions and MIN/MAX arguments must be numeric. IF takes exactly three arguments and can be nested in numeric expressions. Existing arithmetic, unary signs, MIN/MAX, percentages and readable case-insensitive labels remain supported.

Only the chosen IF branch is evaluated for its monetary result. The entire syntax tree and dependency graph are validated before saving and again before annual evaluation, so unknown identifiers, unsupported operators, cycles or structurally invalid arithmetic cannot be hidden in an unused branch. Literal division by zero is rejected by configuration validation even in an unselected branch; employee-dependent division by zero fails if the selected branch evaluates it. No missing value is replaced with zero.

## Central variable registry
src/salary-components/formula-registry.ts is the single source of built-in IDs, labels, aliases, amount/rate types and dependencies. The parser derives identifier and readable-label allowlists from this registry. GET /salary-components/formula-variables combines registry metadata with active configured salary components and the existing saved statutory settings. It reports availability for supported settings and built-in values. The UI shows available entries and excludes the current component ID; save-time graph validation checks the complete proposed configuration.

Supported values include Annual CTC; Basic, DA, RA, Gross and Core Wages; Total Allowances; Excess Allowance; Compliance Wage Base; EPF/ESI annual ceilings; employer EPF/EPS/ESI contribution amounts; saved employer and employee contribution rates; and active configured salary components. Custom component selections use component_<MongoDB ID>, so names may change without breaking formulas. Existing employee EPF/ESI amounts are selectable through their configured component IDs, without guessing their identity from names or codes.

Rate variables return decimal fractions from the existing saved percentage fields: a saved 0.75% becomes 0.0075. The editor labels them as decimal rates. No rate, statutory ceiling or automatic employee deduction is introduced. Missing employee rate settings are not exposed as available. Existing saved zero rates are valid zero values.

## Annual evaluation and aggregate dependencies
The existing safe AST parser/evaluator is extended, without eval, Function, object access, scripts or a second payroll engine. IF conditions with wage dependence use the same bounded piecewise branch-selection mechanism as MIN/MAX. Each branch condition is checked against exact solved annual Gross Wages. The existing employer ESI eligible-solution preference is preserved. Missing/multiple other valid solutions and complexity-limit violations remain errors.

Aggregate inputs are built from existing exact annual definitions: Total Allowances sums active allowance components; Excess Allowance uses the existing MAX(allowances - half Gross Wages, 0); Compliance Wage Base uses Core Wages plus Excess Allowance; employer contribution inputs use the existing configured cap/eligibility rules. Results are cached for dependency resolution. This exposes existing values to formulas without changing their underlying business equations.

The dependency validator expands aggregate references to active allowance components. A deduction may reference Compliance Wage Base; an allowance that directly or indirectly depends on its own allowance sum is rejected as circular. Both IF branches participate in graph validation. Direct component, mixed percentage/formula and aggregate-mediated cycles are rejected.

Monthly component amounts continue to derive from completed annual results with existing reporting-only rounding. Selecting, hiding or reordering a report column does not affect formula evaluation. Existing report data, totals and PDF implementations were reused.

## Limits and compatibility
Only function-style IF is supported: IF(condition, then, else), not statement-style IF THEN ELSE, JavaScript ternaries, AND/OR, assignments, strings or arbitrary functions. General nonlinear products/divisions remain unsupported. Validation is conservative about algebraic cancellation. The existing formula length, token, recursion, rational-number and dependency limits remain, together with at most 256 piecewise branch evaluations.

Net Pay and other final outputs that would introduce circular aggregate dependencies are not exposed as input variables. A component's availability still depends on a valid overall payroll configuration; backend validation remains authoritative when users create or edit dependencies. Existing saved formulas and Percentage/Fixed Amount configurations remain supported. No migration, settings reset, employee-model change or automatic recalculation of statutory policy was performed.

## Files created or modified for this enhancement
Backend:
- src/salary-components/formula-registry.ts (new)
- src/salary-components/formula-parser.ts
- src/salary-components/formula-evaluator.ts
- src/salary-components/formula-graph.ts
- src/salary-components/salary-components.service.ts
- src/salary-components/salary-components.controller.ts
- src/salary-components/salary-components.module.ts
- src/salary-components/formula-if.spec.ts (new)
- src/salary-components/formula-configuration.spec.ts
- src/payroll-generator/annual-payroll.ts
- src/payroll-generator/formula-if-payroll.spec.ts (new)
- CONDITIONAL_FORMULAS.md (this document)
Sibling payroll-frontend:
- src/app/settings/settings.ts
- src/app/settings/settings.html
- src/app/settings/settings.css
- src/app/settings/conditional-builder.spec.ts (new)
- e2e/formula-components.spec.ts (new metadata route fixture)
- e2e/conditional-formulas.spec.ts (new)
- e2e/fixtures/formula-variables.json (new; generated by the metadata service)
- e2e/fixtures/conditional-payroll.json (new; generated by the real annual engine)

Prior uncommitted enhancements were preserved. No Git commits or pushes were performed.

## Actual validation
- Backend production build passed.
- Formula-focused backend tests: 7 suites / 97 tests passed. Covers all comparisons, true/false branches, nested conditions, precedence, lazy evaluation, example ESI rates/annual values, aggregate/employer amounts, invalid syntax/types, missing settings, direct/indirect/unused-branch cycles, metadata availability and create/get/edit persistence behavior.
- Full backend src suite: 22 suites passed, 1 failed, 5 skipped; 178 tests passed, 4 failed, 7 skipped. The same four pre-existing failures remain in untouched salary-components/salary-calculation.service.spec.ts, whose old fixtures fail mandatory-component validation. Database-dependent suites remained skipped.
- Frontend production build passed with existing PDF dependency CommonJS optimization warnings.
- Frontend unit tests: 12 files / 42 tests passed, including backend-driven builder options, stable identifier insertion and generated IF text.
- Browser tests: 22 passed. Covers builder selection, save/edit round trips, true/false conditions in annual/monthly PDFs, amounts and totals after ordering, mandatory/optional columns, existing formula behavior, employer EPF/ESI checks, settings persistence, pagination and downloads.

Backend persistence tests use model stubs plus existing schema tests; browser API requests use intercepted fixtures. Formula/PDF and metadata fixtures were generated from the actual backend implementation. Live MongoDB end-to-end testing was not performed.
