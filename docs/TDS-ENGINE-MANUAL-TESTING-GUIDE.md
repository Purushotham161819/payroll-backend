# PayStream TDS Engine — Manual Testing Guide

Prepared 31 October 2026. Audience: first-time testers. Every manual Actual Result and Remarks cell is intentionally blank; every manual Status starts as **Not Tested**. Automated results are listed separately at the end. Do not mark a manual case Pass merely because an automated test passed.

## Before you begin: protect real data

The configured application database was identified as **payroll_db**. Its component definitions were inspected read-only. Its name does not establish that it is safe for test writes, so it was treated as protected. No customer tax revision, employee, salary structure, payroll or payslip was changed by this verification.

Automated writes use local MongoDB with explicit disposable database names beginning tax_revision_workflow_test_, tax_year_save_test_, tds_feature_test_ or payroll_run_test_. Browser verification uses its own disposable database. Tests do not load the application's database URI for their write fixtures. These databases are removed after verification.

For your manual run, ask the administrator for a **separate QA organization and test database**, and a QA administrator account. Never change real salary formulas, payroll settings, taxes or employees to make these examples fit. If a safe QA environment is unavailable, leave the write cases Not Tested.

Allow 60–90 minutes for configuration and another 60 minutes for calculation/payroll checks. Save screenshots and write the displayed error in Remarks for every failure. If a button stays disabled, scroll to the configuration checklist and fix every named item; do not type made-up references or bypass the button.

## Part 1 — Initial setup, field meanings and exact values

### 1.1 Create the QA financial year

Sign in as the QA administrator. Open **Settings → Tax Configuration → Add financial year**. Enter:

| Field | Meaning | Exact QA input |
| --- | --- | --- |
| Name | Human-readable label | Financial Year 2026-27 |
| Code | Unique label within this organization | FY 2026-27 |
| Start date | First day covered | 01-04-2026 |
| End date | Last day covered | 31-03-2027 |
| Applicable legislation | Law used for this year | Income-tax Act, 2025 |
| Rule version | Your review/version label | ITACT2025_FA2026_V1.0 |

Date controls use your browser's calendar. In an Indian-locale browser the dates display day-month-year. Select **1 April 2026** and **31 March 2027** from the calendar if unsure; the save request sends 2026-04-01 and 2027-03-31. Do not type the display text into an unsupported text-date field. Save should become enabled, show **Financial year saved.**, add the year to the list and clear the creation form. Add is creation-only: the same code must not silently edit an existing year.

Choose **Activate** beside this QA year, review the confirmation and confirm. This is needed later for TDS-enabled payroll, while an inactive year may still have draft tax revisions.

### 1.2 Complete the New Regime baseline (N)

Choose the financial year above and New regime. Effective date is filled automatically from the year start and is read-only in this release; you do not need to type it again.

| Field | Exact input | What it controls |
| --- | --- | --- |
| Financial year | Financial Year 2026-27 | The year being configured |
| Regime | New | Independent New Regime revision |
| Effective date | 01-04-2026, automatically filled | First applicable date |
| Standard deduction | 75000 | Salary reduction, capped at salary |
| Rebate eligibility limit | 1200000 | Taxable-income ceiling for the rebate |
| Maximum rebate | 60000 | Maximum tax rebate |
| Cess percentage | 4 | Percentage after applicable tax/relief/surcharge |
| Minimum age at year end | 0 | Reviewed lower age bound |
| Maximum age | Leave blank | Unlimited upper age for this New fixture |
| Income rounding | Ignore paise, nearest ₹10 | Round taxable income as prescribed |
| Liability rounding | Ignore paise, nearest ₹10 | Round final annual liability |
| Rebate marginal relief applies | Checked | Relief just above the rebate limit |
| Surcharge marginal relief applies | Checked | Relief just above surcharge thresholds |

Enter these seven New slabs. These values are verified ordinary-income rules, not permission to ignore special-income or exemption conditions. The same structure can also be used purely as the user's illustrative form-validation table.

| From | To | Rate % |
| ---: | ---: | ---: |
| 0 | 400000 | 0 |
| 400000 | 800000 | 5 |
| 800000 | 1200000 | 10 |
| 1200000 | 1600000 | 15 |
| 1600000 | 2000000 | 20 |
| 2000000 | 2400000 | 25 |
| 2400000 | **Leave blank: unlimited** | 30 |

Use **Add slab** to add rows and **Remove** only on the intended row. Adjacent boundaries are equal: enter 400000 as both the first upper and second lower boundary. Do not enter 400001 in this continuous-boundary editor. Rows may be entered out of order; valid rows are sorted when saved. A blank upper amount is correct only on the final unlimited slab; a finite final upper amount is invalid.

New surcharge tiers:

| Threshold exceeded | Rate % |
| ---: | ---: |
| 5000000 | 10 |
| 10000000 | 15 |
| 20000000 | 25 |

### 1.3 Complete the Old Regime baseline (O)

Create a separate revision under **Old**; do not edit an existing saved New revision. For the ordinary resident-under-60 QA employees below, use standard deduction **50000**, rebate eligibility **500000**, maximum rebate **12500**, cess **4**, minimum age **0**, maximum age **59**, both rounding fields **Ignore paise, nearest ₹10**, rebate marginal relief **unchecked**, surcharge marginal relief **checked**. Keep the same year/effective date.

| From | To | Rate % |
| ---: | ---: | ---: |
| 0 | 250000 | 0 |
| 250000 | 500000 | 5 |
| 500000 | 1000000 | 20 |
| 1000000 | Leave blank | 30 |

Old surcharge thresholds/rates: **5000000 / 10**, **10000000 / 15**, **20000000 / 25**, **50000000 / 37**. Senior/super-senior ordinary Old slabs are different: do not apply this under-60 fixture to them. The current engine has one reviewed age band per regime/year; unsupported ages must be blocked rather than assigned the wrong slabs.

### 1.4 Load actual components and complete required review fields

Click **Load current salary components**. You should see **Loading salary components…**, followed by a message beginning **Loaded N active salary components.** The button calls the existing Salary Components API again; it does not create salary components. Repeated loads merge by original identity, preserve entered treatment/reference/conditions and add new rows only once.

The read-only ORG000001 inspection found:

| Former internal field | Actual product component | Original component identity | Source category |
| --- | --- | --- | --- |
| reference0 | Basic Salary | 6ae3c1b241976bc8feddb841 | Earning |
| reference1 | Dearness Allowance | 6ae3c1b241976bc8feddb842 | Earning |
| reference2 | Retaining Allowance | 6ae3c1b241976bc8feddb843 | Earning |

These positions are **not permanent definitions**. The endpoint sorts records by creation time and identity; a different organization can have other names/order. The legacy collection also has House Rent Allowance. The screen must use the actual returned names. You never need to enter or change an identity manually.

The existing endpoint returns active, inactive, earning, allowance and deduction definitions. Tax Configuration shows active **earning/allowance** rows. Employee Professional Tax/PF/ESI deduction definitions are excluded; they must not become extra taxable salary automatically. Annual employer EPS/EPF/ESI amounts are calculated separately by the existing annual salary engine and are **not** extra salary-component rows. If an employer-related amount is explicitly defined as an earning/allowance component, it appears under its actual configured name; no employer row is invented.

New rows have **Select reviewed treatment**, not an automatically approved Fully Taxable classification. Choose one of Fully taxable, Fully exempt, Partially taxable or Conditional only after review. For Partial choose either taxable percentage or annual exempt amount; supply the corresponding number and conditions. Conditional metadata can be saved, but actual unsupported conditional claims still block tax calculation.

The labels now read **[actual component name] — taxability treatment** and **[actual component name] — legal reference**. The checklist says **Legal reference is required for [actual name].** No reference0-style identifiers should appear. A product name identifies the row; it is not a legal reference and does not replace the required legal evidence.

**Exact controlled QA mapping data:** only when the QA organization's BASIC, DA and RA are defined as ordinary cash-wage remuneration with no exemption claims, select Fully taxable explicitly and enter the corresponding reference text below. This is a narrowly defined QA assumption supported by section 16(a), not blanket approval of a customer's components. For any other actual component, get the approved treatment/reference from the statutory reviewer; leave it unconfigured until then. No production reference is auto-filled.

| QA component | Treatment | Exact reference input |
| --- | --- | --- |
| Basic Salary | Fully taxable | Basic Salary — QA ordinary cash wages — Income-tax Act, 2025, section 16(a) |
| Dearness Allowance | Fully taxable | Dearness Allowance — QA ordinary cash wages — Income-tax Act, 2025, section 16(a) |
| Retaining Allowance | Fully taxable | Retaining Allowance — QA ordinary cash wages — Income-tax Act, 2025, section 16(a) |

Official source URLs: enter these on separate lines:

    https://www.incometaxindia.gov.in/Documents/Act/Income-tax-Act-2025.pdf
    https://egazette.gov.in/WriteReadData/2026/271439.pdf

Exact **Review note and taxability conditions** for this controlled QA setup:

> QA only: resident employees with ordinary salary-only income, operative PAN, full-year monthly employment and no exemption or investment claims. BASIC, DA and RA are ordinary cash wages. Zero employer contributions are a test fixture to isolate the tax calculation, not a statement about statutory PF/ESI obligations. No additional taxable employer contribution or perquisite is present. No prior payroll/TDS exists for these QA employees.

The employer review checkbox remains mandatory. Check it only after reviewing that QA setup; in production a reviewer must establish the actual treatment. An unchecked checkbox and a blank note correctly keep Save disabled. Supplying product names does not waive this review.

### 1.5 Save and inspect a complete revision

Resolve every checklist item. **Save new revision** should enable only when all required values, complete slabs, surcharge structure, component treatments, legal references, official URLs, review note and employer confirmation are valid. Click once. Expect **New immutable revision saved.** and a new row in **Configuration history**. Expand **Reviewed sources and rules** to inspect saved slab rows and named mappings. Save does not activate a revision; choose **Activate revision** separately and confirm.

If the server rejects a request, record its displayed error; all entered values must remain. Repeated clicks while a request is pending must not create a second revision. An inactive/removed component is retained with its entered values and a warning; explicitly remove it **from this draft** or restore the source component before saving. Saved history is not deleted. An older revision with a stale component set cannot be activated; load current components and save a new revision.

## Verified statutory references for FY / Tax Year 2026–27

Do not confuse **AY 2026–27** (usually income from FY 2025–26 under the 1961 Act) with income earned in **Tax Year 2026–27** under the 2025 Act. No Finance Bill was used as enacted authority. The ordinary-salary examples below use these official sources:

