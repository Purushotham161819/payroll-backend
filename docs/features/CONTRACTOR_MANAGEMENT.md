# Contractor Management

Status: Contractor Management and final UI refinements visually approved on 03 November 2026. The Product Owner authorized conservative cleanup, validation, commits and normal publication to main. Earlier approval-gate statements in historical reports are superseded by this authorization. Dashboard Phase 4I remains deferred.

## Overview and boundaries

Contractors are independent of Employees. The feature maintains a directory, profile, configurable payment components, contractor-specific assignments and finalized payment history. It never creates Employee records or employee IDs, modifies salary components, invokes the annual payroll/formula/TDS/statutory engines, changes payroll reports/headcount/KPIs, or generates/changes employee payslips. Shared UI and the existing pure API error-display helper are presentation reuse only.

## Preliminary audit and implementation decisions

The existing EmployeeList is the root page, without a general-purpose tab ribbon. EmployeeForm binds employee validators, lifecycle, CTC, dates and employee APIs, so it is not safely reusable as a contractor business form. EmployeeProfile/ProfileTabs hardcode employee sections; PayChecks loads payroll/PDF services. Settings embeds salary metadata and formula variables linked to the employee calculation engine. These business components were left intact.

Reuse: PsPageHeader, PsCard and slots, PsFormField/PsFieldControl, PsButton, PsIconButton, PsDataTable, PsStatusBadge, PsDatePipe, PsInrPipe and the existing enhanced select adapter. New opt-in shared PsTabs, PsDialog and PsFeatureLayout provide configurable ribbons, token-based modal/focus behavior and responsive form compositions. Existing Employee/Salary components were not generalized or forked. Required integration changes are limited to module registration, lazy routes and the two requested navigation additions. Four existing browser specs scope their Employees sidebar link to Main navigation because the new directory ribbon deliberately introduces a second Employees link; their assertions and workflows are retained.

## Data architecture

NestJS ContractorsModule contains its own controller, organization guard, service, DTOs, schemas and amount/date validation. The service reuses businessModel's organization-prefixed collection naming, always with a required validated organization ID. Every business document and query also carries organizationId. Unscoped base schemas have autoCreate/autoIndex disabled; scoped indexes are initialized explicitly. No legacy-tenant fallback is allowed.

For ORG000901 the collections are:

- org000901_contractors: Mongo _id, unique CON-prefixed contractorId, firstName, lastName, normalized email, componentIds, version and actor/timestamps.
- org000901_contractor_components: name, unique uppercase code, classification, status, descriptive configuration, version and actor/timestamps.
- org000901_contractor_payments: immutable submission envelope, unique idempotency key, input hash, manual date/description, recorded actor, timestamps and one or more finalized entries.
- org000901_contractor_counters: atomic independent contractor/payment identifier sequences.

Assignments live only on the Contractor's componentIds array; payment-time component details live only inside immutable payment entries. There is no Employee or salary-component relationship. Each entry has its own CPAY-prefixed payment ID, identity snapshot, component snapshots and totals. The envelope is inserted as one MongoDB document, making a multi-contractor submission atomic without requiring replica-set transactions. Sequence gaps after rejected/concurrent requests are allowed; IDs are not reused.

## Settings and component classifications

Contractor Settings is an admin-only Settings tab. It supports add, view, edit, save and active/inactive status. Fields are Component Name, Code, Classification (Deductions only), Status and Calculation Type. New earnings, allowances and manual deduction rules are rejected. Existing historical classifications remain readable without modifying their snapshots.

Fixed Amount and Percentage deductions calculate from manually entered Gross Pay. Percentage values are 0-100. The inherited contractor-only Formula option evaluates a restricted expression using grossPay, numeric literals, arithmetic, parentheses and percent; it does not invoke the employee formula engine or execute JavaScript. Rule size, depth, arithmetic bounds and division by zero are checked. Calculation Base is no longer an editable/reference-only field: the service uses grossPay. Employee CTC, payroll variables, earnings and allowances are excluded.

## Contractor profile and assignment

Add Contractor accepts only required First Name, Last Name and Email. Its own form and API generate CON identifiers. First/Last Name links open /contractors/:id. Contractor Details displays the four identity fields and provides Edit/Save/Cancel. Contractor Payment Components shows the organization's configured components, classifications, status and reference configuration, with explicit selection/deselection and save/cancel.

