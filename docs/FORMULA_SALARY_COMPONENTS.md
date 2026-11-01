# Formula-based salary components

## Usage and syntax
Settings -> Salary Components -> Add/Edit Salary Component now offers Percentage, Fixed Amount and Formula. Formula mode replaces the numeric Calculation Value and Calculation Base controls with an Annual Formula editor. The formula supplies its own bases. Existing Percentage/Fixed Amount behavior and mandatory BASIC/DA/RA percentage rules are retained.

Example annual formulas:
- MIN(Annual Core Wages, Annual EPF Ceiling Limit) * 12%
- MAX(Annual Basic Salary, 15000) * 10%
- annualBasicSalary * 0.10 + 1200
- (annualBasicSalary + annualDearnessAllowance + annualRetainingAllowance) / 100
- annualGrossWages * 0.70
- component_507f1f77bcf86cd799439011 / 2 + annualCtc * .01

Supported variables (case-insensitive; readable labels with spaces are also accepted):
- annualEpfCeilingLimit / Annual EPF Ceiling Limit: saved wageCap in annual INR
- annualEsiCeilingLimit / Annual ESI Wage Ceiling Limit: saved annualEsiCeilingLimit in annual INR
- annualCtc: this employee's Annual CTC
- annualGrossWages: annual Gross Wages solved by the existing engine
- annualBasicSalary, annualDearnessAllowance, annualRetainingAllowance: existing exact annual mandatory-component values
- annualCoreWages: existing annual Basic + DA + RA
- component_<24-character lowercase MongoDB ID>: an active configured component's exact annual value; reference identifiers appear in the editor's help list

Operators: +, -, *, /, parentheses, decimal literals, percentage literals (12% = 0.12) and unary +/- with normal precedence. MIN/MAX accept 2 to 8 arguments and support nested calls. Amounts and constants are annual INR; percentages are expressed explicitly (e.g. * 12 / 100). Display names and changeable custom codes are not formula identifiers. Only MIN/MAX functions are allowed. No other functions, exponentiation, scientific notation, JavaScript, property/index access, strings, comparisons, conditionals, file access, environment access, network access or object access are allowed.

## Safe implementation and existing solver integration
A bounded recursive-descent parser produces an AST. It never invokes eval, Function or a general-purpose scripting engine. An explicit variable/operator allowlist rejects unsafe syntax. The evaluator builds exact rational piecewise-affine expressions a * GrossWages + b and feeds each MIN/MAX branch into the existing annual solver. Branches are verified against the exact solved Gross Wages; ties select the first equal argument deterministically. Missing or multiple valid solutions are rejected, and exploration is limited to 256 branch evaluations. There is no second payroll calculation engine.

The configuration service validates formulas and mixed formula/calculation-base dependency graphs before writing. Missing references, inactive bases, direct/indirect mixed cycles, unsupported expressions and literal division by zero produce HTTP 400 errors. Frontend required/length/character checks provide immediate basic validation, while authoritative server messages are displayed without losing the edited expression. Employee-dependent zero denominators are rejected during payroll calculation, since configuration validation does not have an employee CTC. Invalid or negative component results and currency overflow also fail payroll generation rather than silently becoming zero.

Limits: 1024 characters, 256 tokens, 48 nested parentheses/unary levels, 128 dependency levels and 4096-bit formula rational numerators/denominators. These bound parser recursion and numeric growth.

## Mathematical limitations
The existing annual engine solves payroll equations as linear expressions in Gross Wages; MIN/MAX introduce bounded piecewise-linear branches, each checked by the same solver. Multiplying two wage-dependent values or dividing by a wage-dependent value is rejected before saving. Constant arithmetic and calculations using annualCtc remain supported because CTC is known for each employee. Dependencies inherit wage dependence transitively. Validation is conservative: expressions with cancellations or zero multipliers that could become linear after algebraic simplification may still be rejected. Arbitrary nonlinear formulas remain unsupported; MIN/MAX branches are the only new piecewise operations.

