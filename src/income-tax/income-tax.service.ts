import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Schema } from 'mongoose';
import { createHash } from 'node:crypto';
import { businessModel } from '../organizations/business-models.module';
import { tenantContext } from '../organizations/tenant-context';
import {
  TaxConfigurationService,
  taxOrganization,
} from '../tax-configuration/tax-configuration.service';
import { EmployeeTaxProfileService } from '../employee-tax-profile/employee-tax-profile.service';
import { SalaryComponentsService } from '../salary-components/salary-components.service';
import { StatutoryDeductionsService } from '../statutory-deductions/statutory-deductions.service';
import { SalaryCalculationService } from '../payroll-generator/salary-calculation.service';
import { PayrollRunSchema } from '../run-payroll/schemas/payroll-run.schema';
import { calculateAnnualTax } from './tax-engine';
import type { AnnualSalaryInput, TaxRevision, TaxYear } from './tax.types';
import { Ratio } from '../payroll-generator/decimal-ratio';
import { TaxWriteLock } from '../tax-configuration/tax-write-lock.service';

const CalculationSchema = new Schema(
  {
    organizationId: { type: String, required: true },
    employeeId: { type: String, required: true },
    yearCode: { type: String, required: true },
    inputHash: { type: String, required: true },
    snapshot: { type: Schema.Types.Mixed, required: true },
    createdBy: String,
  },
  {
    collection: 'employee_tds_calculations',
    timestamps: { createdAt: true, updatedAt: false },
  },
);
CalculationSchema.index(
  { organizationId: 1, employeeId: 1, yearCode: 1, inputHash: 1 },
  { unique: true },
);
const digest = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');

export interface PayrollTaxSnapshot {
  calculationId: string;
  inputHash: string;
  yearCode: string;
  regime: string;
  configurationVersion: string;
  profileVersion: number;
  legislation: string;
  annualTds: number;
  allocation: number[];
  monthIndex: number;
  amount: number;
}
export type TdsCalculationStatus =
  | 'not_configured'
  | 'disabled'
  | 'not_calculated'
  | 'estimate_saved'
  | 'calculated';
export const tdsStatusLabel = (status: TdsCalculationStatus) =>
  ({
    not_configured: 'TDS not configured',
    disabled: 'TDS disabled',
    not_calculated: 'Not calculated',
    estimate_saved:
      'Estimate saved — recalculate after input changes in Income Tax/TDS.',
    calculated: 'Calculated',
  })[status];