New contractors start with no assignments. Saving validates every reference and the contractor version. An inactive component already assigned may remain assigned or be deselected; it cannot be newly assigned or used in a payment. Editing component configuration preserves assignments by stable component ID. Updates use optimistic versions to reject overwritten edits. No component-delete operation is exposed in this release; deactivate instead.

## Payment workflow

The directory provides a Pay Contractor action for every row and a general Pay Contractors button. Both open the same form. Row entry preselects that contractor; general entry supports multiple selection, select-all and a mixed checkbox state. Users manually enter Gross Pay, Payment Date and Description. The table displays first/last names, Gross Pay, assigned deduction components, Total Deductions and Net Payment. Only selected rows contribute to the live Total Gross Payment and Total Net Payment KPI cards beside Payment Date. All active assigned deductions are applied; users cannot omit a required deduction or supply its calculated amount. No input is derived from employee CTC or payroll.

Submit validates and opens a review popup showing contractor identity, date, description, component breakdown and all totals. No write occurs before Confirm Payment. Cancel returns to entered values. The success message appears only after the API succeeds. Failures retain the confirmation, manual values and the same idempotency key for retry. Busy guards prevent repeated clicks. Confirming records a payment; it does not transfer money, confirm a bank transfer, create an unsupported bank integration or mark an employee payment paid.

Payment arithmetic is independent and performed in integer paise:

- Gross Pay is manually entered separately for each selected contractor.
- Total Deductions = sum of that contractor's active assigned deduction rules, rounded per line to paise.
- Net Payment = Gross Pay - Total Deductions.
- No active assigned deductions means zero deductions and Net Payment equal to Gross Pay. Explicit zero Gross Pay is valid when deductions do not produce a negative net.

The backend independently calculates every deduction and rejects invalid precision, nonfinite/negative Gross Pay, invalid rules and negative net payments. It requires exactly the active assigned deduction references and their reviewed versions; client amounts/totals are not trusted. The UI uses psInr for display: whole nonzero rupees omit decimal zeros; zero/fractional values retain two decimals. No employee rounding or payroll result is changed.

## Submission, history and immutability

A client-generated UUID v4 identifies a reviewed submission. A unique organization/key index and payload hash handle concurrent requests: the same key and same payload return the existing submission; a different payload with the same key returns 409. Every batch entry is validated before the single insert, so a failed contractor/reference does not partially save a batch. Current contractor and component versions must match the reviewed data. Retries of a completed request return its original stored snapshot even if later settings change.

Payments are read-only except for their explicitly confirmed removal when an admin permanently deletes the contractor. There are no standalone payment-edit/reversal/deletion, bank-transfer or contractor PDF endpoints. Payments are sorted by payment date, creation time and _id descending. The profile shows Payment ID, Payment Date, Description, Gross Pay, Total Deductions and Net Payment, with a details dialog. The record stores original names, email, contractor code, component name/code/classification/configuration, Gross Pay, calculated amounts, description and date. Earlier component payments additionally retain their saved Earnings and Allowances totals in detail. Renames, classification changes, deactivation or later disappearance of current components do not recalculate history. Employee Pay Checks remain separate.

## APIs

### Status management and permanent deletion — 03 November 2026

Contractors have Active/Inactive status; new records default to Active. Add/identity update DTOs do not accept status. Legacy records with no status remain eligible as Active without a migration. PATCH /contractors/:id/status accepts status plus the reviewed version and requires the existing ContractorAdmin guard. Changing status preserves identity, assignments and all historical payment snapshots. Inactive contractors are rejected before new payment calculations/submission. Same-key replays of completed payments still return the existing snapshot and do not create a new payment.

DELETE /contractors/:id requires the same admin guard and authenticated organization ownership. The UI requires explicit confirmation warning that the contractor and all associated payments will be permanently deleted. The service uses a MongoDB transaction: delete the selected contractor, remove only its embedded entries from matching tenant payment envelopes, then delete only affected envelopes left empty. Other contractor entries, dates, IDs, amounts and snapshot metadata are preserved. Mixed-envelope input hashes/idempotency keys are retained, so an original request replay cannot create replacement payments for a deleted contractor.

