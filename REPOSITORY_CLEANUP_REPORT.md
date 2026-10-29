# Payroll repository audit and cleanup

Audit date: October 29, 2026 (America/Chicago).

The read-only audit was completed before cleanup. Application implementation remains in its existing repositories. Cleanup removed seven empty staging directories and restricted backend Jest discovery to backend source/test directories. No source files were moved, overwritten, or deleted. The frontend needed no source or configuration changes.

## 1. Exact paths removed

Each directory below was inspected with hidden entries included, checked for tracked/untracked files, searched for references in both projects and the preserved staging scripts, and confirmed to be an ordinary directory rather than a junction or symlink. Each was checked again immediately before removal. Removal was nonrecursive and would fail if contents appeared.

| Removed directory | Contents before removal | Reason |
| --- | --- | --- |
| `D:\projects\payroll-backend\frontend-settings` | Empty | No Angular implementation, configuration, or workflow references exist here. |
| `D:\projects\payroll-backend\.component-report-work` | Empty | Unreferenced staging directory. |
| `D:\projects\payroll-backend\.da-report-work` | Empty | Unreferenced staging directory. |
| `D:\projects\payroll-backend\.mandatory-work` | Empty | Unreferenced staging directory. |
| `D:\projects\payroll-backend\.payroll-work` | Empty | Unreferenced staging directory. |
| `D:\projects\payroll-backend\.statutory-work` | Empty | Unreferenced staging directory. |
| `D:\projects\payroll-backend\.tmp-annual-pdf` | Empty | Unreferenced staging directory. |

No files were deleted. Git does not track empty directories, so these directory removals do not appear as deleted Git paths.

## 2. Files moved

None. The active lifecycle component is already at `D:\projects\payroll-frontend\src\app\employees\lifecycle-dialog.ts`, imported by the frontend employee list and its lifecycle tests.

Follow-up correction: the audit inventory also recorded `.lifecycle-frontend/employees/lifecycle-dialog.ts`. The earlier report overlooked that untracked file. The user subsequently confirmed that saving a previously struck-through VS Code tab had recreated this accidental editor snapshot. A fresh comparison found identical TypeScript logic, equivalent template content apart from formatting and the optional void-input closing slash, and equivalent CSS after formatting. With the user's explicit authorization, only that snapshot and its empty parent directories were removed. The authoritative frontend file and all other inventoried work remained unchanged. `.lifecycle-frontend` is absent from the final backend project and was never tracked, so no tracked deletion is needed. The inventory is a historical pre-cleanup record, not a manifest of files to publish.

`frontend-settings` contained no code to move. Older Angular code under `.tmp` is preserved staging/backup material, not an alternate application source root. Replacing the current frontend with it would overwrite newer working code and is not justified.

## 3. Required and uncertain files retained

### Backend staging archive

`D:\projects\payroll-backend\.tmp` contains **232 ignored, untracked files totaling 868,555 bytes**. It includes scripts that stage changes into both repositories, earlier frontend implementations, fixture snapshots, and reverted backend implementations. Content hashes identified 45 files identical to current frontend files; 187 were not byte-identical to any current frontend file. Neither the absence of a matching frontend file nor a duplicate hash alone establishes whether an archived file is disposable.

The archive is retained as a whole to preserve existing uncommitted work and relationships among scripts, snapshots, and fixtures. Its scripts were inspected as text, never executed. In particular, reverted statutory engine code and older payroll-setup screens are not promoted back into either application.

