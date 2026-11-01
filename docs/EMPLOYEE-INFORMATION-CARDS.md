# Employee form and independent information cards

Implemented 1 November 2026. Changes remain uncommitted and unpushed.

## Add Employee

The existing dialog now displays First Name, Last Name, Email, Date of Birth, Hire Date, Annual CTC, and Pay Frequency in that order. Names and dates retain the two-column desktop layout; Email retains the full row. Annual CTC and Pay Frequency share the final row and each has a maximum width of 260px, constrained to the available width on small screens.

Existing control names, validation, required indicators, date handling, salary validation, Monthly default/options, submit/cancel behavior, API payload, error messages and employee identifier generation remain unchanged. Designation and address are optional details entered through the employee profile; the requested seven-field creation form does not gain extra fields.

## Employee Details

The details tab has two cards, using the existing card styling and action icons:

- Employment Information: Employee ID, Hiring Date, Designation, Annual CTC, Organization Name.
- Personal Information: Email, Date of Birth, Address Line 1, Address Line 2, City, State, Zip Code, Country.

Both cards initially display read-only values. Missing optional values display a dash and open as empty inputs. Employment status, Pay Frequency and Latest Rehire remain visible above the cards. The existing general employee editor remains available for its established fields and restrictions; it is disabled while either independent card is being edited or saved, avoiding conflicting edits. Employee ID, Hiring Date, Annual CTC and Organization Name remain read-only in the Employment Information card.

Each card has accessible icon-only Edit and Save actions with the requested title/aria-label text, plus Cancel while editing. Only designation becomes editable in the employment card. Personal editing exposes email, date of birth and the optional address fields. Country suggestions reuse the existing country inventory without selecting or assuming a value. ZIP/postal codes remain strings, preserving leading zeros.

Each card owns its form, baseline, busy/error/success state and cancellation. Failed saves retain entered values. Duplicate submits are blocked. Saving returns only that card to read-only mode. Route departure and browser refresh/close protect unsaved or saving card changes. Switching profile tabs retains the drafts in the parent profile component.

## Persistence and compatibility

Inspection found no existing designation or employee address properties. The employee schema now has seven optional strings: `designation`, `addressLine1`, `addressLine2`, `city`, `state`, `zipCode`, `country`. There are no defaults, data backfills, collection changes or migrations.

`EmployeeProfileFieldsDto` supplies optional string validation and trimming to the existing create DTO and its inherited partial-update DTO. Maximum lengths are 120 for designation/city/state/country, 250 for address lines, and 32 for ZIP code. Empty strings can clear these optional fields; null, non-string values, excessive lengths and control characters are rejected.

Both cards reuse `PATCH /employees/:id`. Employment sends only designation; Personal sends only email, date of birth and address values. The existing service already updates only supplied fields using `$set`; no service/controller or authorization changes were needed. Response handling merges only the saved card's fields, so an older concurrent response cannot reset the other card's values or draft. Existing email/date validators are reused.

Existing organization-scoped model selection and authentication remain in place. Isolated MongoDB tests verify a different organization cannot write the employee. No application employee data was edited by this task. Browser tests mock employee writes; persistence tests write only their separately named QA database and clean up their fixtures.

Payroll/tax calculation services, salary components, financial rules, snapshots, stored PDFs, employment lifecycle and navigation context logic were not modified. The payroll calculation-input mapping excludes the new metadata fields.

## Files changed

Backend:

- `src/employees/schemas/employee.schema.ts`: optional profile metadata only.
- `src/employees/dto/employee-profile-fields.dto.ts`: new reusable optional-field validation.
- `src/employees/dto/create-employee.dto.ts`: inherit optional profile fields; UpdateEmployeeDto already derives from this DTO.
- `src/employees/employees-edit.integration.spec.ts`: real persistence, independent updates, clearing, validation, legacy compatibility and organization isolation checks.
- `docs/EMPLOYEE-INFORMATION-CARDS.md` and `docs/README.md`: implementation report and navigation.

Frontend:

- `src/app/employees/employee-form.html`, `employee-form.css`: field order and compact widths.
- `src/app/employees/employee-form.ts`: export the existing date validator for reuse; its logic is unchanged.
- `src/app/employees/employee.ts`: optional profile-field types.
- `src/app/employees/employee-profile.ts`, `employee-profile.html`, `employee-profile.css`: two-card presentation, independent drafts/saves, responsive sizing and unsaved-change protection.
- `src/app/employees/profile-card.ts`: projected header actions and content-driven card height.
- `src/app/app.config.ts`: profile departure guard.
- `src/app/employees/employee-information.spec.ts`: new isolation, concurrency, validation, errors, cancellation and departure tests.
- `src/app/employees/profile-enhancements.spec.ts`: update the expected card count to two.
- `e2e/employee-information.spec.ts`: new desktop/mobile form, save, reload and departure coverage; portable screenshot output paths.
- `e2e/employee-modal-selection.spec.ts`: keyboard order expectations for the rearranged form.
- `e2e/profile-payroll-ui.spec.ts`: expected two-card design, preserving its history/PDF/navigation assertions.

## Verification

| Check | Result |
| --- | --- |
| NestJS production build | Passed |
| Angular production build | Passed |
| Full frontend unit suite | 35 files, 253 tests passed |
| Backend employee suites including opt-in isolated MongoDB edits | 5 suites, 39 tests passed |
| Backend payroll/tax/PDF and employee regression run | 8 suites, 76 tests passed; overlaps four employee suites above |
| Unique relevant backend coverage across both runs | 9 suites, 80 tests passed |
| Employee/profile/navigation browser regression | 10 passed; 2 live-account checks skipped without test credentials |
| Diff whitespace checks | Passed; existing Git line-ending normalization notices only |

The browser set includes Add/Edit Employee, independent cards, mobile overflow, refresh persistence, unsaved departure, modal focus/cancellation, employment history, stored PDF viewer, contextual back navigation, payroll return context and existing payroll submission UI behavior. Desktop/mobile screenshots were inspected. Test artifacts are under the ignored backend `.tmp/employee-ui-final` directory.

The frontend still emits initial-bundle size, existing Run Payroll stylesheet size and PDF dependency CommonJS warnings. The final initial bundle is approximately 766.55kB, within the existing 1MB error threshold. No budgets or dependency versions were changed.

The complete backend default suite was not rerun in this task: its six previously documented failures are outside this scope and were left untouched. The relevant employee, persistence, payroll, tax and PDF suites listed above all pass. This report does not claim a manual audit of every live employee or every historical payroll record.