**Deployment requirement:** permanent deletion requires MongoDB transactions (replica set or sharded deployment). A standalone deployment returns 503 before mutation; the UI explains that no records were changed. The current local database is standalone and was not reconfigured. The implementation intentionally has no partial-delete or soft-delete fallback. After enabling transaction support, restart the backend so its connection-level capability check is refreshed.

On transaction-capable deployments, inserting a new payment also writes a separate contractor paymentWriteVersion fence in the same transaction and checks the reviewed contractor version/status. This serializes payment insertion with status changes/deletion and prevents orphan payments. It does not change calculationVersion, formulas, payment IDs, assignment versions or hashing. Sequence gaps remain permitted as before. Existing standalone recording remains supported; deletion is unavailable there. No existing employee/payroll/tax collections or APIs are involved.

All paths require the existing authenticated session and CSRF header/exact Origin checks, plus an organization account. Settings writes additionally require admin; organization members can read components and manage contractor records, assignments and payments, matching the existing general employee-operation convention.

| Method | Path | Purpose |
|---|---|---|
| GET / POST | /contractors | Directory / create contractor |
| GET / PATCH | /contractors/:id | Retrieve / versioned identity update |
| GET | /contractors/components | Organization component catalog |
| POST | /contractors/components | Admin create component |
| PATCH | /contractors/components/:id | Admin versioned component update/status |
| PATCH | /contractors/:id/components | Versioned assignment replacement |
| POST | /contractors/payments | Validate and atomically record a reviewed batch |
| GET | /contractors/:id/payments | Contractor-only finalized snapshot history |

POST payment fields: idempotencyKey, paymentDate and entries. Each entry contains contractorId (Mongo ID), contractorVersion, grossPay, its own description and components; each component contains only componentId and componentVersion. Description is nonblank and at most 1,000 characters per contractor. The current frontend sends independent entry descriptions. The optional legacy batch description is still accepted for backward compatibility; an entry without its own description uses that value. A missing description in both places rejects the entire batch before insertion. New entries store the resolved description with calculationVersion 2, Gross Pay and the calculated rule snapshots. Historical entries without an entry description return their original batch description without rewriting or recalculating records. The client never supplies organization authority, payment ID, computed deduction amounts, totals, classification snapshot or recordedBy. Historical earnings/allowances/deductions/net values remain unchanged; missing or null Gross Pay displays as Not recorded and is never inferred. Contractor deletion is now admin-authorized with explicit confirmation and transaction safety as described above.

## Organization isolation and validation

The existing global AuthGuard still validates persisted sessions, account restrictions, Super Admin separation and request origin. ContractorAccessGuard rejects unauthenticated/non-business roles and missing/invalid organization IDs, and protects admin settings writes. The controller obtains organization/actor only from the authenticated request account. Services select only that tenant's collections and add organization filters. Cross-tenant IDs cannot retrieve/update contractors/components, assign components or submit/read payments.

DTOs whitelist/reject unknown fields; trim names, normalize email/code; validate email, name/code lengths, IDs, versions and nested batches. Unique scoped indexes reject duplicate email/code, including case-normalized input. Mongo ID references are canonicalized to lowercase before assignment and payment validation; uppercase path IDs resolve to the same saved history. Payment dates are validated as real civil dates (including leap-day checks), with a 1900 lower bound. Description is nonblank, at most 1,000 characters. Each amount is 0 through 1,000,000,000 with at most two decimals. Each submission has at most 50 unique contractors and each entry at most 100 unique components, additionally subject to the application's existing HTTP body limit. Components must be available and assigned to the specific contractor. Actor/timestamp audit fields follow existing conventions.

## Known limitations and approval boundary

No contractor TDS/statutory engine, bank integration, transfer status reconciliation, PDF, component deletion or payment reversal/editing is implemented. Directory/search and component selection operate on the loaded organization list; server pagination is not introduced. The payment API accepts at most 50 contractors per submission. Editing an identity uses a dedicated shared-styled dialog rather than importing EmployeeProfile editing logic. Reload/navigation can discard unsaved drafts. Network retries reuse the reviewed request key; intentionally starting a new review creates a new key and represents a new submission.

Browser workflow tests use synthetic fixtures, and a separate isolated Mongo/Nest browser test verifies real persistence. Existing baseline failures/skips are reported separately in the implementation report. Approval is required before committing/pushing or beginning another feature. Existing employee schemas/services/calculation/PDF source remains unchanged; the only Employee Directory changes are the explicitly requested ribbon/import/configuration.