Final aggregates such as Net Pay, Total Allowances, Excess Allowance, statutory contributions and Compliance Wage Base are not formula variables: referencing outputs that depend on component sums could introduce implicit cycles or nonlinear payroll equations.

## Annual/monthly/report behavior
Formula components participate as their configured category: allowances affect existing allowance/compliance equations; deductions enter existing Total Deductions and Net Pay once; earnings use existing earning rules. Annual dependency values retain the engine's exact pre-rounding arithmetic. Annual and monthly component amounts use the engine's existing reporting-only paise rounding and annual-to-monthly conversion. Formulas are never re-evaluated with monthly inputs.

The existing dynamic report pipeline includes formula components by stable component ID automatically. Selection, drag-and-drop ordering, annual/monthly amounts, totals and PDFs use existing mappings. No report implementation changes were needed.

## Persistence and compatibility
A nullable formula definition is added to salary component documents. Formula mode uses calculationValue:null, fixedAmountPeriod:null and neutral annual_ctc base metadata; expression references determine actual bases. Percentage/Fixed Amount configurations clear stale formulas. DTOs accept absent numeric values only in Formula mode; schema numeric requirements are conditional. Existing documents need no migration, and no data reset or destructive migration was performed. Mandatory BASIC/DA/RA components remain percentage earnings. Existing legacy calculator helpers are unchanged; the Payroll Generator's annual engine is the authoritative implementation.

## Files created or modified
Backend:
- src/salary-components/formula-parser.ts (new)
- src/salary-components/formula-evaluator.ts (new)
- src/salary-components/formula-graph.ts (new)
- src/salary-components/formula-parser.spec.ts (new)
- src/salary-components/formula-configuration.spec.ts (new)
- src/salary-components/salary-component.dto.ts
- src/salary-components/salary-component.schema.ts
- src/salary-components/salary-components.service.ts
- src/payroll-generator/annual-payroll.ts
- src/payroll-generator/salary-calculation.service.ts
- src/payroll-generator/formula-payroll.spec.ts (new)
- FORMULA_SALARY_COMPONENTS.md (this document)
Sibling payroll-frontend:
- src/app/settings/settings.ts
- src/app/settings/settings.html
- src/app/settings/settings.css
- src/app/settings/formula-settings.spec.ts (new)
- e2e/formula-components.spec.ts (new)
- e2e/fixtures/formula-payroll.json (new; generated from the actual backend annual engine)

## Actual validation
- Backend production build passed.
- Formula-focused backend tests: 3 suites / 37 tests passed. Includes parser attacks, bounds, DTO/schema checks, HTTP create/get/edit round trips, failed edits preserving saved definitions, mixed dependency cycles, missing/inactive references, exact arithmetic, both employees' annual values, annual/monthly outputs, deduction/Net Pay integration and equivalence to existing percentage allowance calculations.
- Full backend src suite: 17 suites passed, 1 failed, 5 skipped; 101 tests passed, 4 failed, 7 skipped. The same four pre-existing failures remain in untouched salary-components/salary-calculation.service.spec.ts, whose fixtures fail mandatory-component validation. MongoDB-dependent tests remained skipped; persistence tests used a model stub plus real Mongoose schema validation, not a live MongoDB connection.
- Frontend production build passed with the existing PDF-dependency CommonJS optimization warnings.
- Frontend unit tests: 11 files / 40 tests passed.
- Browser tests: 14 passed. Covers formula creation/editing and backend error presentation, actual-engine formula result fixtures in annual/monthly PDF columns, selection/order/totals, required columns, downloads, existing payroll pagination, settings save/reset and mobile layouts. Browser API calls use intercepted fixtures.

No Git commits or pushes were performed for this enhancement.

The MIN/MAX correction, full alias mapping, changed-file list and latest validation results are documented in MIN_MAX_FORMULA_SUPPORT.md. Its validation results supersede the initial implementation counts above.
