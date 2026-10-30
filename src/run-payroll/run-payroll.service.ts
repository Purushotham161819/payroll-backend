import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { createHash } from 'node:crypto';
import { Employee } from '../employees/schemas/employee.schema';
import { SalaryComponentsService } from '../salary-components/salary-components.service';
import { StatutoryDeductionsService } from '../statutory-deductions/statutory-deductions.service';
import { SalaryCalculationService } from '../payroll-generator/salary-calculation.service';
import { tenantContext } from '../organizations/tenant-context';
import { Ratio } from '../payroll-generator/decimal-ratio';
import { PayCheckSnapshot, PayrollRun } from './schemas/payroll-run.schema';
import { payslipPdf } from './payslip';
import type { RunRequest, SubmitPayrollRequest } from './run-payroll.dto';

export const CALCULATION_VERSION = 'annual-engine/monthly-report-v1';

const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const sumMoney = (values: number[]) =>
  values.reduce((sum, n) => sum.add(Ratio.of(n)), Ratio.of(0)).money();
// Match the established monthly report: derive rounded aggregate cells once
// from the annual engine. Component monthly cells already exist in the engine.
export const monthlyAmount = (annual: number) =>
  Number((annual / 12).toFixed(2));

@Injectable()
export class RunPayrollService {
  private readonly indexes = new Map<string, Promise<unknown>>();
  constructor(
    @InjectModel('PayrollRun') private readonly runs: Model<PayrollRun>,
    @InjectModel(Employee.name) private readonly employees: Model<Employee>,
    private readonly components: SalaryComponentsService,
    private readonly settings: StatutoryDeductionsService,
    private readonly calculator: SalaryCalculationService,
    @InjectConnection() private readonly connection: Connection,
  ) {}
  private org() {
    return tenantContext.getStore()?.organizationId ?? 'legacy';
  }
  private async ready() {
    // Explicitly await uniqueness before any write, including lazily created tenants.
    const org = this.org();
    let pending = this.indexes.get(org);
    if (!pending) {
      pending = this.runs.createIndexes().catch((error) => {
        this.indexes.delete(org);
        throw error;
      });
      this.indexes.set(org, pending);
    }
    await pending;
  }
  period(value: unknown, currentYear = false) {
    if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value))
      throw new BadRequestException('Select a valid payroll month (YYYY-MM).');
    const [year, month] = value.split('-').map(Number);
    if (
      year < 2000 ||
      year > 9999 ||
      (currentYear && year !== new Date().getFullYear())
    )
      throw new BadRequestException(
        'Select a payroll month in the current calendar year.',
      );
    return {
      periodStart: new Date(Date.UTC(year, month - 1, 1)),
      periodEnd: new Date(Date.UTC(year, month, 0)),
    };
  }
  private ids(value: unknown, allowEmpty = false): string[] {
    if (
      !Array.isArray(value) ||
      (!allowEmpty && !value.length) ||
      value.some((id) => typeof id !== 'string' || !/^[a-f\d]{24}$/.test(id)) ||
      new Set(value).size !== value.length
    )
      throw new BadRequestException('Select distinct valid employee IDs.');
    return [...value].sort((a, b) => a.localeCompare(b));
  }
  private async existing(period: string) {
    this.period(period);
    return this.runs
      .findOne({ organizationId: this.org(), period })
      .lean()
      .exec();
  }
  private async calculate(period: string, employeeIds: unknown) {
    const dates = this.period(period, true);
    const ids = this.ids(employeeIds, true);
    const [employees, components, settings] = await Promise.all([
      this.employees
        .find({ _id: { $in: ids } })
        .sort({ _id: 1 })
        .lean()
        .exec(),
      this.components.findAll(),
      this.settings.get(),
    ]);
    if (employees.length !== ids.length)
      throw new BadRequestException(
        'An employee does not belong to this organization or no longer exists.',
      );
    if (!settings)
      throw new BadRequestException(
        'Configure statutory deductions before running payroll.',
      );
    for (const employee of employees) {
      const start = employee.rehireDate ?? employee.hireDate;
      if (
        (employee.status ?? 'Active') !== 'Active' ||
        new Date(start) > dates.periodEnd ||
        (employee.payFrequency ?? 'Monthly') !== 'Monthly'
      )
        throw new BadRequestException(
          `${employee.firstName} ${employee.lastName} is not eligible for this payroll month.`,
        );
    }
    const organizationId = this.org();
    const organization =
      organizationId === 'legacy'
        ? null
        : await this.connection
            .collection('organizations')
            .findOne({ organizationId, status: 'active' });
    if (organizationId !== 'legacy' && !organization)
      throw new BadRequestException('Organization is not active.');
    const organizationName =
      organization?.name ||
      process.env.ORGANIZATION_NAME?.trim() ||
      'PayStream, An Excelhire Product';
    const checks: PayCheckSnapshot[] = employees.map((employee) => {
      const calculation = this.calculator.calculateAnnual(
        employee.annualCtc,
        components,
        settings,
      );
      const a = calculation.annual as Record<string, number>;
      return {
        id: employee._id.toString(),
        employeeId: employee._id.toString(),
        employeeCode: employee.employeeId,
        firstName: employee.firstName,
        lastName: employee.lastName,
        grossPay: monthlyAmount(a.annualGrossWages),
        employerContributions: sumMoney(
          [
            a.employerEpfContribution,
            a.employerEpsContribution,
            a.employerEsiContribution,
          ].map(monthlyAmount),
        ),
        deductions: monthlyAmount(a.annualTotalDeductions),
        netPay: monthlyAmount(a.annualNetPay),
        components: calculation.components.map((c) => ({
          name: components.find(
            (config) => config._id.toString() === c.componentId,
          )!.name,
          category: c.category,
          amount: c.monthly,
          showInPayslip: c.showInPayslip,
        })),
        calculation,
      };
    });
    const calculationInputs = {
      employees: employees.map((employee) => ({
        employeeId: employee._id.toString(),
        employeeCode: employee.employeeId,
        firstName: employee.firstName,
        lastName: employee.lastName,
        annualCtc: employee.annualCtc,
        payFrequency: employee.payFrequency ?? 'Monthly',
        status: employee.status ?? 'Active',
        hireDate: employee.hireDate,
        rehireDate: employee.rehireDate,
        lifecycleVersion: employee.lifecycleVersion,
      })),
      components,
      settings,
    };
    return {
      organizationId,
      organizationName,
      period,
      ...dates,
      checks,
      totals: {
        employerContributions: sumMoney(
          checks.map((c) => c.employerContributions),
        ),
        deductions: sumMoney(checks.map((c) => c.deductions)),
        netPay: sumMoney(checks.map((c) => c.netPay)),
      },
      calculationInputs,
      inputHash: hash({
        version: CALCULATION_VERSION,
        calculationInputs,
        organizationName,
      }),
      calculationVersion: CALCULATION_VERSION,
      calculatedAt: new Date(),
    };
  }
  private submissions(run: PayrollRun | null | undefined): PayrollRun[] {
    return run?.status === 'Submitted'
      ? [run, ...(run.additionalSubmissions ?? [])]
      : [];
  }
  private processed(run: PayrollRun | null | undefined) {
    return new Set(
      this.submissions(run).flatMap((s) => s.checks.map((c) => c.employeeId)),
    );
  }
  private snapshotCtc(check: PayCheckSnapshot, run: PayrollRun): number | null {
    const annual = (check.calculation as { annual?: { annualCtc?: number } })
      ?.annual?.annualCtc;
    const inputs = run.calculationInputs as {
      employees?: { employeeId: string; annualCtc: number }[];
    };
    const value =
      annual ??
      inputs?.employees?.find(
        (employee) => employee.employeeId === check.employeeId,
      )?.annualCtc;
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? value
      : null;
  }
  private validatePaymentDate(value: unknown, optional = false): string | null {
    if (optional && (value === null || value === '')) return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
      throw new BadRequestException('Enter a valid payment date.');
    const date = new Date(value + 'T00:00:00Z');
    if (
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value
    )
      throw new BadRequestException('Enter a valid payment date.');
    return value;
  }
  private monthlyCtc(
    annual: number | null,
    frequency = 'Monthly',
  ): number | null {
    if (
      frequency !== 'Monthly' ||
      annual === null ||
      !Number.isFinite(annual) ||
      annual < 0 ||
      annual * 100 > Number.MAX_SAFE_INTEGER
    )
      return null;
    // Use the annual engine's reporting precision, then the existing monthly
    // report derivation exactly once. No other pay-frequency conversion exists.
    return monthlyAmount(Ratio.of(annual).money());
  }
  private snapshotFrequency(check: PayCheckSnapshot, run: PayrollRun): string {
    const inputs = run.calculationInputs as {
      employees?: { employeeId: string; payFrequency?: string }[];
    };
    return (
      inputs?.employees?.find(
        (employee) => employee.employeeId === check.employeeId,
      )?.payFrequency ?? 'Monthly'
    );
  }
  private present(run: any, stale = false, warning?: string) {
    // Nested aggregates may contain other employees' PDF bytes. Only expose the
    // requested snapshot and route references; never serialize nested storage.
    const {
      pendingDraft: _draft,
      additionalSubmissions: _batches,
      ...snapshot
    } = run;
    const costs = run.checks.map((check: PayCheckSnapshot) =>
      this.monthlyCtc(
        this.snapshotCtc(check, run),
        this.snapshotFrequency(check, run),
      ),
    );
    return {
      ...snapshot,
      totalPayrollCost: costs.every((cost: number | null) => cost !== null)
        ? sumMoney(costs)
        : null,
      totalPayrollCostPeriod: 'Monthly',
      stale,
      warning,
      checks: run.checks.map(({ pdf: _pdf, ...check }: PayCheckSnapshot) => ({
        ...check,
        annualCtc: this.snapshotCtc(check, run),
        monthlyCtc: this.monthlyCtc(
          this.snapshotCtc(check, run),
          this.snapshotFrequency(check, run),
        ),
        payFrequency: this.snapshotFrequency(check, run),
        paymentStatus:
          run.status === 'Submitted' ? 'Payment Pending' : 'Not Paid',
        ...(run.status === 'Submitted'
          ? {
              payrollStatus: 'Submitted',
              paymentDate: run.paymentDate,
              submittedAt: run.submittedAt,
              submissionId: run.idempotencyKey,
              pdfUrl: `/payroll/runs/${run.period}/checks/${check.employeeId}/pdf`,
            }
          : {}),
      })),
    };
  }
  private historical(run: PayrollRun | null | undefined, selected?: string[]) {
    return this.submissions(run)
      .flatMap((s) => this.present(s).checks)
      .filter(
        (c: PayCheckSnapshot) => !selected || selected.includes(c.employeeId),
      );
  }
  private withHistory(
    snapshot: any,
    run: PayrollRun | null | undefined,
    stale = false,
    warning?: string,
  ) {
    return {
      ...this.present(snapshot, stale, warning),
      paymentDate:
        snapshot.status === 'Draft'
          ? ((run?.status === 'Draft'
              ? run.paymentDate
              : run?.pendingDraft?.paymentDate) ?? null)
          : snapshot.paymentDate,
      draftSaved:
        !!(run?.status === 'Draft' || run?.pendingDraft) &&
        snapshot.inputHash ===
          (run?.status === 'Draft'
            ? run.inputHash
            : run?.pendingDraft?.inputHash),
      historicalChecks: this.historical(run),
      processedEmployeeIds: [...this.processed(run)],
      readOnly: snapshot.checks.length === 0,
    };
  }
  private assertUnprocessed(run: PayrollRun | null | undefined, ids: string[]) {
    const processed = this.processed(run);
    if (ids.some((id) => processed.has(id)))
      throw new ConflictException(
        'An employee is already finalized for this pay period. Review the historical payroll and select only unprocessed employees.',
      );
  }
  private assertSize(document: unknown) {
    if (Buffer.byteLength(JSON.stringify(document)) > 12 * 1024 * 1024)
      throw new BadRequestException(
        'Payroll exceeds the safe storage limit. Contact support to process this organization.',
      );
  }
  async preview(body: RunRequest) {
    const preview = await this.previewSnapshot(body);
    const { periodEnd } = this.period(body.period, true);
    const employees = await this.employees.find().lean().exec();
    return {
      ...preview,
      employeeCompensation: employees
        .filter(
          (employee) =>
            (employee.status ?? 'Active') === 'Active' &&
            new Date(employee.rehireDate ?? employee.hireDate) <= periodEnd,
        )
        .map((employee) => ({
          employeeId: employee._id.toString(),
          payFrequency: employee.payFrequency ?? 'Monthly',
          monthlyCtc: this.monthlyCtc(
            employee.annualCtc,
            employee.payFrequency ?? 'Monthly',
          ),
        })),
    };
  }
  private async previewSnapshot(body: RunRequest) {
    this.period(body?.period, true);
    const requested = this.ids(body.employeeIds, true);
    const run = await this.existing(body.period);
    const saved = run?.status === 'Draft' ? run : run?.pendingDraft;
    const processed = this.processed(run);
    // Restore the period's saved selection even when launched from a historical
    // employee; all historical employees remain visible and locked in the table.
    if (
      run?.status === 'Submitted' &&
      !saved &&
      requested.length > 0 &&
      requested.every((id) => processed.has(id)) &&
      body.recalculate !== true
    ) {
      return this.withHistory(
        {
          ...this.present(run),
          status: 'Draft',
          checks: [],
          inputHash: '',
          totals: { employerContributions: 0, deductions: 0, netPay: 0 },
        },
        run,
      );
    }
    if (saved && body.recalculate !== true) {
      try {
        const latest = await this.calculate(
          body.period,
          saved.checks.map((c) => c.employeeId),
        );
        return this.withHistory(
          { ...saved, version: run!.version },
          run,
          latest.inputHash !== saved.inputHash,
        );
      } catch (error) {
        return this.withHistory(
          { ...saved, version: run!.version },
          run,
          true,
          error instanceof Error ? error.message : 'Recalculation required.',
        );
      }
    }
    const ids = requested.filter((id) => !processed.has(id));
    // Historical viewing must work even if today's salary settings are invalid.
    if (!ids.length && run?.status === 'Submitted' && !saved) {
      return this.withHistory(
        {
          ...this.present(run),
          status: 'Draft',
          checks: [],
          inputHash: '',
          totals: { employerContributions: 0, deductions: 0, netPay: 0 },
        },
        run,
      );
    }
    return this.withHistory(
      {
        ...(await this.calculate(body.period, ids)),
        status: 'Draft',
        version: run?.version ?? 0,
      },
      run,
    );
  }
  async save(body: RunRequest, actor: string) {
    await this.ready();
    if (!Number.isSafeInteger(body?.version) || body.version! < 0)
      throw new BadRequestException('A valid draft version is required.');
    const run = await this.existing(body.period);
    const savedDraft = run?.status === 'Draft' ? run : run?.pendingDraft;
    const paymentDate =
      body.paymentDate === undefined
        ? (savedDraft?.paymentDate ?? null)
        : this.validatePaymentDate(body.paymentDate, true);
    const ids = this.ids(body.employeeIds, true);
    this.assertUnprocessed(run, ids);
    const calculated = await this.calculate(body.period, ids);
    if (calculated.inputHash !== body.inputHash)
      throw new ConflictException(
        'Payroll inputs changed. Recalculate and review before saving.',
      );
    const update = {
      ...calculated,
      paymentDate,
      status: 'Draft' as const,
      updatedBy: actor,
      version: body.version! + 1,
    };
    try {
      if (body.version === 0) {
        this.assertSize(update);
        const created = (
          await this.runs.create({ ...update, createdBy: actor })
        ).toObject();
        return this.withHistory(created, created);
      }
      if (!run || run.version !== body.version)
        throw new ConflictException('Draft changed. Reopen the period.');
      const additional = run.status === 'Submitted';
      const pendingDraft = {
        ...update,
        createdBy: run.pendingDraft?.createdBy ?? actor,
        createdAt: run.pendingDraft?.createdAt ?? new Date(),
        updatedAt: new Date(),
      };
      this.assertSize(
        additional ? { ...run, pendingDraft } : { ...run, ...update },
      );
      const saved = await this.runs
        .findOneAndUpdate(
          {
            organizationId: this.org(),
            period: body.period,
            status: run.status,
            version: body.version,
          },
          additional
            ? { $set: { pendingDraft }, $inc: { version: 1 } }
            : { $set: update },
          { returnDocument: 'after' },
        )
        .lean()
        .exec();
      if (!saved)
        throw new ConflictException(
          'Draft changed or payroll was submitted. Reopen the period.',
        );
      return this.withHistory(
        additional ? { ...saved.pendingDraft, version: saved.version } : saved,
        saved,
      );
    } catch (error) {
      if ((error as { code?: number }).code === 11000)
        throw new ConflictException(
          'This period already exists. Reopen it before saving.',
        );
      throw error;
    }
  }
  async submit(
    period: string,
    body: SubmitPayrollRequest,
    actor: string,
  ) {
    await this.ready();
    this.period(period, true);
    if (
      !body ||
      !Number.isSafeInteger(body.version) ||
      body.version < 1 ||
      typeof body.idempotencyKey !== 'string' ||
      !/^[a-zA-Z0-9-]{16,80}$/.test(body.idempotencyKey)
    )
      throw new BadRequestException(
        'A saved draft version and valid idempotency key are required.',
      );
    this.validatePaymentDate(body.paymentDate);
    const run = await this.existing(period);
    if (!run)
      throw new NotFoundException('Save the payroll draft before submitting.');
    const retry = this.submissions(run).find(
      (s) => s.idempotencyKey === body.idempotencyKey,
    );
    if (retry) {
      if (retry.paymentDate !== body.paymentDate)
        throw new ConflictException(
          'This submission key was already used with another payment date.',
        );
      return this.present(retry);
    }
    const draft = run.status === 'Draft' ? run : run.pendingDraft;
    if (!draft)
      throw new ConflictException(
        'Selected payroll is already finalized. Save a draft containing unprocessed employees before submitting.',
      );
    if (run.version !== body.version)
      throw new ConflictException(
        'Draft changed. Reopen and review before submitting.',
      );
    if (!draft.checks.length)
      throw new BadRequestException(
        'Select at least one unprocessed employee before submitting.',
      );
    if (draft.paymentDate && draft.paymentDate !== body.paymentDate)
      throw new ConflictException(
        'Payment date changed. Save the updated date in the draft before submitting.',
      );
    const ids = draft.checks.map((c) => c.employeeId);
    this.assertUnprocessed(run, ids);
    const validate = async () => {
      const latest = await this.calculate(period, ids);
      if (
        latest.inputHash !== draft.inputHash ||
        hash(latest.checks) !== hash(draft.checks) ||
        hash(latest.totals) !== hash(draft.totals)
      )
        throw new ConflictException(
          'Payroll inputs changed. Recalculate, review and save before submitting.',
        );
    };
    await validate();
    const checks = draft.checks.map((check) => ({
      ...check,
      pdf: payslipPdf(draft.organizationName, period, body.paymentDate, check),
    }));
    const finalFields = {
      checks,
      status: 'Submitted' as const,
      paymentDate: body.paymentDate,
      submittedAt: new Date(),
      submittedBy: actor,
      updatedBy: actor,
      idempotencyKey: body.idempotencyKey,
    };
    const {
      pendingDraft: _pending,
      additionalSubmissions: _previous,
      ...source
    } = draft;
    const snapshot = {
      ...source,
      ...finalFields,
      version: run.version + 1,
      updatedAt: new Date(),
    };
    const additional = run.status === 'Submitted';
    this.assertSize(
      additional
        ? {
            ...run,
            pendingDraft: undefined,
            additionalSubmissions: [
              ...(run.additionalSubmissions ?? []),
              snapshot,
            ],
          }
        : { ...run, ...finalFields },
    );
    await validate();
    // One document owns every employee-period reservation. The version check and
    // array predicates serialize overlapping batches at the database boundary.
    const submitted = await this.runs
      .findOneAndUpdate(
        {
          organizationId: this.org(),
          period,
          status: run.status,
          version: body.version,
          ...(additional
            ? {
                'checks.employeeId': { $nin: ids },
                'additionalSubmissions.checks.employeeId': { $nin: ids },
              }
            : {}),
        },
        additional
          ? {
              $push: { additionalSubmissions: snapshot },
              $unset: { pendingDraft: '' },
              $inc: { version: 1 },
            }
          : { $set: finalFields, $inc: { version: 1 } },
        { returnDocument: 'after' },
      )
      .lean()
      .exec();
    if (submitted) return this.present(additional ? snapshot : submitted);
    const winner = this.submissions(await this.existing(period)).find(
      (s) =>
        s.idempotencyKey === body.idempotencyKey &&
        s.paymentDate === body.paymentDate,
    );
    if (winner) return this.present(winner);
    throw new ConflictException(
      'Payroll changed or was submitted by another request. Reopen the period.',
    );
  }
  async submission(period: string, submissionId?: string) {
    const run = await this.existing(period);
    const submission = this.submissions(run).find(
      (s) => !submissionId || s.idempotencyKey === submissionId,
    );
    if (!submission)
      throw new NotFoundException('Submitted payroll not found.');
    return this.present(submission);
  }
  async history(employeeId: string) {
    this.ids([employeeId]);
    const runs = await this.runs
      .find({
        organizationId: this.org(),
        status: 'Submitted',
        $or: [
          { 'checks.employeeId': employeeId },
          { 'additionalSubmissions.checks.employeeId': employeeId },
        ],
      })
      .select('-checks.pdf -additionalSubmissions.checks.pdf -pendingDraft')
      .sort({ period: -1 })
      .lean()
      .exec();
    return runs.flatMap((run) =>
      this.submissions(run)
        .filter((s) => s.checks.some((c) => c.employeeId === employeeId))
        .map((s) => ({
          period: s.period,
          paymentDate: s.paymentDate,
          submittedAt: s.submittedAt,
          ...this.present(s).checks.find(
            (c: PayCheckSnapshot) => c.employeeId === employeeId,
          ),
        })),
    );
  }
  async pdf(period: string, employeeId: string) {
    this.ids([employeeId]);
    const check = this.submissions(await this.existing(period))
      .flatMap((s) => s.checks)
      .find((c) => c.employeeId === employeeId);
    if (!check?.pdf) throw new NotFoundException('Pay check not found.');
    return Buffer.from(check.pdf, 'base64');
  }
}