@Injectable()
export class IncomeTaxService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly configuration: TaxConfigurationService,
    private readonly profiles: EmployeeTaxProfileService,
    private readonly components: SalaryComponentsService,
    private readonly statutory: StatutoryDeductionsService,
    private readonly salary: SalaryCalculationService,
    private readonly lock: TaxWriteLock,
  ) {}
  submissionLock<T>(work: () => Promise<T>) {
    return this.lock.run(work);
  }
  private calculations() {
    return businessModel(
      this.connection,
      'EmployeeTdsCalculation',
      CalculationSchema,
      tenantContext.getStore()?.organizationId,
    );
  }
  private runs() {
    return businessModel(
      this.connection,
      'PayrollRun',
      PayrollRunSchema,
      tenantContext.getStore()?.organizationId,
    );
  }
  private async submitted(id: string, year: TaxYear) {
    const records: any[] = await this.runs()
      .find({
        organizationId: taxOrganization(),
        status: 'Submitted',
        period: {
          $gte: year.startDate.slice(0, 7),
          $lte: year.endDate.slice(0, 7),
        },
      })
      .select('-checks.pdf -additionalSubmissions.checks.pdf -pendingDraft')
      .lean()
      .exec();
    return records
      .flatMap((r) => [r, ...(r.additionalSubmissions ?? [])])
      .flatMap((r) =>
        r.checks
          .filter((c: any) => c.employeeId === id)
          .map((c: any) => ({
            period: r.period,
            tax: c.tax as PayrollTaxSnapshot | undefined,
          })),
      );
  }
  async project(id: string, yearCode: string, actor = 'payroll') {
    const employee = await this.profiles.employee(id);
    const profile: any = await this.profiles.get(id, yearCode);
    if (!profile)
      throw new BadRequestException(
        'Create the employee financial-year tax profile first.',
      );
    const state = await this.configuration.get();
    const year: TaxYear = state.years.find((y: TaxYear) => y.code === yearCode);
    if (!year) throw new NotFoundException('Financial year not found.');
    if (!profile.tdsApplicable)
      return {
        status: 'disabled',
        annualCtc: employee.annualCtc,
        annualTds: 0,
        monthlyTds: 0,
        profile,
      };
    const revision: TaxRevision = state.revisions.find(
      (r: TaxRevision) =>
        r.id === state.published[`${yearCode}:${profile.regime}`],
    );
    if (!revision)
      throw new BadRequestException(
        'Publish reviewed rules for the selected year and regime.',
      );
    if (
      !profile.resident ||
      !profile.salaryOnly ||
      !profile.panOperative ||
      !profile.fullYearEmployment ||
      (employee.payFrequency ?? 'Monthly') !== 'Monthly' ||
      new Date(employee.rehireDate ?? employee.hireDate) >
        new Date(year.startDate)
    )
      throw new BadRequestException(
        'Version 1 supports confirmed resident, salary-only, operative-PAN, full-year monthly employment. Review unsupported cases before payroll.',
      );
    if (
      revision.rules.mappings.some((m) => m.type !== 'taxable') &&
      !profile.exemptionConditionsConfirmed
    )
      throw new BadRequestException(
        'Confirm documented exemption conditions for this employee.',
      );
    const dob = new Date(employee.dateOfBirth),
      end = new Date(year.endDate);
    const age =
      end.getUTCFullYear() -
      dob.getUTCFullYear() -
      (end.getUTCMonth() < dob.getUTCMonth() ||
      (end.getUTCMonth() === dob.getUTCMonth() &&
        end.getUTCDate() < dob.getUTCDate())
        ? 1
        : 0);
    if (
      !Number.isFinite(age) ||
      age < revision.rules.minimumAge ||
      (revision.rules.maximumAge !== null && age > revision.rules.maximumAge)
    )
      throw new BadRequestException(
        'Employee age is outside this configuration’s reviewed eligibility.',
      );
    const [components, settings] = await Promise.all([
      this.components.findAll(),
      this.statutory.get(),
    ]);
    if (!settings)
      throw new BadRequestException('Configure statutory deductions first.');
    const salary = this.salary.calculateAnnual(
      employee.annualCtc,
      components,
      settings,
    );
    return this.persist(id, year, revision, profile, salary, actor);
  }
  private async persist(
    id: string,
    year: TaxYear,
    revision: TaxRevision,
    profile: any,
    salary: AnnualSalaryInput,
    actor: string,
  ) {
    const inputs = { year, revision, profileVersion: profile.version, salary };
    const inputHash = digest(inputs);
    const result = calculateAnnualTax(salary, revision.rules);
    const snapshot = {
      status: 'calculated',
      employeeId: id,
      yearCode: year.code,
      regime: revision.regime,
      legislation: year.legislation,
      configurationVersion: revision.id,
      taxSlabVersion: revision.id,
      mappingVersion: revision.id,
      profileVersion: profile.version,
      inputs,
      result,
    };
    const model = this.calculations();
    await model.createIndexes();
    let saved: any;
    try {
      saved = await model
        .findOneAndUpdate(
          {
            organizationId: taxOrganization(),
            employeeId: id,
            yearCode: year.code,
            inputHash,
          },
          { $setOnInsert: { snapshot, createdBy: actor } },
          { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
        )
        .lean()
        .exec();
    } catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e;
      saved = await model
        .findOne({
          organizationId: taxOrganization(),
          employeeId: id,
          yearCode: year.code,
          inputHash,
        })
        .lean()
        .exec();
    }
    return {
      ...snapshot,
      calculationId: saved._id.toString(),
      inputHash,
      calculatedAt: saved.createdAt,
    };
  }
  private async calculationState(
    id: string,
    year: TaxYear | undefined,
    profile: any,
    salary: AnnualSalaryInput | undefined,
    state: any,
    latest?: any,
  ): Promise<{ status: TdsCalculationStatus; calculation?: any }> {
    if (!year || !profile) return { status: 'not_configured' };
    if (!profile.tdsApplicable) return { status: 'disabled' };
    const record =
      latest === undefined
        ? await this.calculations()
            .findOne({
              organizationId: taxOrganization(),
              employeeId: id,
              yearCode: year.code,
            })
            .sort({ createdAt: -1, _id: -1 })
            .lean()
            .exec()
        : latest;
    if (!record) return { status: 'not_calculated' };
    const revision = state.revisions.find(
      (r: TaxRevision) =>
        r.id === state.published[`${year.code}:${profile.regime}`],
    );
    const currentHash =
      revision && salary
        ? digest({ year, revision, profileVersion: profile.version, salary })
        : null;
    if (
      !year.active ||
      record.snapshot?.status !== 'calculated' ||
      !currentHash ||
      record.inputHash !== currentHash ||
      record.snapshot.profileVersion !== profile.version ||
      record.snapshot.configurationVersion !== revision?.id ||
      !Array.isArray(record.snapshot.result?.allocation) ||
      record.snapshot.result.allocation.length !== 12 ||
      record.snapshot.result.allocation.some(
        (amount: unknown) =>
          typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0,
      )
    )
      return { status: 'estimate_saved' };
    return { status: 'calculated', calculation: record };
  }
  async payrollAssessment(
    employee: { _id: { toString(): string } },
    period: string,
    salary: AnnualSalaryInput,
  ): Promise<{ status: TdsCalculationStatus; tax?: PayrollTaxSnapshot }> {
    const state = await this.configuration.get();
    const year: TaxYear | undefined = state.years.find(
      (y: TaxYear) =>
        period >= y.startDate.slice(0, 7) && period <= y.endDate.slice(0, 7),
    );
    const id = employee._id.toString();
    const profile = year ? await this.profiles.get(id, year.code) : null;
    const assessment = await this.calculationState(
      id,
      year,
      profile,
      salary,
      state,
    );
    if (assessment.status !== 'calculated' || !year)
      return { status: assessment.status };
    const saved = assessment.calculation;
    const projection = saved.snapshot;
    const monthIndex =
      (Number(period.slice(0, 4)) - Number(year.startDate.slice(0, 4))) * 12 +
      Number(period.slice(5)) -
      Number(year.startDate.slice(5, 7));
    return {
      status: 'calculated',
      tax: {
        calculationId: saved._id.toString(),
        inputHash: saved.inputHash,
        yearCode: year.code,
        regime: projection.regime,
        legislation: year.legislation,
        configurationVersion: projection.configurationVersion,
        profileVersion: projection.profileVersion,
        annualTds: projection.result.annualTds,
        allocation: projection.result.allocation,
        monthIndex,
        amount: projection.result.allocation[monthIndex],
      },
    };
  }
  async payrollDeduction(
    employee: { _id: { toString(): string } },
    period: string,
    salary: AnnualSalaryInput,
  ) {
    return (await this.payrollAssessment(employee, period, salary)).tax;
  }
  async history(id: string, yearCode: string) {
    await this.profiles.employee(id);
    return this.calculations()
      .find({ organizationId: taxOrganization(), employeeId: id, yearCode })
      .sort({ createdAt: -1, _id: -1 })
      .lean()
      .exec();
  }
  async summary(id: string, yearCode: string) {
    const profile = await this.profiles.get(id, yearCode);
    const employee = await this.profiles.employee(id);
    const history: any[] = await this.history(id, yearCode);
    const state = await this.configuration.get();
    const year = state.years.find((y: TaxYear) => y.code === yearCode);
    let currentSalary: AnnualSalaryInput | undefined;
    if (profile?.tdsApplicable && history.length) {
      const [components, settings] = await Promise.all([
        this.components.findAll(),
        this.statutory.get(),
      ]);
      if (settings) {
        try {
          currentSalary = this.salary.calculateAnnual(
            employee.annualCtc,
            components,
            settings,
          );
        } catch (error) {
          if (!(error instanceof BadRequestException)) throw error;
        }
      }
    }
    const assessment = await this.calculationState(
      id,
      year,
      profile,
      currentSalary,
      state,
      history[0] ?? null,
    );
    const submitted = year ? await this.submitted(id, year) : [];
    const allocated = submitted
      .reduce((s, c) => s.add(Ratio.of(c.tax?.amount ?? 0)), Ratio.of(0))
      .money();
    return {
      profile,
      calculationStatus: assessment.status,
      regimeSelection: this.profiles.regimeSelection(state, yearCode, profile),
      calculationStatusLabel: tdsStatusLabel(assessment.status),
      annualCtc: employee.annualCtc,
      payrollFrequency: employee.payFrequency ?? 'Monthly',
      latest: history[0] ?? null,
      submittedTds: allocated,
      withholdingStatus:
        'Payment Pending; submitted allocations are not confirmed withholding',
      remainingEstimatedTds: history[0]
        ? Ratio.of(history[0].snapshot.result.annualTds)
            .sub(Ratio.of(allocated))
            .money()
        : null,
    };
  }
}
