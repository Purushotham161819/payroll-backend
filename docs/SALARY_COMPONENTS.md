# Salary component settings

BASIC, DA and RA are now mandatory system components initialized at startup. Newly created percentages are unconfigured and must be supplied before payroll generation. See [MANDATORY_WAGE_COMPONENTS.md](MANDATORY_WAGE_COMPONENTS.md) for protected fields and upgrade behavior; the earlier empty-configuration behavior below is superseded.

Start MongoDB, then run `npm.cmd run start:dev` in `D:\projects\payroll-backend` and `npm.cmd start` in `D:\projects\payroll-frontend`. Open http://localhost:4200/settings. Backend configuration continues to use `MONGODB_URI` (default local `payroll_db`) and `PORT` (default 3000).

The new `salary_components` collection stores name, normalized uppercase unique code, earning/deduction category, annual-CTC/component base type, ObjectId base reference, percentage/fixed calculation type, value, explicit annual/monthly fixed period, payslip visibility, status, and timestamps. A unique code index is created at startup; index creation failure stops startup. No data migration or seed is required, and no sample records are inserted.

API: GET and POST `/salary-components`, PATCH `/salary-components/:id`, PATCH `/salary-components/:id/status` with `{ "status": "active" }` or `inactive`. Updates accept partial fields. Invalid fields/references/cycles return 400, missing records 404, and duplicate codes 409. Existing employee endpoints are unchanged. CORS now permits PATCH.

Inactive components are excluded from future calculations. Active dependents must be deactivated or reconfigured before their base is deactivated. Existing inactive configurations may retain inactive references; new configurations cannot select inactive bases. There is no delete endpoint.

`SalaryCalculationService.calculate(annualCtc, components)` resolves dependencies and returns annual/monthly component values, category and payslip visibility. Annual values are rounded to paise before dependent calculations; monthly display values are rounded independently, so twelve rounded monthly amounts may differ slightly from the annual value. Payslip visibility does not exclude components from calculations. No payroll is generated when settings change.

Graph mutations are serialized within one backend process. Deploy this initial implementation with one backend writer; multiple concurrent backend instances would require database-wide graph locking or transactional coordination. The existing application has no authentication/role system; these endpoints follow that existing access model.

Changed backend files: `src/app.module.ts`, `src/main.ts`. New backend files: all files under `src/salary-components/` (DTO, schema, controller, service, module, calculation service, and three test suites). The pre-existing employee service test edits were preserved.

Changed frontend files: `src/app/app.ts`, `app.html`, `app.css`, `app.config.ts`, `app.spec.ts`. New frontend files: `src/app/settings/settings.ts`, `settings.html`, `settings.css`, and `e2e/settings.spec.ts`.

Validation: `npm.cmd run build` in both projects; `npm.cmd test -- --watch=false` in frontend; `$env:RUN_MONGO_TESTS='1'; npm.cmd test -- --runInBand` in backend. MongoDB tests create and remove a uniquely named temporary salary test database and perform read-only employee persistence checks. The browser suite uses API fixtures only; the persisted HTTP suite uses MongoDB.