- [Income-tax Act, 2025, section 16: salary includes wages](https://wmstatic-prd.incometaxindia.gov.in/web/guest/w/section-16-220).
- [Section 19: salary deductions](https://wmstatic-prd.incometaxindia.gov.in/web/guest/w/section-19-199): standard deductions of 75000 in the New regime and 50000 otherwise, capped at salary.
- [Official section 156 publication](https://wmstatic-prd.incometaxindia.gov.in/documents/20117/42998/Section-156_2026-04-01_05-11-58_344893_en.pdf/415b0f0e-8826-feaa-b374-481e54d4b98e): resident rebate limits and New rebate marginal relief.
- [Section 202, current department presentation](https://wmstatic-prd.incometaxindia.gov.in/web/guest/w/section-202-78): New ordinary-income slabs.
- [Consolidated Act amended by Finance Act, 2026](https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf), section 516: discard paise, then round income/final liability to the nearest ten rupees, with five rounding up.
- [Enacted Finance Act, 2026](https://egazette.gov.in/WriteReadData/2026/271439.pdf), section 3, First Schedule Part III, and [official government republication](https://cdnbbsr.s3waas.gov.in/s371e09b16e21f7b6919bbfc43f6a5b2f0/uploads/2026/06/20260612876642151.pdf). The government copy was downloaded and visually inspected: PDF pp14–16 show section-202 surcharge and relief; p30 shows section3(15), 4% cess on income tax plus surcharge; p97 shows salary-withholding scope and ordinary Old slabs; p100 shows ordinary surcharge tiers. This avoids substituting a previous financial year's guidance.

These references verify the restricted ordinary-salary arithmetic, not all possible claims, benefits, amendments or an organization's evidence. The fixtures contain no special-rate income, exemptions, prior employer income/TDS, investment claims, professional-tax tax deduction or taxable employer additions. Production activation still needs the organization's statutory review. No test rate or mapping was seeded into customer data.

## Part 2 — Tax Configuration test cases

For a row saying **N baseline**, use every exact New value, slab, surcharge, mapping and review input in Part 1, then change only the listed field. **O baseline** means the corresponding Old values. Use a fresh unsaved draft for invalid cases, and a new QA code/year where needed; do not overwrite a saved year.

For each case, write what you actually saw in Actual Result, then change Status to Pass or Fail. Keep Not Tested if you could not perform it. Cases requiring a deliberate invalid API request are automated/developer-assisted because the normal screen intentionally offers only supported choices.

| Test Case ID | Feature | Test Scenario | Preconditions | Input Field | Input Value | Steps | Expected Result | Actual Result | Status | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| FY-01 | Financial Year | Valid year creation | Separate QA organization; year absent except duplicate/overlap cases | All six year fields | Part 1.1 exact inputs | 1 Open Add financial year. 2 Enter Part 1.1 values with this change. 3 Blur the field. 4 Save if enabled. | Save enables; success notice, listed year, cleared form. |  | Not Tested |  |
| FY-02 | Financial Year | Missing name | Separate QA organization; year absent except duplicate/overlap cases | Name | Blank | 1 Open Add financial year. 2 Enter Part 1.1 values with this change. 3 Blur the field. 4 Save if enabled. | Save stays disabled; Enter a financial year name. |  | Not Tested |  |
| FY-03 | Financial Year | Missing code | Separate QA organization; year absent except duplicate/overlap cases | Code | Blank | 1 Open Add financial year. 2 Enter Part 1.1 values with this change. 3 Blur the field. 4 Save if enabled. | Save stays disabled; meaningful code error. |  | Not Tested |  |
| FY-04 | Financial Year | Spaced/hyphenated code | Separate QA organization; year absent except duplicate/overlap cases | Code | FY 2026-27 | 1 Open Add financial year. 2 Enter Part 1.1 values with this change. 3 Blur the field. 4 Save if enabled. | Accepted without replacing the internal space. |  | Not Tested |  |
| FY-05 | Financial Year | Duplicate code | Separate QA organization; year absent except duplicate/overlap cases | Code | FY 2026-27, already saved | 1 Open Add financial year. 2 Enter Part 1.1 values with this change. 3 Blur the field. 4 Save if enabled. | Duplicate is blocked; existing year is unchanged. |  | Not Tested |  |
| FY-06 | Financial Year | Reversed dates | Separate QA organization; year absent except duplicate/overlap cases | Start date / End date | 01-04-2027 / 31-03-2026 | 1 Open Add financial year. 2 Enter Part 1.1 values with this change. 3 Blur the field. 4 Save if enabled. | Start date must be earlier than end date. |  | Not Tested |  |
| FY-07 | Financial Year | Overlap | Separate QA organization; year absent except duplicate/overlap cases | Code / Start / End | FY OVERLAP / 01-10-2026 / 30-09-2027 | 1 Open Add financial year. 2 Enter Part 1.1 values with this change. 3 Blur the field. 4 Save if enabled. | Backend says Financial years cannot overlap; no new year. |  | Not Tested |  |
| FY-08 | Financial Year | Duplicate click | Separate QA organization; year absent except duplicate/overlap cases | Save financial year | Double click a valid fresh year | 1 Open Add financial year. 2 Enter Part 1.1 values with this change. 3 Blur the field. 4 Save if enabled. | One year only; pending state blocks another request. |  | Not Tested |  |
| FY-09 | Financial Year | Incomplete calendar year | Separate QA organization; year absent except duplicate/overlap cases | End date | 30-03-2027 | 1 Open Add financial year. 2 Enter Part 1.1 values with this change. 3 Blur the field. 4 Save if enabled. | Twelve-complete-calendar-month message; save blocked. |  | Not Tested |  |
| FY-10 | Financial Year | Display-format date | Separate QA organization; year absent except duplicate/overlap cases | Calendar start / end | 1 April 2026 / 31 March 2027 | 1 Open Add financial year. 2 Enter Part 1.1 values with this change. 3 Blur the field. 4 Save if enabled. | Displayed day-month-year, saved ISO dates, correct year listed. |  | Not Tested |  |
| MASTER-01 | Tax Master | Valid New configuration | Complete unsaved N baseline unless O specified | All master fields | N baseline | 1 Enter baseline. 2 Change only this field. 3 Read checklist. 4 Save if enabled and inspect History. | Save enables only after mappings and review are also complete. |  | Not Tested |  |
| MASTER-02 | Tax Master | Valid Old configuration | Complete unsaved N baseline unless O specified | All master fields | O baseline; age 0–59 | 1 Enter baseline. 2 Change only this field. 3 Read checklist. 4 Save if enabled and inspect History. | Separate Old revision can be saved; New history remains. |  | Not Tested |  |
| MASTER-03 | Tax Master | Missing standard deduction | Complete unsaved N baseline unless O specified | Standard deduction | Blank | 1 Enter baseline. 2 Change only this field. 3 Read checklist. 4 Save if enabled and inspect History. | Standard deduction is required; save blocked. |  | Not Tested |  |
| MASTER-04 | Tax Master | Missing rebate limit | Complete unsaved N baseline unless O specified | Rebate eligibility limit | Blank | 1 Enter baseline. 2 Change only this field. 3 Read checklist. 4 Save if enabled and inspect History. | Rebate eligibility limit is required; save blocked. |  | Not Tested |  |
| MASTER-05 | Tax Master | Missing maximum rebate | Complete unsaved N baseline unless O specified | Maximum rebate | Blank | 1 Enter baseline. 2 Change only this field. 3 Read checklist. 4 Save if enabled and inspect History. | Maximum rebate is required; save blocked. |  | Not Tested |  |
| MASTER-06 | Tax Master | Negative standard deduction | Complete unsaved N baseline unless O specified | Standard deduction | -1 | 1 Enter baseline. 2 Change only this field. 3 Read checklist. 4 Save if enabled and inspect History. | Non-negative amount error; save blocked. |  | Not Tested |  |
| MASTER-07 | Tax Master | Negative rebate limit | Complete unsaved N baseline unless O specified | Rebate eligibility limit | -1 | 1 Enter baseline. 2 Change only this field. 3 Read checklist. 4 Save if enabled and inspect History. | Non-negative amount error; save blocked. |  | Not Tested |  |
| MASTER-08 | Tax Master | Negative maximum rebate | Complete unsaved N baseline unless O specified | Maximum rebate | -1 | 1 Enter baseline. 2 Change only this field. 3 Read checklist. 4 Save if enabled and inspect History. | Non-negative amount error; save blocked. |  | Not Tested |  |
| MASTER-09 | Tax Master | Cess too high | Complete unsaved N baseline unless O specified | Cess percentage | 101 | 1 Enter baseline. 2 Change only this field. 3 Read checklist. 4 Save if enabled and inspect History. | Cess must be between 0 and 100; save blocked. |  | Not Tested |  |
| MASTER-10 | Tax Master | Negative cess | Complete unsaved N baseline unless O specified | Cess percentage | -1 | 1 Enter baseline. 2 Change only this field. 3 Read checklist. 4 Save if enabled and inspect History. | Cess must be between 0 and 100; save blocked. |  | Not Tested |  |
| MASTER-11 | Tax Master | Reversed age range | Complete unsaved N baseline unless O specified | Minimum age / Maximum age | 60 / 59 | 1 Enter baseline. 2 Change only this field. 3 Read checklist. 4 Save if enabled and inspect History. | Age-range message; save blocked. |  | Not Tested |  |
| MASTER-12 | Tax Master | Unlimited age | Complete unsaved N baseline unless O specified | Maximum age | Blank | 1 Enter baseline. 2 Change only this field. 3 Read checklist. 4 Save if enabled and inspect History. | Accepted; not mistaken for missing required information. |  | Not Tested |  |
| MASTER-13 | Tax Master | Fractional age | Complete unsaved N baseline unless O specified | Minimum age | 18.5 | 1 Enter baseline. 2 Change only this field. 3 Read checklist. 4 Save if enabled and inspect History. | Whole-number age message; save blocked. |  | Not Tested |  |
| MASTER-14 | Tax Master | Missing effective date | Complete unsaved N baseline unless O specified | Financial year selection | Select a year (blank option) | 1 Enter baseline. 2 Change only this field. 3 Read checklist. 4 Save if enabled and inspect History. | Effective date is missing until a year is chosen; save blocked. |  | Not Tested |  |
| MASTER-15 | Tax Master | Unsupported rounding | Complete unsaved N baseline unless O specified | Income rounding API value | invalid | 1 Enter baseline. 2 Change only this field. 3 Read checklist. 4 Save if enabled and inspect History. | Automated/API-only negative case: backend rejects unsupported rounding; no revision. |  | Not Tested |  |
| MASTER-16 | Tax Master | Rebate relief flag binding | Complete unsaved N baseline unless O specified | Rebate marginal relief applies | Toggle checked then unchecked | 1 Enter baseline. 2 Change only this field. 3 Read checklist. 4 Save if enabled and inspect History. | Both explicit states can be saved; never defaulted by the frontend. |  | Not Tested |  |
| MASTER-17 | Tax Master | Surcharge relief flag binding | Complete unsaved N baseline unless O specified | Surcharge marginal relief applies | Toggle checked then unchecked | 1 Enter baseline. 2 Change only this field. 3 Read checklist. 4 Save if enabled and inspect History. | Both explicit states are retained in saved revision. |  | Not Tested |  |
| SLAB-01 | Slabs | Contiguous slabs | Unsaved N baseline with exact seven-row table | All slab rows | Exact seven-row New table in Part 1 | 1 Modify the stated row. 2 Keep other baseline values. 3 Check Save/checklist. 4 Inspect saved slab rows only for valid cases. | Accepted with one unlimited final row. |  | Not Tested |  |
| SLAB-02 | Slabs | Missing slabs | Unsaved N baseline with exact seven-row table | Slab rows | Remove all rows | 1 Modify the stated row. 2 Keep other baseline values. 3 Check Save/checklist. 4 Inspect saved slab rows only for valid cases. | Complete tax slabs required; save blocked. |  | Not Tested |  |
| SLAB-03 | Slabs | Missing zero start | Unsaved N baseline with exact seven-row table | First From | 1 | 1 Modify the stated row. 2 Keep other baseline values. 3 Check Save/checklist. 4 Inspect saved slab rows only for valid cases. | First tax slab must start at zero. |  | Not Tested |  |
| SLAB-04 | Slabs | Overlap | Unsaved N baseline with exact seven-row table | Second From | 399999 | 1 Modify the stated row. 2 Keep other baseline values. 3 Check Save/checklist. 4 Inspect saved slab rows only for valid cases. | Gap/overlap message; save blocked. |  | Not Tested |  |
| SLAB-05 | Slabs | Gap | Unsaved N baseline with exact seven-row table | Second From | 400001 | 1 Modify the stated row. 2 Keep other baseline values. 3 Check Save/checklist. 4 Inspect saved slab rows only for valid cases. | Gap/overlap message; save blocked. |  | Not Tested |  |
| SLAB-06 | Slabs | Duplicate boundary | Unsaved N baseline with exact seven-row table | Second From | 0 | 1 Modify the stated row. 2 Keep other baseline values. 3 Check Save/checklist. 4 Inspect saved slab rows only for valid cases. | Duplicate/overlap message; save blocked. |  | Not Tested |  |
| SLAB-07 | Slabs | Negative amount | Unsaved N baseline with exact seven-row table | First From | -1 | 1 Modify the stated row. 2 Keep other baseline values. 3 Check Save/checklist. 4 Inspect saved slab rows only for valid cases. | Non-negative amount error; save blocked. |  | Not Tested |  |
| SLAB-08 | Slabs | Negative rate | Unsaved N baseline with exact seven-row table | Second Rate | -1 | 1 Modify the stated row. 2 Keep other baseline values. 3 Check Save/checklist. 4 Inspect saved slab rows only for valid cases. | Rate must be 0–100; save blocked. |  | Not Tested |  |
| SLAB-09 | Slabs | Excessive rate | Unsaved N baseline with exact seven-row table | Second Rate | 101 | 1 Modify the stated row. 2 Keep other baseline values. 3 Check Save/checklist. 4 Inspect saved slab rows only for valid cases. | Rate must be 0–100; save blocked. |  | Not Tested |  |
| SLAB-10 | Slabs | Valid blank final upper limit | Unsaved N baseline with exact seven-row table | Last To | Blank | 1 Modify the stated row. 2 Keep other baseline values. 3 Check Save/checklist. 4 Inspect saved slab rows only for valid cases. | Correct unlimited final row; valid with other fields complete. |  | Not Tested |  |
| SLAB-11 | Slabs | Finite final upper limit | Unsaved N baseline with exact seven-row table | Last To | 2800000 | 1 Modify the stated row. 2 Keep other baseline values. 3 Check Save/checklist. 4 Inspect saved slab rows only for valid cases. | Final row must be unlimited; save blocked. |  | Not Tested |  |
| SLAB-12 | Slabs | Multiple unlimited rows | Unsaved N baseline with exact seven-row table | First To and last To | Both blank | 1 Modify the stated row. 2 Keep other baseline values. 3 Check Save/checklist. 4 Inspect saved slab rows only for valid cases. | Only final row may be unlimited; save blocked. |  | Not Tested |  |
| SLAB-13 | Slabs | Remove middle row | Unsaved N baseline with exact seven-row table | Slab 3 | Click Remove in row 3 | 1 Modify the stated row. 2 Keep other baseline values. 3 Check Save/checklist. 4 Inspect saved slab rows only for valid cases. | Gap is reported until contiguous boundaries are restored. |  | Not Tested |  |
| SLAB-14 | Slabs | Add row | Unsaved N baseline with exact seven-row table | Add slab | Click once | 1 Modify the stated row. 2 Keep other baseline values. 3 Check Save/checklist. 4 Inspect saved slab rows only for valid cases. | One additional editable row appears; no other fields are erased. |  | Not Tested |  |
| SLAB-15 | Slabs | Reorder complete rows | Unsaved N baseline with exact seven-row table | Slab row order | Enter last complete row first, retain exact table values | 1 Modify the stated row. 2 Keep other baseline values. 3 Check Save/checklist. 4 Inspect saved slab rows only for valid cases. | Accepted if complete; saved History is sorted by From. |  | Not Tested |  |
| SUR-01 | Tax Master | No surcharge rows | Unsaved N baseline | Surcharge tiers | Remove all tiers | 1 Change the listed surcharge entry. 2 Read validation. 3 Save valid structure only. | Valid structure; no fabricated tiers added. This is a validation case, not an approved high-income production master. |  | Not Tested |  |
| SUR-02 | Tax Master | Valid increasing tiers | Unsaved N baseline | Threshold / rate | 5000000/10; 10000000/15; 20000000/25 | 1 Change the listed surcharge entry. 2 Read validation. 3 Save valid structure only. | Valid with complete baseline; values retained. |  | Not Tested |  |
| SUR-03 | Tax Master | Duplicate threshold | Unsaved N baseline | Second Threshold | 5000000 | 1 Change the listed surcharge entry. 2 Read validation. 3 Save valid structure only. | Strictly increasing thresholds error. |  | Not Tested |  |
| SUR-04 | Tax Master | Decreasing threshold | Unsaved N baseline | Second Threshold | 4000000 | 1 Change the listed surcharge entry. 2 Read validation. 3 Save valid structure only. | Strictly increasing thresholds error. |  | Not Tested |  |
| SUR-05 | Tax Master | Negative threshold | Unsaved N baseline | First Threshold | -1 | 1 Change the listed surcharge entry. 2 Read validation. 3 Save valid structure only. | Non-negative threshold error. |  | Not Tested |  |
| SUR-06 | Tax Master | Negative rate | Unsaved N baseline | First Rate | -1 | 1 Change the listed surcharge entry. 2 Read validation. 3 Save valid structure only. | Rate 0–100 error. |  | Not Tested |  |
| SUR-07 | Tax Master | Excessive rate | Unsaved N baseline | First Rate | 101 | 1 Change the listed surcharge entry. 2 Read validation. 3 Save valid structure only. | Rate 0–100 error. |  | Not Tested |  |
| SUR-08 | Tax Master | Decreasing rate | Unsaved N baseline | Second Rate | 5 | 1 Change the listed surcharge entry. 2 Read validation. 3 Save valid structure only. | Rates must not decrease. |  | Not Tested |  |
| SUR-09 | Tax Master | Add tier | Unsaved N baseline | Add surcharge tier | Click once | 1 Change the listed surcharge entry. 2 Read validation. 3 Save valid structure only. | One editable tier appears. |  | Not Tested |  |
| SUR-10 | Tax Master | Remove tier | Unsaved N baseline | Remove tier | Remove the last tier | 1 Change the listed surcharge entry. 2 Read validation. 3 Save valid structure only. | Only that draft row is removed; other inputs remain. |  | Not Tested |  |
| MAP-01 | Component Taxability | Refresh actual definitions | Safe QA organization; some cases require controlled automated fixtures | Load current salary components | Click once | 1 Perform the stated source/field change. 2 Click refresh if applicable. 3 Check names, values, count and validation. 4 Do not approve a real exemption from test data. | Loading indicator, new request, actual product names and loaded count. |  | Not Tested |  |
| MAP-02 | Component Taxability | Empty component response | Safe QA organization; some cases require controlled automated fixtures | Salary component response | Empty list, controlled automated fixture | 1 Perform the stated source/field change. 2 Click refresh if applicable. 3 Check names, values, count and validation. 4 Do not approve a real exemption from test data. | Meaningful empty message; no invented wage rows. Normal organizations initialize mandatory rows, so do not delete them to force this case. |  | Not Tested |  |
| MAP-03 | Component Taxability | Multiple components/order | Safe QA organization; some cases require controlled automated fixtures | Configured component names | Shift Allowance, Basic Salary, Employer Fund Amount in test fixture | 1 Perform the stated source/field change. 2 Click refresh if applicable. 3 Check names, values, count and validation. 4 Do not approve a real exemption from test data. | Correct actual names/identities; no assumption that row zero is Basic. |  | Not Tested |  |
| MAP-04 | Component Taxability | Employer amount handling | Safe QA organization; some cases require controlled automated fixtures | Configured employer earning vs statutory annual amount | Use the existing source classification | 1 Perform the stated source/field change. 2 Click refresh if applicable. 3 Check names, values, count and validation. 4 Do not approve a real exemption from test data. | Only an actual earning/allowance definition is mapped; statutory EPS/EPF/ESI cells are not fabricated rows. |  | Not Tested |  |
| MAP-05 | Component Taxability | New component | Safe QA organization; some cases require controlled automated fixtures | Salary Components → add a QA allowance | Name: QA Travel Cash; Code: QA_TRAVEL; category Allowance; fixed annual 12000; active | 1 Perform the stated source/field change. 2 Click refresh if applicable. 3 Check names, values, count and validation. 4 Do not approve a real exemption from test data. | After refresh one new QA Travel Cash row appears; old entries remain. No reference/treatment is auto-approved. |  | Not Tested |  |
| MAP-06 | Component Taxability | Inactive custom component | Safe QA organization; some cases require controlled automated fixtures | QA Travel Cash status | Inactive in separate QA Salary Components tab, then refresh | 1 Perform the stated source/field change. 2 Click refresh if applicable. 3 Check names, values, count and validation. 4 Do not approve a real exemption from test data. | Draft row retained with warning; explicit draft removal is offered; saved history unchanged. |  | Not Tested |  |
| MAP-07 | Component Taxability | Fully taxable | Safe QA organization; some cases require controlled automated fixtures | Actual component treatment | Fully taxable, with approved QA reference | 1 Perform the stated source/field change. 2 Click refresh if applicable. 3 Check names, values, count and validation. 4 Do not approve a real exemption from test data. | No exemption conditions requested; reference remains required. |  | Not Tested |  |
| MAP-08 | Component Taxability | Fully exempt | Safe QA organization; some cases require controlled automated fixtures | Actual component treatment | Fully exempt; conditions: QA validation fixture; reference: test-only evidence | 1 Perform the stated source/field change. 2 Click refresh if applicable. 3 Check names, values, count and validation. 4 Do not approve a real exemption from test data. | Metadata validates; do not treat this as a real approved exemption. |  | Not Tested |  |
| MAP-09 | Component Taxability | Partial percentage | Safe QA organization; some cases require controlled automated fixtures | Treatment / method / taxable % | Partially taxable / Taxable percentage / 50; documented QA conditions/reference | 1 Perform the stated source/field change. 2 Click refresh if applicable. 3 Check names, values, count and validation. 4 Do not approve a real exemption from test data. | Only taxablePercentage is sent, not a conflicting exempt amount. |  | Not Tested |  |
| MAP-10 | Component Taxability | Partial amount | Safe QA organization; some cases require controlled automated fixtures | Treatment / method / exempt amount | Partially taxable / Annual exempt amount / 12000; documented QA conditions/reference | 1 Perform the stated source/field change. 2 Click refresh if applicable. 3 Check names, values, count and validation. 4 Do not approve a real exemption from test data. | Only exemptAmount is sent; no second exemption method. |  | Not Tested |  |
| MAP-11 | Component Taxability | Conditional metadata | Safe QA organization; some cases require controlled automated fixtures | Treatment / conditions | Conditional; QA claim pending; test-only evidence | 1 Perform the stated source/field change. 2 Click refresh if applicable. 3 Check names, values, count and validation. 4 Do not approve a real exemption from test data. | Can save metadata; actual conditional tax calculation must still block for review. |  | Not Tested |  |
| MAP-12 | Component Taxability | Missing legal reference | Safe QA organization; some cases require controlled automated fixtures | [actual component name] — legal reference | Blank | 1 Perform the stated source/field change. 2 Click refresh if applicable. 3 Check names, values, count and validation. 4 Do not approve a real exemption from test data. | Legal reference is required for the actual product name; no reference0 identifier. |  | Not Tested |  |
| MAP-13 | Component Taxability | Duplicate mapping | Safe QA organization; some cases require controlled automated fixtures | Same original component twice | Automated malformed request | 1 Perform the stated source/field change. 2 Click refresh if applicable. 3 Check names, values, count and validation. 4 Do not approve a real exemption from test data. | Backend rejects; no partial revision. Normal refresh does not duplicate rows. |  | Not Tested |  |
| MAP-14 | Component Taxability | Missing original identity | Safe QA organization; some cases require controlled automated fixtures | Component identity in request | Blank, automated negative case | 1 Perform the stated source/field change. 2 Click refresh if applicable. 3 Check names, values, count and validation. 4 Do not approve a real exemption from test data. | Backend rejects. A tester never types a replacement identity. |  | Not Tested |  |
| MAP-15 | Component Taxability | Loading failure | Safe QA organization; some cases require controlled automated fixtures | Browser Network setting after form loads | Offline, then click Load current salary components | 1 Perform the stated source/field change. 2 Click refresh if applicable. 3 Check names, values, count and validation. 4 Do not approve a real exemption from test data. | Visible connection error; entered mappings remain; button recovers after request ends. |  | Not Tested |  |
| MAP-16 | Component Taxability | Repeated refresh | Safe QA organization; some cases require controlled automated fixtures | Load current salary components | Double click / refresh twice after completion | 1 Perform the stated source/field change. 2 Click refresh if applicable. 3 Check names, values, count and validation. 4 Do not approve a real exemption from test data. | One in-progress request at a time; one mapping per original component. |  | Not Tested |  |
| MAP-17 | Component Taxability | Preserve entered values | Safe QA organization; some cases require controlled automated fixtures | Treatment/reference/conditions | Set reviewed values, then refresh | 1 Perform the stated source/field change. 2 Click refresh if applicable. 3 Check names, values, count and validation. 4 Do not approve a real exemption from test data. | Existing manually entered values stay identical. |  | Not Tested |  |
| MAP-18 | Component Taxability | Unreviewed treatment | Safe QA organization; some cases require controlled automated fixtures | [actual name] — taxability treatment | Leave Select reviewed treatment | 1 Perform the stated source/field change. 2 Click refresh if applicable. 3 Check names, values, count and validation. 4 Do not approve a real exemption from test data. | Save blocked with actual component-name guidance. |  | Not Tested |  |
| MAP-19 | Component Taxability | Check every component reference separately | Safe QA organization; some cases require controlled automated fixtures | Basic Salary / Dearness Allowance / Retaining Allowance — legal reference | Clear one named reference at a time; restore it before clearing the next | 1 Perform the stated source/field change. 2 Click refresh if applicable. 3 Check names, values, count and validation. 4 Do not approve a real exemption from test data. | Each missing reference is identified by that exact product name; no reference0/reference1/reference2 text; Save blocks until all three are restored. |  | Not Tested |  |
| REV-01 | Tax Master | Complete save | Complete N or O baseline; isolated QA environment | All fields | N baseline including every mapping, both source URLs, review note, confirmation | 1 Complete/change stated fields. 2 Save or activate once. 3 Inspect notification and History. 4 For failures compare every entered value before retry. | One consistent new revision and success notice; full History visible. |  | Not Tested |  |
| REV-02 | Tax Master | Missing review note | Complete N or O baseline; isolated QA environment | Review note and taxability conditions | Blank or spaces | 1 Complete/change stated fields. 2 Save or activate once. 3 Inspect notification and History. 4 For failures compare every entered value before retry. | Review note is required; save blocked. |  | Not Tested |  |
| REV-03 | Tax Master | Missing sources | Complete N or O baseline; isolated QA environment | Official source URLs | Blank | 1 Complete/change stated fields. 2 Save or activate once. 3 Inspect notification and History. 4 For failures compare every entered value before retry. | Official source URLs are required; save blocked. |  | Not Tested |  |
| REV-04 | Tax Master | Nonofficial URL | Complete N or O baseline; isolated QA environment | Official source URLs | https://example.com/tax | 1 Complete/change stated fields. 2 Save or activate once. 3 Inspect notification and History. 4 For failures compare every entered value before retry. | Official HTTPS source message; save blocked. |  | Not Tested |  |
| REV-05 | Tax Master | Missing employer review | Complete N or O baseline; isolated QA environment | Employer contribution review checkbox | Unchecked | 1 Complete/change stated fields. 2 Save or activate once. 3 Inspect notification and History. 4 For failures compare every entered value before retry. | Employer contribution review confirmation is required; save blocked. |  | Not Tested |  |
| REV-06 | Tax Master | Double save | Complete N or O baseline; isolated QA environment | Save new revision | Double click a valid draft | 1 Complete/change stated fields. 2 Save or activate once. 3 Inspect notification and History. 4 For failures compare every entered value before retry. | One new revision only; pending operation blocks another submission. |  | Not Tested |  |
| REV-07 | Tax Master | Network failure | Complete N or O baseline; isolated QA environment | Network setting after filling draft | Offline before save, then restore online | 1 Complete/change stated fields. 2 Save or activate once. 3 Inspect notification and History. 4 For failures compare every entered value before retry. | Connection error; complete draft retained; retry works. |  | Not Tested |  |
| REV-08 | Tax Master | Backend conflict | Complete N or O baseline; isolated QA environment | Second administrator changes configuration | Save a year/revision in another QA tab before first tab submits | 1 Complete/change stated fields. 2 Save or activate once. 3 Inspect notification and History. 4 For failures compare every entered value before retry. | Visible stale-version error; no partial revision; first tab retains entries for review/reload. |  | Not Tested |  |
| REV-09 | Tax Master | History preserved | Complete N or O baseline; isolated QA environment | Copy to editor / Standard deduction | Copy prior QA revision, change test review note only, save | 1 Complete/change stated fields. 2 Save or activate once. 3 Inspect notification and History. 4 For failures compare every entered value before retry. | New version added; original rule values/names remain unchanged. |  | Not Tested |  |
| REV-10 | Tax Master | Stale activation | Complete N or O baseline; isolated QA environment | Activate prior revision after a component change | Make QA Travel Cash active after older revision was saved | 1 Complete/change stated fields. 2 Save or activate once. 3 Inspect notification and History. 4 For failures compare every entered value before retry. | Activation blocked with load-current/save-new-revision guidance; history retained. |  | Not Tested |  |
| REV-11 | Tax Master | Activate valid revision | Complete N or O baseline; isolated QA environment | Activate revision / Confirm | Current complete saved revision | 1 Complete/change stated fields. 2 Save or activate once. 3 Inspect notification and History. 4 For failures compare every entered value before retry. | Published marker changes; confirmation/audit retained; old versions stay visible. |  | Not Tested |  |

## Part 3 — Annual tax calculations, fully worked

### Controlled salary inputs for these eight cases

Use a dedicated QA organization with unchanged formulas throughout this comparison: BASIC = 40% of existing Gross; DA = 10% of BASIC; RA = 15% of BASIC. Set employer EPS/EPF/ESI percentages to zero **only in this disposable fixture**, all employee statutory settings to zero, and add one ordinary non-tax-claim deduction **QA Other Deduction**, fixed **5000 per month** (60000 annually), visible in payslips. This QA deduction is not a professional-tax/80C claim. Do not apply this fixture to actual employees or treat zero contributions as statutory compliance.

In this specific fixture the existing generator gives annual Gross = CTC − employer EPS − employer EPF − employer ESI = CTC − 0 − 0 − 0. In general CTC is not automatically taxable Gross. BASIC/DA/RA are descriptive overlapping salary cells; do not add them to recreate Gross. Remaining reported Gross remains ordinary taxable wage income in this fixture. No component has an exemption.

Create **one separate employee per case** using name QA + the case ID, email e.g. qa.calc.n01@example.test, date of birth **01-01-1990**, hire date **01-04-2025**, status **Active**, pay frequency **Monthly**, and the exact case CTC. Names/emails are test-only. Set the employee's tax year/regime, TDS applicable Yes, and confirm resident, salary-only, operative PAN and full-year employment only for the controlled QA facts. Save profile, then calculate. No previous submitted payroll or prior-employer income/TDS may exist.

The eight expected values below were independently worked from the cited FY2026–27 rules, then compared with the existing annual salary engine plus tax engine. Expected values live in test/fixtures/fy2026-27-salary-only.json; the tests assert every slab, relief, cess, annual liability, twelve allocations and reported Net Pay. They do not generate their expected answers by calling the tax engine.

### CALC-N01 — New regime; annual CTC ₹6,00,000.00

| Test Case ID | Feature | Test Scenario | Preconditions | Input Field | Input Value | Steps | Expected Result | Actual Result | Status | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CALC-N01 | TDS Calculation | Verify every annual and monthly amount | Controlled salary fixture above; correct published N/O revision; new QA employee | Annual CTC / Regime | 600000 / new | 1 Create the separate QA employee. 2 Check generator annual outputs below. 3 Save the per-year tax profile. 4 Calculate annual TDS. 5 Compare every row below. | Exact breakdown below; record discrepancies before payroll. |  | Not Tested |  |

| Existing annual salary input | Exact expected value |
| --- | ---: |
| Annual CTC | ₹6,00,000.00 |
| Employer EPS | ₹0.00 |
| Employer EPF | ₹0.00 |
| Employer ESI | ₹0.00 |
| Existing annual Gross Wages | ₹6,00,000.00 |
| BASIC = Gross × 40% | ₹2,40,000.00 |
| DA = BASIC × 10% | ₹24,000.00 |
| RA = BASIC × 15% | ₹36,000.00 |
| Remaining reported Gross = Gross − BASIC − DA − RA | ₹3,00,000.00 |
| Existing annual employee deduction = 5000 × 12 | ₹60,000.00 |

Annual taxable salary = existing Gross ₹6,00,000.00 − exemptions ₹0.00 = ₹6,00,000.00.

Taxable income = ₹6,00,000.00 − standard deduction ₹75,000.00 = **₹5,25,000.00**. All case incomes are already multiples of ₹10.

| Slab | Taxable slice | Calculation | Expected tax |
| --- | ---: | --- | ---: |
| ₹0.00 to ₹4,00,000.00 | ₹4,00,000.00 | ₹4,00,000.00 × 0% | ₹0.00 |
| ₹4,00,000.00 to ₹8,00,000.00 | ₹1,25,000.00 | ₹1,25,000.00 × 5% | ₹6,250.00 |
| ₹8,00,000.00 to ₹12,00,000.00 | ₹0.00 | ₹0.00 × 10% | ₹0.00 |
| ₹12,00,000.00 to ₹16,00,000.00 | ₹0.00 | ₹0.00 × 15% | ₹0.00 |
| ₹16,00,000.00 to ₹20,00,000.00 | ₹0.00 | ₹0.00 × 20% | ₹0.00 |
| ₹20,00,000.00 to ₹24,00,000.00 | ₹0.00 | ₹0.00 × 25% | ₹0.00 |
| ₹24,00,000.00 to unlimited | ₹0.00 | ₹0.00 × 30% | ₹0.00 |

Tax before rebate = sum of slab taxes = **₹6,250.00**.

Taxable income is within the resident rebate limit; rebate = lower of tax ₹6,250.00 and maximum rebate ₹60,000.00 = **₹6,250.00**.

Rebate marginal relief = **₹0.00** for this case.

Surcharge = **₹0.00**; taxable income does not exceed ₹50 lakh. Surcharge marginal relief = **₹0.00**.

Cess base = tax ₹6,250.00 − rebate ₹6,250.00 − rebate relief ₹0.00 + surcharge ₹0.00 − surcharge relief ₹0.00 = ₹0.00.

Cess = ₹0.00 × 4% = **₹0.00**.

Annual estimated tax before final rounding = ₹0.00 + ₹0.00 = ₹0.00. Discard paise and round to nearest ₹10: **Annual tax = Annual TDS = ₹0.00**.

Monthly TDS: annual ₹0.00 / 12; months 1–11 receive **₹0.00**. Month 12 receives annual ₹0.00 − (11 × ₹0.00) = **₹0.00**. The twelve deductions total exactly ₹0.00.

Existing monthly Gross = annual Gross / 12, reported to paise = **₹50,000.00**. Existing monthly deductions = **₹5,000.00**.

Net Pay for months 1–11 = ₹50,000.00 − ₹5,000.00 − ₹0.00 = **₹45,000.00**. Final-month Net Pay = ₹50,000.00 − ₹5,000.00 − ₹0.00 = **₹45,000.00**. Gross and pre-existing deductions remain unchanged.

### CALC-N02 — New regime; annual CTC ₹12,75,000.00

| Test Case ID | Feature | Test Scenario | Preconditions | Input Field | Input Value | Steps | Expected Result | Actual Result | Status | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CALC-N02 | TDS Calculation | Verify every annual and monthly amount | Controlled salary fixture above; correct published N/O revision; new QA employee | Annual CTC / Regime | 1275000 / new | 1 Create the separate QA employee. 2 Check generator annual outputs below. 3 Save the per-year tax profile. 4 Calculate annual TDS. 5 Compare every row below. | Exact breakdown below; record discrepancies before payroll. |  | Not Tested |  |

| Existing annual salary input | Exact expected value |
| --- | ---: |
| Annual CTC | ₹12,75,000.00 |
| Employer EPS | ₹0.00 |
| Employer EPF | ₹0.00 |
| Employer ESI | ₹0.00 |
| Existing annual Gross Wages | ₹12,75,000.00 |
| BASIC = Gross × 40% | ₹5,10,000.00 |
| DA = BASIC × 10% | ₹51,000.00 |
| RA = BASIC × 15% | ₹76,500.00 |
| Remaining reported Gross = Gross − BASIC − DA − RA | ₹6,37,500.00 |
| Existing annual employee deduction = 5000 × 12 | ₹60,000.00 |

Annual taxable salary = existing Gross ₹12,75,000.00 − exemptions ₹0.00 = ₹12,75,000.00.

Taxable income = ₹12,75,000.00 − standard deduction ₹75,000.00 = **₹12,00,000.00**. All case incomes are already multiples of ₹10.

| Slab | Taxable slice | Calculation | Expected tax |
| --- | ---: | --- | ---: |
| ₹0.00 to ₹4,00,000.00 | ₹4,00,000.00 | ₹4,00,000.00 × 0% | ₹0.00 |
| ₹4,00,000.00 to ₹8,00,000.00 | ₹4,00,000.00 | ₹4,00,000.00 × 5% | ₹20,000.00 |
| ₹8,00,000.00 to ₹12,00,000.00 | ₹4,00,000.00 | ₹4,00,000.00 × 10% | ₹40,000.00 |
| ₹12,00,000.00 to ₹16,00,000.00 | ₹0.00 | ₹0.00 × 15% | ₹0.00 |
| ₹16,00,000.00 to ₹20,00,000.00 | ₹0.00 | ₹0.00 × 20% | ₹0.00 |
| ₹20,00,000.00 to ₹24,00,000.00 | ₹0.00 | ₹0.00 × 25% | ₹0.00 |
| ₹24,00,000.00 to unlimited | ₹0.00 | ₹0.00 × 30% | ₹0.00 |

Tax before rebate = sum of slab taxes = **₹60,000.00**.

Taxable income is within the resident rebate limit; rebate = lower of tax ₹60,000.00 and maximum rebate ₹60,000.00 = **₹60,000.00**.

Rebate marginal relief = **₹0.00** for this case.

Surcharge = **₹0.00**; taxable income does not exceed ₹50 lakh. Surcharge marginal relief = **₹0.00**.

Cess base = tax ₹60,000.00 − rebate ₹60,000.00 − rebate relief ₹0.00 + surcharge ₹0.00 − surcharge relief ₹0.00 = ₹0.00.

Cess = ₹0.00 × 4% = **₹0.00**.

Annual estimated tax before final rounding = ₹0.00 + ₹0.00 = ₹0.00. Discard paise and round to nearest ₹10: **Annual tax = Annual TDS = ₹0.00**.

Monthly TDS: annual ₹0.00 / 12; months 1–11 receive **₹0.00**. Month 12 receives annual ₹0.00 − (11 × ₹0.00) = **₹0.00**. The twelve deductions total exactly ₹0.00.

Existing monthly Gross = annual Gross / 12, reported to paise = **₹1,06,250.00**. Existing monthly deductions = **₹5,000.00**.

Net Pay for months 1–11 = ₹1,06,250.00 − ₹5,000.00 − ₹0.00 = **₹1,01,250.00**. Final-month Net Pay = ₹1,06,250.00 − ₹5,000.00 − ₹0.00 = **₹1,01,250.00**. Gross and pre-existing deductions remain unchanged.

### CALC-N03 — New regime; annual CTC ₹16,75,000.00

| Test Case ID | Feature | Test Scenario | Preconditions | Input Field | Input Value | Steps | Expected Result | Actual Result | Status | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CALC-N03 | TDS Calculation | Verify every annual and monthly amount | Controlled salary fixture above; correct published N/O revision; new QA employee | Annual CTC / Regime | 1675000 / new | 1 Create the separate QA employee. 2 Check generator annual outputs below. 3 Save the per-year tax profile. 4 Calculate annual TDS. 5 Compare every row below. | Exact breakdown below; record discrepancies before payroll. |  | Not Tested |  |

| Existing annual salary input | Exact expected value |
| --- | ---: |
| Annual CTC | ₹16,75,000.00 |
| Employer EPS | ₹0.00 |
| Employer EPF | ₹0.00 |
| Employer ESI | ₹0.00 |
| Existing annual Gross Wages | ₹16,75,000.00 |
| BASIC = Gross × 40% | ₹6,70,000.00 |
| DA = BASIC × 10% | ₹67,000.00 |
| RA = BASIC × 15% | ₹1,00,500.00 |
| Remaining reported Gross = Gross − BASIC − DA − RA | ₹8,37,500.00 |
| Existing annual employee deduction = 5000 × 12 | ₹60,000.00 |

Annual taxable salary = existing Gross ₹16,75,000.00 − exemptions ₹0.00 = ₹16,75,000.00.

Taxable income = ₹16,75,000.00 − standard deduction ₹75,000.00 = **₹16,00,000.00**. All case incomes are already multiples of ₹10.

| Slab | Taxable slice | Calculation | Expected tax |
| --- | ---: | --- | ---: |
| ₹0.00 to ₹4,00,000.00 | ₹4,00,000.00 | ₹4,00,000.00 × 0% | ₹0.00 |
| ₹4,00,000.00 to ₹8,00,000.00 | ₹4,00,000.00 | ₹4,00,000.00 × 5% | ₹20,000.00 |
| ₹8,00,000.00 to ₹12,00,000.00 | ₹4,00,000.00 | ₹4,00,000.00 × 10% | ₹40,000.00 |
| ₹12,00,000.00 to ₹16,00,000.00 | ₹4,00,000.00 | ₹4,00,000.00 × 15% | ₹60,000.00 |
| ₹16,00,000.00 to ₹20,00,000.00 | ₹0.00 | ₹0.00 × 20% | ₹0.00 |
| ₹20,00,000.00 to ₹24,00,000.00 | ₹0.00 | ₹0.00 × 25% | ₹0.00 |
| ₹24,00,000.00 to unlimited | ₹0.00 | ₹0.00 × 30% | ₹0.00 |

Tax before rebate = sum of slab taxes = **₹1,20,000.00**.

Taxable income exceeds the rebate eligibility limit; rebate = **₹0.00**.

Rebate marginal relief = **₹0.00** for this case.

Surcharge = **₹0.00**; taxable income does not exceed ₹50 lakh. Surcharge marginal relief = **₹0.00**.

Cess base = tax ₹1,20,000.00 − rebate ₹0.00 − rebate relief ₹0.00 + surcharge ₹0.00 − surcharge relief ₹0.00 = ₹1,20,000.00.

Cess = ₹1,20,000.00 × 4% = **₹4,800.00**.

Annual estimated tax before final rounding = ₹1,20,000.00 + ₹4,800.00 = ₹1,24,800.00. Discard paise and round to nearest ₹10: **Annual tax = Annual TDS = ₹1,24,800.00**.

Monthly TDS: annual ₹1,24,800.00 / 12; months 1–11 receive **₹10,400.00**. Month 12 receives annual ₹1,24,800.00 − (11 × ₹10,400.00) = **₹10,400.00**. The twelve deductions total exactly ₹1,24,800.00.

Existing monthly Gross = annual Gross / 12, reported to paise = **₹1,39,583.33**. Existing monthly deductions = **₹5,000.00**.

Net Pay for months 1–11 = ₹1,39,583.33 − ₹5,000.00 − ₹10,400.00 = **₹1,24,183.33**. Final-month Net Pay = ₹1,39,583.33 − ₹5,000.00 − ₹10,400.00 = **₹1,24,183.33**. Gross and pre-existing deductions remain unchanged.

### CALC-N04 — New regime; annual CTC ₹24,75,000.00

| Test Case ID | Feature | Test Scenario | Preconditions | Input Field | Input Value | Steps | Expected Result | Actual Result | Status | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CALC-N04 | TDS Calculation | Verify every annual and monthly amount | Controlled salary fixture above; correct published N/O revision; new QA employee | Annual CTC / Regime | 2475000 / new | 1 Create the separate QA employee. 2 Check generator annual outputs below. 3 Save the per-year tax profile. 4 Calculate annual TDS. 5 Compare every row below. | Exact breakdown below; record discrepancies before payroll. |  | Not Tested |  |

| Existing annual salary input | Exact expected value |
| --- | ---: |
| Annual CTC | ₹24,75,000.00 |
| Employer EPS | ₹0.00 |
| Employer EPF | ₹0.00 |
| Employer ESI | ₹0.00 |
| Existing annual Gross Wages | ₹24,75,000.00 |
| BASIC = Gross × 40% | ₹9,90,000.00 |
| DA = BASIC × 10% | ₹99,000.00 |
| RA = BASIC × 15% | ₹1,48,500.00 |
| Remaining reported Gross = Gross − BASIC − DA − RA | ₹12,37,500.00 |
| Existing annual employee deduction = 5000 × 12 | ₹60,000.00 |

Annual taxable salary = existing Gross ₹24,75,000.00 − exemptions ₹0.00 = ₹24,75,000.00.

Taxable income = ₹24,75,000.00 − standard deduction ₹75,000.00 = **₹24,00,000.00**. All case incomes are already multiples of ₹10.

| Slab | Taxable slice | Calculation | Expected tax |
| --- | ---: | --- | ---: |
| ₹0.00 to ₹4,00,000.00 | ₹4,00,000.00 | ₹4,00,000.00 × 0% | ₹0.00 |
| ₹4,00,000.00 to ₹8,00,000.00 | ₹4,00,000.00 | ₹4,00,000.00 × 5% | ₹20,000.00 |
| ₹8,00,000.00 to ₹12,00,000.00 | ₹4,00,000.00 | ₹4,00,000.00 × 10% | ₹40,000.00 |
| ₹12,00,000.00 to ₹16,00,000.00 | ₹4,00,000.00 | ₹4,00,000.00 × 15% | ₹60,000.00 |
| ₹16,00,000.00 to ₹20,00,000.00 | ₹4,00,000.00 | ₹4,00,000.00 × 20% | ₹80,000.00 |
| ₹20,00,000.00 to ₹24,00,000.00 | ₹4,00,000.00 | ₹4,00,000.00 × 25% | ₹1,00,000.00 |
| ₹24,00,000.00 to unlimited | ₹0.00 | ₹0.00 × 30% | ₹0.00 |

Tax before rebate = sum of slab taxes = **₹3,00,000.00**.

Taxable income exceeds the rebate eligibility limit; rebate = **₹0.00**.

Rebate marginal relief = **₹0.00** for this case.

Surcharge = **₹0.00**; taxable income does not exceed ₹50 lakh. Surcharge marginal relief = **₹0.00**.

Cess base = tax ₹3,00,000.00 − rebate ₹0.00 − rebate relief ₹0.00 + surcharge ₹0.00 − surcharge relief ₹0.00 = ₹3,00,000.00.

Cess = ₹3,00,000.00 × 4% = **₹12,000.00**.

Annual estimated tax before final rounding = ₹3,00,000.00 + ₹12,000.00 = ₹3,12,000.00. Discard paise and round to nearest ₹10: **Annual tax = Annual TDS = ₹3,12,000.00**.

Monthly TDS: annual ₹3,12,000.00 / 12; months 1–11 receive **₹26,000.00**. Month 12 receives annual ₹3,12,000.00 − (11 × ₹26,000.00) = **₹26,000.00**. The twelve deductions total exactly ₹3,12,000.00.

Existing monthly Gross = annual Gross / 12, reported to paise = **₹2,06,250.00**. Existing monthly deductions = **₹5,000.00**.

Net Pay for months 1–11 = ₹2,06,250.00 − ₹5,000.00 − ₹26,000.00 = **₹1,75,250.00**. Final-month Net Pay = ₹2,06,250.00 − ₹5,000.00 − ₹26,000.00 = **₹1,75,250.00**. Gross and pre-existing deductions remain unchanged.

### CALC-N05 — New regime; annual CTC ₹12,75,010.00

| Test Case ID | Feature | Test Scenario | Preconditions | Input Field | Input Value | Steps | Expected Result | Actual Result | Status | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CALC-N05 | TDS Calculation | Verify every annual and monthly amount | Controlled salary fixture above; correct published N/O revision; new QA employee | Annual CTC / Regime | 1275010 / new | 1 Create the separate QA employee. 2 Check generator annual outputs below. 3 Save the per-year tax profile. 4 Calculate annual TDS. 5 Compare every row below. | Exact breakdown below; record discrepancies before payroll. |  | Not Tested |  |

| Existing annual salary input | Exact expected value |
| --- | ---: |
| Annual CTC | ₹12,75,010.00 |
| Employer EPS | ₹0.00 |
| Employer EPF | ₹0.00 |
| Employer ESI | ₹0.00 |
| Existing annual Gross Wages | ₹12,75,010.00 |
| BASIC = Gross × 40% | ₹5,10,004.00 |
| DA = BASIC × 10% | ₹51,000.40 |
| RA = BASIC × 15% | ₹76,500.60 |
| Remaining reported Gross = Gross − BASIC − DA − RA | ₹6,37,505.00 |
| Existing annual employee deduction = 5000 × 12 | ₹60,000.00 |

Annual taxable salary = existing Gross ₹12,75,010.00 − exemptions ₹0.00 = ₹12,75,010.00.

Taxable income = ₹12,75,010.00 − standard deduction ₹75,000.00 = **₹12,00,010.00**. All case incomes are already multiples of ₹10.

| Slab | Taxable slice | Calculation | Expected tax |
| --- | ---: | --- | ---: |
| ₹0.00 to ₹4,00,000.00 | ₹4,00,000.00 | ₹4,00,000.00 × 0% | ₹0.00 |
| ₹4,00,000.00 to ₹8,00,000.00 | ₹4,00,000.00 | ₹4,00,000.00 × 5% | ₹20,000.00 |
| ₹8,00,000.00 to ₹12,00,000.00 | ₹4,00,000.00 | ₹4,00,000.00 × 10% | ₹40,000.00 |
| ₹12,00,000.00 to ₹16,00,000.00 | ₹10.00 | ₹10.00 × 15% | ₹1.50 |
| ₹16,00,000.00 to ₹20,00,000.00 | ₹0.00 | ₹0.00 × 20% | ₹0.00 |
| ₹20,00,000.00 to ₹24,00,000.00 | ₹0.00 | ₹0.00 × 25% | ₹0.00 |
| ₹24,00,000.00 to unlimited | ₹0.00 | ₹0.00 × 30% | ₹0.00 |

Tax before rebate = sum of slab taxes = **₹60,001.50**.

Taxable income exceeds the rebate eligibility limit; rebate = **₹0.00**.

Rebate marginal relief: excess income = ₹12,00,010.00 − ₹12,00,000.00 = ₹10.00. Relief = ₹60,001.50 − ₹10.00 = **₹59,991.50**. Tax after relief = ₹10.00.

Surcharge = **₹0.00**; taxable income does not exceed ₹50 lakh. Surcharge marginal relief = **₹0.00**.

Cess base = tax ₹60,001.50 − rebate ₹0.00 − rebate relief ₹59,991.50 + surcharge ₹0.00 − surcharge relief ₹0.00 = ₹10.00.

Cess = ₹10.00 × 4% = **₹0.40**.

Annual estimated tax before final rounding = ₹10.00 + ₹0.40 = ₹10.40. Discard paise and round to nearest ₹10: **Annual tax = Annual TDS = ₹10.00**.

Monthly TDS: annual ₹10.00 / 12; months 1–11 receive **₹0.83**. Month 12 receives annual ₹10.00 − (11 × ₹0.83) = **₹0.87**. The twelve deductions total exactly ₹10.00.

Existing monthly Gross = annual Gross / 12, reported to paise = **₹1,06,250.83**. Existing monthly deductions = **₹5,000.00**.

Net Pay for months 1–11 = ₹1,06,250.83 − ₹5,000.00 − ₹0.83 = **₹1,01,250.00**. Final-month Net Pay = ₹1,06,250.83 − ₹5,000.00 − ₹0.87 = **₹1,01,249.96**. Gross and pre-existing deductions remain unchanged.

### CALC-N06 — New regime; annual CTC ₹50,75,010.00

| Test Case ID | Feature | Test Scenario | Preconditions | Input Field | Input Value | Steps | Expected Result | Actual Result | Status | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CALC-N06 | TDS Calculation | Verify every annual and monthly amount | Controlled salary fixture above; correct published N/O revision; new QA employee | Annual CTC / Regime | 5075010 / new | 1 Create the separate QA employee. 2 Check generator annual outputs below. 3 Save the per-year tax profile. 4 Calculate annual TDS. 5 Compare every row below. | Exact breakdown below; record discrepancies before payroll. |  | Not Tested |  |

| Existing annual salary input | Exact expected value |
| --- | ---: |
| Annual CTC | ₹50,75,010.00 |
| Employer EPS | ₹0.00 |
| Employer EPF | ₹0.00 |
| Employer ESI | ₹0.00 |
| Existing annual Gross Wages | ₹50,75,010.00 |
| BASIC = Gross × 40% | ₹20,30,004.00 |
| DA = BASIC × 10% | ₹2,03,000.40 |
| RA = BASIC × 15% | ₹3,04,500.60 |
| Remaining reported Gross = Gross − BASIC − DA − RA | ₹25,37,505.00 |
| Existing annual employee deduction = 5000 × 12 | ₹60,000.00 |

Annual taxable salary = existing Gross ₹50,75,010.00 − exemptions ₹0.00 = ₹50,75,010.00.

Taxable income = ₹50,75,010.00 − standard deduction ₹75,000.00 = **₹50,00,010.00**. All case incomes are already multiples of ₹10.

| Slab | Taxable slice | Calculation | Expected tax |
| --- | ---: | --- | ---: |
| ₹0.00 to ₹4,00,000.00 | ₹4,00,000.00 | ₹4,00,000.00 × 0% | ₹0.00 |
| ₹4,00,000.00 to ₹8,00,000.00 | ₹4,00,000.00 | ₹4,00,000.00 × 5% | ₹20,000.00 |
| ₹8,00,000.00 to ₹12,00,000.00 | ₹4,00,000.00 | ₹4,00,000.00 × 10% | ₹40,000.00 |
| ₹12,00,000.00 to ₹16,00,000.00 | ₹4,00,000.00 | ₹4,00,000.00 × 15% | ₹60,000.00 |
| ₹16,00,000.00 to ₹20,00,000.00 | ₹4,00,000.00 | ₹4,00,000.00 × 20% | ₹80,000.00 |
| ₹20,00,000.00 to ₹24,00,000.00 | ₹4,00,000.00 | ₹4,00,000.00 × 25% | ₹1,00,000.00 |
| ₹24,00,000.00 to unlimited | ₹26,00,010.00 | ₹26,00,010.00 × 30% | ₹7,80,003.00 |

Tax before rebate = sum of slab taxes = **₹10,80,003.00**.

Taxable income exceeds the rebate eligibility limit; rebate = **₹0.00**.

Rebate marginal relief = **₹0.00** for this case.

Surcharge = ₹10,80,003.00 × 10% = **₹1,08,000.30**.

At taxable income ₹50,00,000.00, slab tax = ₹3,00,000.00 + (₹26,00,000.00 × 30%) = ₹10,80,000.00. Excess income = ₹10.00. The marginal-relief cap is ₹10,80,000.00 + ₹10.00 = ₹10,80,010.00. Before relief, tax plus surcharge = ₹10,80,003.00 + ₹1,08,000.30 = ₹11,88,003.30. Surcharge marginal relief = ₹11,88,003.30 − ₹10,80,010.00 = **₹1,07,993.30**.

Cess base = tax ₹10,80,003.00 − rebate ₹0.00 − rebate relief ₹0.00 + surcharge ₹1,08,000.30 − surcharge relief ₹1,07,993.30 = ₹10,80,010.00.

Cess = ₹10,80,010.00 × 4% = **₹43,200.40**.

Annual estimated tax before final rounding = ₹10,80,010.00 + ₹43,200.40 = ₹11,23,210.40. Discard paise and round to nearest ₹10: **Annual tax = Annual TDS = ₹11,23,210.00**.

Monthly TDS: annual ₹11,23,210.00 / 12; months 1–11 receive **₹93,600.83**. Month 12 receives annual ₹11,23,210.00 − (11 × ₹93,600.83) = **₹93,600.87**. The twelve deductions total exactly ₹11,23,210.00.

Existing monthly Gross = annual Gross / 12, reported to paise = **₹4,22,917.50**. Existing monthly deductions = **₹5,000.00**.

Net Pay for months 1–11 = ₹4,22,917.50 − ₹5,000.00 − ₹93,600.83 = **₹3,24,316.67**. Final-month Net Pay = ₹4,22,917.50 − ₹5,000.00 − ₹93,600.87 = **₹3,24,316.63**. Gross and pre-existing deductions remain unchanged.

### CALC-O01 — Old regime; annual CTC ₹5,50,000.00

| Test Case ID | Feature | Test Scenario | Preconditions | Input Field | Input Value | Steps | Expected Result | Actual Result | Status | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CALC-O01 | TDS Calculation | Verify every annual and monthly amount | Controlled salary fixture above; correct published N/O revision; new QA employee | Annual CTC / Regime | 550000 / old | 1 Create the separate QA employee. 2 Check generator annual outputs below. 3 Save the per-year tax profile. 4 Calculate annual TDS. 5 Compare every row below. | Exact breakdown below; record discrepancies before payroll. |  | Not Tested |  |

| Existing annual salary input | Exact expected value |
| --- | ---: |
| Annual CTC | ₹5,50,000.00 |
| Employer EPS | ₹0.00 |
| Employer EPF | ₹0.00 |
| Employer ESI | ₹0.00 |
| Existing annual Gross Wages | ₹5,50,000.00 |
| BASIC = Gross × 40% | ₹2,20,000.00 |
| DA = BASIC × 10% | ₹22,000.00 |
| RA = BASIC × 15% | ₹33,000.00 |
| Remaining reported Gross = Gross − BASIC − DA − RA | ₹2,75,000.00 |
| Existing annual employee deduction = 5000 × 12 | ₹60,000.00 |

Annual taxable salary = existing Gross ₹5,50,000.00 − exemptions ₹0.00 = ₹5,50,000.00.

Taxable income = ₹5,50,000.00 − standard deduction ₹50,000.00 = **₹5,00,000.00**. All case incomes are already multiples of ₹10.

| Slab | Taxable slice | Calculation | Expected tax |
| --- | ---: | --- | ---: |
| ₹0.00 to ₹2,50,000.00 | ₹2,50,000.00 | ₹2,50,000.00 × 0% | ₹0.00 |
| ₹2,50,000.00 to ₹5,00,000.00 | ₹2,50,000.00 | ₹2,50,000.00 × 5% | ₹12,500.00 |
| ₹5,00,000.00 to ₹10,00,000.00 | ₹0.00 | ₹0.00 × 20% | ₹0.00 |
| ₹10,00,000.00 to unlimited | ₹0.00 | ₹0.00 × 30% | ₹0.00 |

Tax before rebate = sum of slab taxes = **₹12,500.00**.

Taxable income is within the resident rebate limit; rebate = lower of tax ₹12,500.00 and maximum rebate ₹12,500.00 = **₹12,500.00**.

Rebate marginal relief = **₹0.00** for this case.

Surcharge = **₹0.00**; taxable income does not exceed ₹50 lakh. Surcharge marginal relief = **₹0.00**.

Cess base = tax ₹12,500.00 − rebate ₹12,500.00 − rebate relief ₹0.00 + surcharge ₹0.00 − surcharge relief ₹0.00 = ₹0.00.

Cess = ₹0.00 × 4% = **₹0.00**.

Annual estimated tax before final rounding = ₹0.00 + ₹0.00 = ₹0.00. Discard paise and round to nearest ₹10: **Annual tax = Annual TDS = ₹0.00**.

Monthly TDS: annual ₹0.00 / 12; months 1–11 receive **₹0.00**. Month 12 receives annual ₹0.00 − (11 × ₹0.00) = **₹0.00**. The twelve deductions total exactly ₹0.00.

Existing monthly Gross = annual Gross / 12, reported to paise = **₹45,833.33**. Existing monthly deductions = **₹5,000.00**.

Net Pay for months 1–11 = ₹45,833.33 − ₹5,000.00 − ₹0.00 = **₹40,833.33**. Final-month Net Pay = ₹45,833.33 − ₹5,000.00 − ₹0.00 = **₹40,833.33**. Gross and pre-existing deductions remain unchanged.

### CALC-O02 — Old regime; annual CTC ₹10,50,000.00

| Test Case ID | Feature | Test Scenario | Preconditions | Input Field | Input Value | Steps | Expected Result | Actual Result | Status | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CALC-O02 | TDS Calculation | Verify every annual and monthly amount | Controlled salary fixture above; correct published N/O revision; new QA employee | Annual CTC / Regime | 1050000 / old | 1 Create the separate QA employee. 2 Check generator annual outputs below. 3 Save the per-year tax profile. 4 Calculate annual TDS. 5 Compare every row below. | Exact breakdown below; record discrepancies before payroll. |  | Not Tested |  |

| Existing annual salary input | Exact expected value |
| --- | ---: |
| Annual CTC | ₹10,50,000.00 |
| Employer EPS | ₹0.00 |
| Employer EPF | ₹0.00 |
| Employer ESI | ₹0.00 |
| Existing annual Gross Wages | ₹10,50,000.00 |
| BASIC = Gross × 40% | ₹4,20,000.00 |
| DA = BASIC × 10% | ₹42,000.00 |
| RA = BASIC × 15% | ₹63,000.00 |
| Remaining reported Gross = Gross − BASIC − DA − RA | ₹5,25,000.00 |
| Existing annual employee deduction = 5000 × 12 | ₹60,000.00 |

Annual taxable salary = existing Gross ₹10,50,000.00 − exemptions ₹0.00 = ₹10,50,000.00.

Taxable income = ₹10,50,000.00 − standard deduction ₹50,000.00 = **₹10,00,000.00**. All case incomes are already multiples of ₹10.

| Slab | Taxable slice | Calculation | Expected tax |
| --- | ---: | --- | ---: |
| ₹0.00 to ₹2,50,000.00 | ₹2,50,000.00 | ₹2,50,000.00 × 0% | ₹0.00 |
| ₹2,50,000.00 to ₹5,00,000.00 | ₹2,50,000.00 | ₹2,50,000.00 × 5% | ₹12,500.00 |
| ₹5,00,000.00 to ₹10,00,000.00 | ₹5,00,000.00 | ₹5,00,000.00 × 20% | ₹1,00,000.00 |
| ₹10,00,000.00 to unlimited | ₹0.00 | ₹0.00 × 30% | ₹0.00 |

Tax before rebate = sum of slab taxes = **₹1,12,500.00**.

Taxable income exceeds the rebate eligibility limit; rebate = **₹0.00**.

Rebate marginal relief = **₹0.00** for this case.

Surcharge = **₹0.00**; taxable income does not exceed ₹50 lakh. Surcharge marginal relief = **₹0.00**.

Cess base = tax ₹1,12,500.00 − rebate ₹0.00 − rebate relief ₹0.00 + surcharge ₹0.00 − surcharge relief ₹0.00 = ₹1,12,500.00.

Cess = ₹1,12,500.00 × 4% = **₹4,500.00**.

Annual estimated tax before final rounding = ₹1,12,500.00 + ₹4,500.00 = ₹1,17,000.00. Discard paise and round to nearest ₹10: **Annual tax = Annual TDS = ₹1,17,000.00**.

Monthly TDS: annual ₹1,17,000.00 / 12; months 1–11 receive **₹9,750.00**. Month 12 receives annual ₹1,17,000.00 − (11 × ₹9,750.00) = **₹9,750.00**. The twelve deductions total exactly ₹1,17,000.00.

Existing monthly Gross = annual Gross / 12, reported to paise = **₹87,500.00**. Existing monthly deductions = **₹5,000.00**.

Net Pay for months 1–11 = ₹87,500.00 − ₹5,000.00 − ₹9,750.00 = **₹72,750.00**. Final-month Net Pay = ₹87,500.00 − ₹5,000.00 − ₹9,750.00 = **₹72,750.00**. Gross and pre-existing deductions remain unchanged.

## Part 4 — Payroll integration steps and checks

Use CALC-N03 first. Before enabling TDS, preview the employee with the same salary inputs and record all values without submitting payroll. With TDS disabled: Gross ₹1,39,583.33 − existing deductions ₹5,000.00 = Net ₹1,34,583.33. After enabling/calculating TDS, preview again: Gross stays ₹1,39,583.33, old deductions stay ₹5,000.00, TDS is ₹10,400.00, total deductions ₹15,400.00 and Net ₹1,24,183.33. The difference is exactly ₹10,400.00. Employer contributions stay zero in this controlled fixture.

The current Run Payroll screen offers months in the current calendar year, not every future month of the tax year. Use an available month such as October 2026, payment date 31-10-2026, for the regular monthly check. The final March 2027 residual check must be performed when that month is available, or by the automated allocation fixture; do not change the machine clock. Do not expect catch-up TDS for missing earlier months: this release allocates the annual figure across twelve slots and does not reconcile missed periods.

Save the draft after preview. Reopen it and compare. Submit only the QA employee and only in the disposable environment. The saved check must contain one TDS deduction; opening/downloading its PDF must show that deduction separately. Submission is Payment Pending, not confirmed tax withholding or remittance. TDS summary submitted allocations must never be interpreted as tax paid to the government.

| Test Case ID | Feature | Test Scenario | Preconditions | Input Field | Input Value | Steps | Expected Result | Actual Result | Status | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PAY-01 | Payroll | Employee/CTC source | Controlled QA salary/profile from CALC-N03 unless another case specified; no real payroll | Annual CTC | 1675000 | 1 Open the named QA employee. 2 Verify CTC and tax summary. 3 Preview the available payroll month. 4 Perform the specified action. 5 Compare exact values and original PDF. | Generator shows annual CTC/Gross 1675000 in the zero-employer fixture; no duplicate salary structure entered into TDS. |  | Not Tested |  |
| PAY-02 | Payroll | Disabled preservation | Controlled QA salary/profile from CALC-N03 unless another case specified; no real payroll | TDS applicable | No; reason: QA disabled comparison | 1 Open the named QA employee. 2 Verify CTC and tax summary. 3 Preview the available payroll month. 4 Perform the specified action. 5 Compare exact values and original PDF. | Gross 139583.33; old deductions 5000; Net 134583.33; employer amounts unchanged. |  | Not Tested |  |
| PAY-03 | Payroll | Enabled TDS | Controlled QA salary/profile from CALC-N03 unless another case specified; no real payroll | TDS applicable / Calculate | Yes; New / Calculate annual TDS | 1 Open the named QA employee. 2 Verify CTC and tax summary. 3 Preview the available payroll month. 4 Perform the specified action. 5 Compare exact values and original PDF. | Annual 124800; monthly10400; Gross unchanged; total deductions15400; Net124183.33. |  | Not Tested |  |
| PAY-04 | Payroll | Recalculate | Controlled QA salary/profile from CALC-N03 unless another case specified; no real payroll | Recalculate payroll | Click twice with unchanged inputs | 1 Open the named QA employee. 2 Verify CTC and tax summary. 3 Preview the available payroll month. 4 Perform the specified action. 5 Compare exact values and original PDF. | One TDS line; identical values, no compounding deduction. |  | Not Tested |  |
| PAY-05 | Payroll | Draft persistence | Controlled QA salary/profile from CALC-N03 unless another case specified; no real payroll | Save draft / reopen | Same employee and month | 1 Open the named QA employee. 2 Verify CTC and tax summary. 3 Preview the available payroll month. 4 Perform the specified action. 5 Compare exact values and original PDF. | Same TDS amount/version and existing payroll values. |  | Not Tested |  |
| PAY-06 | Payroll | Submit validation | Controlled QA salary/profile from CALC-N03 unless another case specified; no real payroll | Submit payroll / expected payment date | 31-10-2026 for October 2026 | 1 Open the named QA employee. 2 Verify CTC and tax summary. 3 Preview the available payroll month. 4 Perform the specified action. 5 Compare exact values and original PDF. | Backend validates the saved calculation; one finalized check and PDF. |  | Not Tested |  |
| PAY-07 | Payroll | Payment-year boundary | Controlled QA salary/profile from CALC-N03 unless another case specified; no real payroll | Expected payment date | 01-04-2027 for a FY2026-27 tax snapshot | 1 Open the named QA employee. 2 Verify CTC and tax summary. 3 Preview the available payroll month. 4 Perform the specified action. 5 Compare exact values and original PDF. | Backend blocks a date outside the snapshot year; draft/history unchanged. |  | Not Tested |  |
| PAY-08 | Payroll | Payslip output | Controlled QA salary/profile from CALC-N03 unless another case specified; no real payroll | View / Download Pay Check | Open newly submitted QA check | 1 Open the named QA employee. 2 Verify CTC and tax summary. 3 Preview the available payroll month. 4 Perform the specified action. 5 Compare exact values and original PDF. | Separate Income Tax / TDS10400; Gross139583.33; total deductions15400; Net124183.33. |  | Not Tested |  |
| PAY-09 | Payroll | Duplicate submission | Controlled QA salary/profile from CALC-N03 unless another case specified; no real payroll | Submit same employee-period again | Same saved check | 1 Open the named QA employee. 2 Verify CTC and tax summary. 3 Preview the available payroll month. 4 Perform the specified action. 5 Compare exact values and original PDF. | Original result or already-finalized rejection; no second check/deduction. |  | Not Tested |  |
| PAY-10 | Payroll | Final paise reconciliation | Controlled QA salary/profile from CALC-N03 unless another case specified; no real payroll | Use CALC-N05 annual TDS10 | Months1–11:0.83; month12:0.87 | 1 Open the named QA employee. 2 Verify CTC and tax summary. 3 Preview the available payroll month. 4 Perform the specified action. 5 Compare exact values and original PDF. | 11 ×0.83 +0.87 =10.00 exactly; Net101250.00 regular,101249.96 final. |  | Not Tested |  |
| PAY-11 | Payroll | Historical immutability | Controlled QA salary/profile from CALC-N03 unless another case specified; no real payroll | Change later review note/config revision | Save new revision after QA check finalized | 1 Open the named QA employee. 2 Verify CTC and tax summary. 3 Preview the available payroll month. 4 Perform the specified action. 5 Compare exact values and original PDF. | Original check and PDF unchanged; changed future tax inputs require review, not silent reconciliation. |  | Not Tested |  |

## Part 5 — Negative testing and security

For a network failure, first finish loading the page, open the browser's Developer Tools, choose Network → Offline, perform the intended load/save, then restore Online. Do not disable the backend or internet for other users. Backend error cases that cannot be entered through the normal screen are marked automated/developer-assisted; do not force-enable the Save button.

| Test Case ID | Feature | Test Scenario | Preconditions | Input Field | Input Value | Steps | Expected Result | Actual Result | Status | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| NEG-01 | TDS Calculation | Required review fields | Separate QA environment; required test roles/fixtures only | Review note / confirmation | Blank / unchecked | 1 Prepare the stated QA case. 2 Perform the action without bypassing UI restrictions. 3 Record the error. 4 Confirm no saved data changed on failure. | Save blocked with clear review guidance. |  | Not Tested |  |
| NEG-02 | TDS Calculation | Whitespace-only evidence | Separate QA environment; required test roles/fixtures only | [actual name] — legal reference | Three spaces | 1 Prepare the stated QA case. 2 Perform the action without bypassing UI restrictions. 3 Record the error. 4 Confirm no saved data changed on failure. | Not accepted as legal evidence; named error. |  | Not Tested |  |
| NEG-03 | TDS Calculation | Negative partial percentage | Separate QA environment; required test roles/fixtures only | Taxable % | -1 | 1 Prepare the stated QA case. 2 Perform the action without bypassing UI restrictions. 3 Record the error. 4 Confirm no saved data changed on failure. | Range error and no save. |  | Not Tested |  |
| NEG-04 | TDS Calculation | Partial percentage above100 | Separate QA environment; required test roles/fixtures only | Taxable % | 101 | 1 Prepare the stated QA case. 2 Perform the action without bypassing UI restrictions. 3 Record the error. 4 Confirm no saved data changed on failure. | Range error and no save. |  | Not Tested |  |
| NEG-05 | TDS Calculation | Missing partial conditions | Separate QA environment; required test roles/fixtures only | Conditions | Blank | 1 Prepare the stated QA case. 2 Perform the action without bypassing UI restrictions. 3 Record the error. 4 Confirm no saved data changed on failure. | Named conditions message; save blocked. |  | Not Tested |  |
| NEG-06 | Tax Master | Unauthorized settings | Separate QA environment; required test roles/fixtures only | Sign in with ordinary User role | Open /settings/tax-configuration | 1 Prepare the stated QA case. 2 Perform the action without bypassing UI restrictions. 3 Record the error. 4 Confirm no saved data changed on failure. | Screen access denied/redirected; backend create/update/activate returns403 in automated security checks. |  | Not Tested |  |
| NEG-07 | Tax Master | Employee role | Separate QA environment; required test roles/fixtures only | Ordinary account without statutory-admin role | Attempt statutory-rule modification | 1 Prepare the stated QA case. 2 Perform the action without bypassing UI restrictions. 3 Record the error. 4 Confirm no saved data changed on failure. | Cannot modify rules; no configuration change. |  | Not Tested |  |
| NEG-08 | Tax Master | Cross-organization visibility | Separate QA environment; required test roles/fixtures only | Two QA administrators in different QA organizations | Create revision only in A, view B | 1 Prepare the stated QA case. 2 Perform the action without bypassing UI restrictions. 3 Record the error. 4 Confirm no saved data changed on failure. | A history is not visible or writable from B. Never change organization identifiers manually. |  | Not Tested |  |
| NEG-09 | TDS Calculation | Unsupported conditional tax | Separate QA environment; required test roles/fixtures only | Conditional component / Calculate annual TDS | Save conditional metadata then calculate | 1 Prepare the stated QA case. 2 Perform the action without bypassing UI restrictions. 3 Record the error. 4 Confirm no saved data changed on failure. | Visible claims-review block; no silent exemption/zero tax. |  | Not Tested |  |
| NEG-10 | TDS Calculation | Prior payroll without TDS | Separate QA environment; required test roles/fixtures only | New QA employee with earlier submitted non-TDS check | Enable TDS after that submission | 1 Prepare the stated QA case. 2 Perform the action without bypassing UI restrictions. 3 Record the error. 4 Confirm no saved data changed on failure. | Explicit mid-year reconciliation block; historical check unchanged. |  | Not Tested |  |
| NEG-11 | TDS Calculation | Missing/nonoperative PAN eligibility | Separate QA environment; required test roles/fixtures only | PAN operative confirmation | Unchecked | 1 Prepare the stated QA case. 2 Perform the action without bypassing UI restrictions. 3 Record the error. 4 Confirm no saved data changed on failure. | Tax calculation blocks unsupported identity status; no normal-rate guess. |  | Not Tested |  |
| NEG-12 | TDS Calculation | Non-monthly employee | Separate QA environment; required test roles/fixtures only | Payroll frequency | Weekly in a separate supported employee fixture | 1 Prepare the stated QA case. 2 Perform the action without bypassing UI restrictions. 3 Record the error. 4 Confirm no saved data changed on failure. | Version1 allocation/processing rejects unsupported frequency. |  | Not Tested |  |
| NEG-13 | TDS Calculation | Missing actual component identity | Separate QA environment; required test roles/fixtures only | API-only mapping payload | Blank identity | 1 Prepare the stated QA case. 2 Perform the action without bypassing UI restrictions. 3 Record the error. 4 Confirm no saved data changed on failure. | Automated rejection; no duplicate component definition created. |  | Not Tested |  |
| NEG-14 | TDS Calculation | Unsupported rounding option | Separate QA environment; required test roles/fixtures only | API-only rounding payload | invalid | 1 Prepare the stated QA case. 2 Perform the action without bypassing UI restrictions. 3 Record the error. 4 Confirm no saved data changed on failure. | Automated rejection; no partial revision. |  | Not Tested |  |

## Part 6 — Regression checks

Do these comparisons with exactly the same QA employee, month, salary formulas and existing deduction values. Merely seeing a new TDS label is not a passing payroll comparison.

| Test Case ID | Feature | Test Scenario | Preconditions | Input Field | Input Value | Steps | Expected Result | Actual Result | Status | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| REG-01 | Payroll | No TDS profile | Recorded before/after QA baseline; no real payroll | Tax profile | Absent | 1 Record original values. 2 Apply only the stated tax setup. 3 Repeat the same preview/view. 4 Compare every value. | Original payroll results and calculations unchanged. |  | Not Tested |  |
| REG-02 | Payroll | TDS disabled | Recorded before/after QA baseline; no real payroll | TDS applicable | No | 1 Record original values. 2 Apply only the stated tax setup. 3 Repeat the same preview/view. 4 Compare every value. | Every Gross, employee deduction, employer amount and Net matches the baseline. |  | Not Tested |  |
| REG-03 | Payroll | TDS enabled | Recorded before/after QA baseline; no real payroll | CALC-N03 | Annual124800 / monthly10400 | 1 Record original values. 2 Apply only the stated tax setup. 3 Repeat the same preview/view. 4 Compare every value. | Only TDS and corresponding deductions/Net difference; Gross and statutory amounts unchanged. |  | Not Tested |  |
| REG-04 | Payroll | Repeated recalculation | Recorded before/after QA baseline; no real payroll | Recalculate | Same unchanged data repeatedly | 1 Record original values. 2 Apply only the stated tax setup. 3 Repeat the same preview/view. 4 Compare every value. | No duplicate TDS component or subtraction. |  | Not Tested |  |
| REG-05 | Payroll | Historical payroll | Recorded before/after QA baseline; no real payroll | Open original finalized QA check/PDF | After a new revision is saved | 1 Record original values. 2 Apply only the stated tax setup. 3 Repeat the same preview/view. 4 Compare every value. | Original values and PDF bytes stay unchanged. |  | Not Tested |  |
| REG-06 | Payroll | Dynamic component formulas | Recorded before/after QA baseline; no real payroll | Existing QA allowance/formula | Compare before/after tax setup without changing formula | 1 Record original values. 2 Apply only the stated tax setup. 3 Repeat the same preview/view. 4 Compare every value. | Salary engine output remains identical; tax mapping is separate. |  | Not Tested |  |
| REG-07 | Payroll | Employee Pay Checks | Recorded before/after QA baseline; no real payroll | Open profile Pay Checks | New QA submission | 1 Record original values. 2 Apply only the stated tax setup. 3 Repeat the same preview/view. 4 Compare every value. | Existing navigation, PDF viewing/downloading and payment status still work. |  | Not Tested |  |
| REG-08 | Payroll | Organization boundaries | Recorded before/after QA baseline; no real payroll | Open A and B QA sessions | Use distinct organization accounts | 1 Record original values. 2 Apply only the stated tax setup. 3 Repeat the same preview/view. 4 Compare every value. | No salary/configuration/history crosses the organization boundary. |  | Not Tested |  |

## What was automated and what you still need to do

The manual rows above remain **Not Tested** for your own environment. Automated form tests simulate typing, selecting, adding/removing and failed network responses; backend integration tests use real salary-component records, service/API validation and disposable MongoDB persistence. The eight numerical fixtures were checked with the unchanged annual salary engine and the tax engine. Security tests use test-only account/tenant fixtures, not altered production authentication.

A real-browser check, its final execution result, final test totals, build results, exact file inventory and any remaining limitations are recorded in docs/TAX-CONFIGURATION-WORKFLOW-VERIFICATION.md. Do not infer a passing real-customer scenario from disposable fixtures. Your statutory reviewer still needs to approve actual component characteristics, exemptions, evidence and employer treatment.

Known limits relevant to these cases: salary-only resident ordinary income; verified operative PAN; unchanged full-year monthly schedule; one reviewed age band per regime/year; no claims engine, old-regime investment/professional-tax adjustment engine, prior-employer balances, catch-up/month-count reconciliation or tax-remittance confirmation. Unsupported cases must block rather than produce fabricated compliance. The tested tax figures are valid only for their fully stated controlled salary inputs.

If a test fails: record case ID, actual error, selected year/regime, component product name, browser and screenshot; preserve the draft; do not change production rules, invent legal references, delete history or submit actual payroll as a workaround.
