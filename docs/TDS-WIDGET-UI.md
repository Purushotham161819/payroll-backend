# Income Tax / TDS widget presentation

Implemented 1 November 2026. No changes were committed or pushed. Existing uncommitted Employee Details and Pay Checks work was preserved.

## UI changes

- Calculate Annual TDS now appears immediately below the heading and introduction, before the widgets. There is one Calculate button. Its original `calculate(form)` handler, enablement checks, title/loading behavior and save-before-calculate workflow are retained.
- Employee Tax Profile is a standalone card with six facts: saved/read-only status, Financial Year, Annual CTC, Payroll Frequency, Calculation Status and Tax Regime. The year remains locked under the existing restrictions; regime remains derived and read-only. Calendar and pencil icon buttons call the existing Change Financial Year and Edit methods.
- Employment During Current Financial Year is a sibling card. It contains every existing scenario, previous-employer input, exemption-verification condition, eligibility confirmation and Reason / review note. Available saved projection details were moved from the breakdown to this card using their original snapshot values: annual CTC, financial-year start, hire/current employment dates, eligible months, pro-rated CTC, projected current gross and previous-employer values.
- Employment Edit, Save and Cancel use the existing versioned tax-profile workflow. The top card's Edit icon opens that same existing draft. The page retains one NgForm and one profile save rather than creating competing editor state or duplicate API calls. Financial Year is standalone within the form, preserving its previous exclusion from form validation. Read-only metadata is not sent as editable salary/financial-year inputs.
- Unsaved employment edits are protected by the existing profile route-departure guard and browser unload handling. Switching tabs retains the mounted TDS component and its draft.
- Saved Annual Tax Breakdown keeps its original result values and remaining-allocation information. Regime, legislation, last-calculated timestamp, configuration version and profile version now use a labelled metadata grid. The configuration identifier remains visible with a concise information tooltip.
- Salary Taxability Breakdown, immutable calculation-history selection, slab dialogs and their existing actions remain available.

## Components and files

- `payroll-frontend/src/app/features/tax-management/employee-tax.html`: card/form organization, top Calculate action, icon controls, projection relocation and metadata layout.
- `payroll-frontend/src/app/features/tax-management/employee-tax.css`: existing PayStream card dimensions, typography, grid, responsive presentation and removal of superseded styles.
- `payroll-frontend/src/app/features/tax-management/employee-tax.ts`: import the shared tooltip and expose unsaved-change/unload protection; existing methods are unchanged.
- `payroll-frontend/src/app/employees/employee-profile.ts`: include mounted TDS draft changes in existing route-departure protection.
- `payroll-frontend/src/app/shared/information-tip.ts`: reusable information icon with a CDK tooltip overlay supporting hover, keyboard focus, tap, Escape and outside dismissal. Hover can continue onto the tooltip. Overlays mount outside card/table overflow containers and remain within the viewport; no animation is introduced.
- `payroll-frontend/src/app/shared/action-icon.ts`: add a calendar glyph to the existing icon component; reuse existing information, edit, save and cancel glyphs.
- `payroll-frontend/src/app/features/tax-management/employee-tax-workflow.spec.ts`: add widget hierarchy/order and unsaved-change checks while retaining existing workflow and validation tests.
- `payroll-frontend/e2e/tds-widgets.spec.ts`: production-browser coverage for layout, tooltips, permission-based edit/save/cancel, unchanged previous-employer values, review-note persistence, explicit calculation, immutable historical snapshots, history/slabs, year restrictions and mobile layout.
- `payroll-backend/docs/TDS-WIDGET-UI.md`, `docs/README.md`: this implementation report and documentation link.

## Preservation evidence

An automated before/after template comparison confirmed all named input/select/textarea controls were retained. A TypeScript AST comparison confirmed **zero changed existing EmployeeTax methods**, including validation, save, cancel, year selection, permission requests, calculation and history loading. The only added methods provide UI unsaved-change protection.

TaxApi, DTOs, backend implementation, tax rules/formulas, payroll calculations, database schemas and stored application data were not modified. Editing a profile continues to use the existing version/permission tokens and status rules. It does not recalculate tax or rewrite historical snapshots; the explicit Calculate action retains its existing calculation/history behavior.

## Verification

| Check | Result |
| --- | --- |
| Angular production build | Passed |
| Full frontend unit suite | 36 files, 265 tests passed |
| Backend TDS/profile/payroll regression | 4 suites, 34 tests passed; 2 opt-in browser checks skipped |
| Final production-browser regression | 9 tests passed |
| Existing EmployeeTax method AST comparison | No existing methods changed |
| Diff whitespace checks | Passed; existing line-ending normalization notices remain |

The backend run enabled `RUN_TAX_MONGO_TESTS=1` and `RUN_PAYROLL_MONGO_TESTS=1`. An initial run hit the existing 5-second payroll fixture setup timeout while builds were running; the same assertions passed on retry with `--testTimeout=30000`. No backend code or expected results were changed. An intermediate overlapping build also encountered a font-copy file lock; the final serialized production build completed successfully.

The production-browser tests served the newly built Angular assets through a temporary local preview, using mocked browser API writes. Backend integrations used isolated QA databases. The temporary preview was stopped after validation. Desktop/mobile screenshots were visually inspected and remain under the ignored backend `.tmp/tds-widgets-final` and `.tmp/tds-widgets-browser` directories.

The build retains bundle-size, existing Run Payroll stylesheet and PDF-dependency CommonJS warnings. The updated TDS stylesheet is approximately 4.01kB, 10 bytes above its 4kB warning threshold and below the unchanged 8kB error threshold; the initial bundle is approximately 779.19kB, below its unchanged 1MB error threshold. No warning/error budgets or dependencies were changed. NestJS production build was not required because backend production code was untouched. The previously documented unrelated full-backend-suite failures remain outside this task.