| `.tmp` group | Files | Classification / action |
| --- | ---: | --- |
| Top-level scripts | 17 | Staging/investigation automation; retain. |
| `baseline-salary-components/` | 0 | Empty subdirectory within the preserved work area; leave untouched. |
| `ceiling-eligibility/` | 14 | Calculation/UI staging and test fixtures; retain. |
| `central-frontend/` | 7 | Earlier Angular/payroll setup snapshots; retain. |
| `column-selection/` | 17 | Earlier report-selection implementation/tests; retain. |
| `component-selection/` | 18 | Earlier component-selection implementation/tests; retain. |
| `delete-apis/` | 15 | Backend/frontend staging scripts and UI snapshots; retain. |
| `formula-if/` | 17 | Formula implementation staging, metadata and fixtures; retain. |
| `formula-minmax/` | 12 | Formula implementation staging and fixtures; retain. |
| `formula-ui/` | 8 | Earlier formula editor implementation/tests; retain. |
| `net-pay-ordering/` | 20 | Report ordering implementation/tests; retain. |
| `rate-pdf-format/` | 16 | Report/statutory UI snapshots, including five Playwright `.spec.ts` files; retain outside backend test discovery. |
| `revert-frontend/` | 5 | Frontend rollback snapshots; retain. |
| `reverted-statutory-engine/` | 15 | Reverted backend code, frontend code, tests, and documentation; retain. |
| `settings-refinement/` | 13 | Earlier settings UI implementation/tests; retain. |
| `statutory-engine-work/` | 11 | Earlier frontend statutory/payroll setup snapshots; retain. |
| `ui-identifiers/` | 27 | Employee ID/formula UI/report staging and tests; retain. |

[The audit inventory](docs/repository-audit-inventory.json) records every archived file's exact path, size, SHA-256, classification, observed import strings, Git state, and identical current frontend files where found. Import strings inside generator scripts may describe generated code; they are not claims that every string is a live dependency.

### Generated and project folders

| Paths | Why retained |
| --- | --- |
| Both repositories' `node_modules/` | Installed build, test, and development dependencies. |
| Backend `dist/` | The running Nest process uses `dist/main`; `start:prod` also depends on it. The requested build regenerated it normally. |
| Frontend `dist/` | Production deployment output; regenerated by the requested build. |
| Frontend `.angular/` | Angular cache used by the active development workflow. |
| Frontend `artifacts/`, `test-results/` | Existing browser evidence/output; preserved, with normal test-generated updates during verification. |
| Both `.git/` directories | Repository metadata/history. No history or index entries changed. |
| Frontend `.vscode/` | Tracked launch/tasks/extensions configuration; reviewed and retained. |
| Both `src/`, backend `test/`, frontend `e2e/` and `public/` | Required implementation, tests, PDF font assets, and licensing. |
| Existing root documentation/configuration | Kept, including prior feature reports and API documentation. |
| Backend `src/audit-email.cjs` | Tracked read-only MongoDB audit utility, not frontend code; retained. |

## 4. Architecture findings

- Backend `src/app.module.ts` registers Employees, Salary Components, Statutory Deductions, and Payroll Generator modules. MongoDB schemas, DTO validation, lifecycle APIs, formula parsing/evaluation, statutory logic, and current annual payroll calculation remain in the backend.
- Frontend `src/app/app.config.ts` routes to Employees, Salary Components settings, and Statutory Deductions settings. Angular components, forms, lifecycle dialogs, menus, status filtering, HTTP clients, report column selection/order, fonts, and PDF presentation remain in the frontend.
- The backend's active `src/` and `test/` contain no Angular/Playwright/PDF implementation imports. The frontend's active source/tests contain no NestJS/Mongoose/MongoDB imports. No active source/configuration imports reference the removed directories or `.tmp` implementation snapshots.
- The existing shared-contract approach is JSON APIs: Nest DTOs/schemas on the backend and frontend interfaces such as Employee and AnnualPayrollResponse. There is no shared source package or cross-repository source import. Keep that approach for this cleanup; contract generation could be considered separately if maintaining mirrored interfaces becomes burdensome.
- Frontend reports consume backend annual results, with monthly conversion, formatting, totals, and PDF composition in the frontend. That presentation path remains intact.

### Remaining legacy code requiring a separate decision

- Frontend `src/app/payroll/payroll-calculation.ts` also exports an older calculation helper. The old calculator is referenced by its unit tests; current application reports import only its date/currency helpers, and obtain salary results from the backend. It was retained because deleting or relocating an existing exported implementation and its tests goes beyond removing verified staging debris.
- Backend `src/salary-components/salary-calculation.service.ts` is an older calculator still referenced by its tests. The registered payroll service is `src/payroll-generator/salary-calculation.service.ts`. Both are backend code and neither was deleted. The older calculator's test fixtures cause the four pre-existing failures described below.
- Backend `src/database.service.ts` and `src/employees/entities/employee.entity.ts` are a tracked older database abstraction/type pair. The database service is not registered in the current AppModule. Retained rather than treating unreferenced tracked source as disposable.
- Older documentation such as `LOCAL-DEVELOPMENT.md` describes the older default database name and employee route contract. The current AppModule defaults to `payroll_db`. Documentation modernization is reported for follow-up; no runtime settings were changed.

The only frontend/backend file mixing found inside the backend workspace is preserved historical material under `.tmp`; it is not application implementation or a build dependency. The archive intentionally remains an exception to a perfectly tidy on-disk tree to protect work.

## 5. Files changed and Git preservation

| Path | Cleanup change |
| --- | --- |
| `D:\projects\payroll-backend\jest.config.ts` | Added explicit roots: `<rootDir>/src` and `<rootDir>/test`, plus a comment. Prevents archived frontend Playwright specs from loading in backend Jest. Keeps all existing backend `.spec.ts` files discoverable; the separate backend e2e configuration remains intact. |
| `D:\projects\payroll-backend\REPOSITORY_CLEANUP_REPORT.md` | Created this report. |
| `D:\projects\payroll-backend\docs\repository-audit-inventory.json` | Created the audit inventory and pre-cleanup content/Git snapshots. |

The seven empty directory removals are listed above. No source, dependency manifests, lockfiles, application modules, routes, or frontend files were edited. Build/test commands refreshed ignored output and caches as expected.

Both `.gitignore` files were reviewed and left unchanged: dependencies, build output, caches, local environment files, and browser artifacts are already covered. Backend `.tmp` is already ignored. No new rule hides source, tests, documentation, or empty-directory names that could contain future source. Ignored files remain present; ignore rules are not used as authorization to delete them.

Content verification checked the pre-cleanup inventory of 109 backend files (with only the intentional Jest change allowed), 86 frontend files, and all 232 archived files. No unexpected content changes or missing files were found. Existing tracked, modified, untracked, and ignored work was retained. Application source files were not rewritten, so on-disk source and unsaved source buffers were not replaced by cleanup.

Both repositories remain on `main`, with HEADs unchanged:

- Backend: `5b20049d0e1a6c4078e1731c670e2eb7a18e22c2`.
- Frontend: `586e0f5bff0ab72efadfed27f4654619a3f9598f`.

Git index entries also match the pre-cleanup snapshots. No staging, commit, push, branch change, merge, reset, rebase, or history rewrite was performed. User development servers were inspected and left running.

## 6. Backend verification

| Check | Before cleanup | After cleanup |
| --- | --- | --- |
| `npm.cmd run build` | Passed | Passed |
| `npm.cmd test -- --runInBand` | 25 suites passed, 6 failed, 7 skipped; 218 tests passed, 4 failed, 14 skipped | 25 suites passed, 1 failed, 7 skipped; 218 tests passed, 4 failed, 14 skipped |

The five removed suite-discovery failures were archived Playwright specs under `.tmp/rate-pdf-format`, which previously failed because the backend does not install `@playwright/test`. They remain preserved but are no longer treated as backend tests.

The same four failing tests before and after cleanup are in `src/salary-components/salary-calculation.service.spec.ts`. They exercise the older calculator with fixtures lacking mandatory component configuration, producing existing BASIC/DA validation errors before the assertions they expect. No formula, expected value, or application code was changed to conceal those failures. Formula, annual payroll, lifecycle unit, and statutory compatibility tests are included in the passing suites.

Additional real MongoDB verification passed **7 tests across 4 isolated suites**, using:

```powershell
$env:RUN_MONGO_TESTS='1'
npm.cmd test -- --runInBand --runTestsByPath src/employees/employee-lifecycle.integration.spec.ts src/employees/employees-edit.integration.spec.ts src/statutory-deductions/statutory-deductions.integration.spec.ts src/salary-components/salary-components.integration.spec.ts
```

These suites use unique disposable databases and guarded cleanup. They check employee lifecycle/history and ordinary edits, persisted salary components, and statutory settings. No live employee/configuration writes were sent as part of cleanup verification. The remaining opt-in MongoDB suites and `test:e2e` were not run.

Read-only checks of the user's running API returned HTTP 200 for `/`, `/employees`, `/salary-components`, `/salary-components/formula-variables`, `/settings/statutory-deductions`, and `/payroll/annual`.

## 7. Frontend verification

| Check | Before cleanup | After cleanup |
| --- | --- | --- |
| `npm.cmd test -- --watch=false` | 56 tests passed across 15 files | 56 tests passed across 15 files |
| `npm.cmd run build` | Passed | Passed |

Production builds produced identical named main/style chunks before and after cleanup. Both warn about the existing 584.49 kB initial bundle exceeding the 500 kB warning threshold, and existing PDF dependency CommonJS modules. The build error budget is satisfied.

Post-cleanup browser verification passed **35 tests across 15 files**. Covered employee add/edit/delete, termination/rehire/history/status filtering, keyboard/menu/mobile behavior, salary components, formula editor and IF formulas, statutory settings, optional report columns, column ordering, employee IDs, annual/monthly PDF values/totals, pagination, alignment, and download generation. Browser test writes were intercepted by the existing test routes. Real persistence was tested separately using disposable MongoDB databases.

Command:

```powershell
npm.cmd run test:browser -- annual-payroll-pdf.spec.ts conditional-formulas.spec.ts dynamic-components-pdf.spec.ts employee-edit-pay-frequency.spec.ts employee-lifecycle.spec.ts formula-components.spec.ts mandatory-components.spec.ts management-delete.spec.ts monthly-payroll-pdf.spec.ts ordered-payroll-pdf.spec.ts pdf-presentation.spec.ts settings.spec.ts statutory-deductions.spec.ts statutory-payroll-pdf.spec.ts ui-refinements.spec.ts
```

The two browser files using real existing employee records (`employees.spec.ts` and `employee-modal-selection.spec.ts`) were not run in this cleanup. Employee functionality was covered by the intercepted browser tests and isolated database suites above.

Backend `git diff --check` passed. Frontend `git diff --check` reports an existing extra blank line at EOF in `src/app/employees/employee-form.html`; the file matches its pre-cleanup SHA-256 and was left untouched.

## 8. Final relevant directory structure and remaining issues

```text
D:\projects\payroll-backend\
├── .git/                              repository history, preserved
├── .tmp/                              preserved uncommitted staging/backup material
│   ├── reverted-statutory-engine/
│   ├── revert-frontend/
│   ├── rate-pdf-format/
│   └── other inventoried work groups and scripts
├── docs/
│   └── repository-audit-inventory.json
├── src/
│   ├── employees/                      API, DTOs, schema, lifecycle, backend tests
│   ├── payroll-generator/              current payroll/statutory calculations
│   ├── salary-components/              configuration and formula evaluation
│   ├── statutory-deductions/           persisted statutory settings
│   ├── app.module.ts
│   └── main.ts
├── test/                              backend e2e configuration/test
├── dist/                              required runtime/build output
├── node_modules/
├── jest.config.ts                     backend-only test discovery
├── package.json, package-lock.json
├── nest-cli.json, tsconfig*.json
├── .gitignore                         unchanged
├── REPOSITORY_CLEANUP_REPORT.md
└── existing feature documentation and configuration

D:\projects\payroll-frontend\
├── .git/, .vscode/                     preserved history/editor settings
├── .angular/                          development cache
├── src/
│   ├── app/
│   │   ├── employees/                  forms, directory, lifecycle dialog, API client
│   │   ├── payroll/                    report UI, selection/order, PDF presentation
│   │   ├── settings/                   component/formula editor UI
│   │   ├── statutory-deductions/       settings UI
│   │   ├── shared/                     reusable confirmation dialog
│   │   └── app.config.ts               Angular routes/providers
│   ├── environments/                  API URL configuration
│   └── styles.css
├── public/                            icons, PDF font and font license
├── e2e/                               browser tests and fixtures
├── artifacts/, test-results/           retained/generated browser evidence
├── dist/, node_modules/
├── angular.json, playwright.config.ts, tsconfig*.json
├── package.json, package-lock.json
├── .gitignore                         unchanged
└── README.md
```

Remaining issues are the preserved `.tmp` work, the explicitly identified legacy helpers/database abstraction and older documentation, four pre-existing backend test failures, and existing build/whitespace warnings. No speculative deletion or source migration was performed to make the tree appear cleaner.
