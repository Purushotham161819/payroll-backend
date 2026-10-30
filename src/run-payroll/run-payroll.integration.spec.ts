import { Connection, Model } from 'mongoose';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import request from 'supertest';
import { RunPayrollModule } from './run-payroll.module';
import { randomUUID } from 'node:crypto';
import {
  RunPayrollService,
  monthlyAmount,
  sumMoney,
} from './run-payroll.service';
import { PayrollRun } from './schemas/payroll-run.schema';
import { tenantContext } from '../organizations/tenant-context';
import * as pdf from './payslip';

const integration =
  process.env.RUN_PAYROLL_MONGO_TESTS === '1' ? describe : describe.skip;
integration('Run Payroll persistence (isolated MongoDB)', () => {
  let db: Connection, service: RunPayrollService, runs: Model<PayrollRun>;
  let app: INestApplication;
  let employees: Model<any>, components: Model<any>;
  let ids: string[];
  const dbName = `payroll_run_test_${process.pid}_${Date.now()}`;
  const period = (month: number) =>
    `${new Date().getFullYear()}-${String(month).padStart(2, '0')}`;
  const preview = async (month: number, selected = ids) =>
    service.preview({
      period: period(month),
      employeeIds: selected,
      recalculate: true,
    });
  const save = async (month: number, selected = ids) => {
    const run = await preview(month, selected);
    return service.save(
      {
        period: run.period,
        employeeIds: selected,
        version: run.version,
        inputHash: run.inputHash,
      },
      'tester',
    );
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot('mongodb://127.0.0.1:27017', {
          dbName,
          serverSelectionTimeoutMS: 3000,
        }),
        RunPayrollModule,
      ],
    }).compile();
    app = module.createNestApplication();
    app.use((req: any, _res: any, next: () => void) => {
      req.account = { id: 'tester' };
      next();
    });
    await app.init();
    db = app.get(getConnectionToken());
    runs = db.model('PayrollRun');
    employees = db.model('Employee');
    components = db.model('SalaryComponent');
    const settings = db.model('StatutoryDeductions');
    for (const [code, value] of [
      ['BASIC', 40],
      ['DA', 10],
      ['RA', 15],
    ] as const)
      await components.updateOne(
        { code },
        {
          $set: {
            code,
            name: `Visible ${code}`,
            calculationValue: value,
            category: 'earning',
            calculationBaseType: 'annual_ctc',
            calculationType: 'percentage',
            status: 'active',
            showInPayslip: true,
          },
        },
      );
    await components.create({
      code: 'SECRET',
      name: 'Hidden deduction',
      calculationValue: 100,
      category: 'deduction',
      calculationBaseType: 'annual_ctc',
      calculationType: 'fixed',
      fixedAmountPeriod: 'monthly',
      status: 'active',
      showInPayslip: false,
    });
    await components.create({
      code: 'LOAN',
      name: 'Visible Loan',
      calculationValue: 50,
      category: 'deduction',
      calculationBaseType: 'annual_ctc',
      calculationType: 'fixed',
      fixedAmountPeriod: 'monthly',
      status: 'active',
      showInPayslip: true,
    });
    await settings.create({
      _id: 'current',
      wageCap: 180000,
      epsEmployerContributionPercentage: 8,
      epfEmployerContributionPercentage: 4,
      esiEmployerContributionPercentage: 3,
      epfEmployeeContributionPercentage: 12,
      esiEmployeeContributionPercentage: 0.75,
    });
    ids = (
      await employees.create(
        ['Ada', 'Grace', 'Alan'].map((firstName, index) => ({
          firstName,
          lastName: 'Example',
          email: `payroll-${index}@example.test`,
          employeeId: `EMP00${index + 1}`,
          dateOfBirth: new Date('1990-01-01'),
          hireDate: new Date('2020-01-01'),
          annualCtc: 107500,
          status: 'Active',
          payFrequency: 'Monthly',
        })),
      )
    ).map((e) => String(e._id));
    service = app.get(RunPayrollService);
  }, 30000);
  afterAll(async () => {
    // Only remove this suite's newly created disposable database, never app data.
    if (db?.name === dbName && /^payroll_run_test_\d+_\d+$/.test(dbName))
      await db.dropDatabase();
    await app?.close();
  });
  it('uses engine net pay and existing monthly derivation; employer amounts are separate and totals are decimal safe', async () => {
    const run = await preview(1);
    expect(run.checks).toHaveLength(3);
    for (const check of run.checks) {
      const annual = check.calculation.annual;
      expect(check.netPay).toBe(monthlyAmount(annual.annualNetPay));
      expect(check.grossPay).toBe(8333.33);
      expect(check.deductions).toBe(150);
      expect(check.employerContributions).toBe(625);
      expect(check.paymentStatus).toBe('Not Paid');
      expect(check.payFrequency).toBe('Monthly');
      expect(check.monthlyCtc).toBe(monthlyAmount(annual.annualCtc));
    }
    expect(run.totals.netPay).toBe(
      sumMoney(run.checks.map((c: any) => c.netPay)),
    );
    expect(await runs.countDocuments()).toBe(0);
    expect(run.totalPayrollCost).toBe(26874.99);
    expect(run.totalPayrollCostPeriod).toBe('Monthly');
    expect(run.employeeCompensation).toHaveLength(3);
  });
  it('rejects invalid IDs, foreign employees, periods, terminated employees and future hires', async () => {
    await expect(
      service.preview({ period: '2026-13', employeeIds: ids }),
    ).rejects.toThrow('valid payroll month');
    await expect(preview(1, ['bad'])).rejects.toThrow('valid employee IDs');
    await expect(preview(1, [ids[0], ids[0]])).rejects.toThrow('distinct');
    await expect(preview(1, ['000000000000000000000000'])).rejects.toThrow(
      'organization',
    );
    await employees.updateOne(
      { _id: ids[2] },
      { $set: { status: 'Terminated' } },
    );
    await expect(preview(1)).rejects.toThrow('not eligible');
    await employees.updateOne(
      { _id: ids[2] },
      { $set: { status: 'Active', hireDate: new Date('2099-01-01') } },
    );
    await expect(preview(1)).rejects.toThrow('not eligible');
    await employees.updateOne(
      { _id: ids[2] },
      { $set: { hireDate: new Date('2020-01-01') } },
    );
  });
  it('saves one editable versioned draft; reopens saved selections and amounts; drafts have no checks history or PDFs', async () => {
    const saved = await save(1, ids.slice(0, 2));
    expect(saved.version).toBe(1);
    expect(saved.checks.every((c: any) => !c.pdf && !c.pdfUrl)).toBe(true);
    const reopened = await service.preview({
      period: period(1),
      employeeIds: [ids[2]],
    });
    expect(reopened.checks.map((c: any) => c.employeeId)).toEqual(
      saved.checks.map((c: any) => c.employeeId),
    );
    expect(await service.history(ids[0])).toEqual([]);
    const updated = await save(1, [ids[1], ids[2]]);
    expect(updated.version).toBe(2);
    expect(await runs.countDocuments({ period: period(1) })).toBe(1);
    await expect(
      service.save(
        {
          period: period(1),
          employeeIds: [ids[0]],
          version: saved.version,
          inputHash: (await preview(1, [ids[0]])).inputHash,
        },
        'other',
      ),
    ).rejects.toThrow('changed');
  });
  it('flags stale snapshots without silently changing them and requires explicit review and save', async () => {
    const saved = await save(2);
    await employees.updateOne({ _id: ids[0] }, { $set: { annualCtc: 215000 } });
    const reopened = await service.preview({
      period: period(2),
      employeeIds: ids,
    });
    expect(reopened.stale).toBe(true);
    expect(reopened.checks).toEqual(saved.checks);
    await expect(
      service.submit(
        period(2),
        {
          version: saved.version,
          paymentDate: period(2) + '-28',
          idempotencyKey: randomUUID(),
        },
        'tester',
      ),
    ).rejects.toThrow('inputs changed');
    const refresh = await preview(2);
    expect(
      refresh.checks.find((c: any) => c.employeeId === ids[0]).netPay,
    ).not.toBe(saved.checks.find((c: any) => c.employeeId === ids[0]).netPay);
    await service.save(
      {
        period: period(2),
        employeeIds: ids,
        version: refresh.version,
        inputHash: refresh.inputHash,
      },
      'tester',
    );
    await employees.updateOne({ _id: ids[0] }, { $set: { annualCtc: 107500 } });
  });
  it('finalizes all individual PDFs and summary atomically; retries return the same immutable submission', async () => {
    const draft = await save(3);
    const body = {
      version: draft.version,
      paymentDate: period(3) + '-28',
      idempotencyKey: randomUUID(),
    };
    const submitted = await service.submit(period(3), body, 'tester');
    expect(submitted.status).toBe('Submitted');
    expect(submitted.paymentDate).toBe(body.paymentDate);
    expect(submitted.submittedAt).toBeInstanceOf(Date);
    expect(
      submitted.checks.every(
        (c: any) => c.paymentStatus === 'Payment Pending' && c.pdfUrl && !c.pdf,
      ),
    ).toBe(true);
    expect(submitted.totals).toEqual(draft.totals);
    const bytes = await service.pdf(period(3), ids[0]);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.toString()).toContain('PAYSLIP');
    expect(bytes.toString()).toContain('Visible Loan');
    expect(bytes.toString()).not.toContain('Hidden deduction');
    expect(bytes.toString()).toContain('PayStream');
    expect(await service.submit(period(3), body, 'tester')).toEqual(submitted);
    await expect(
      service.submit(
        period(3),
        { ...body, idempotencyKey: randomUUID() },
        'tester',
      ),
    ).rejects.toThrow('already finalized');
    await employees.updateOne({ _id: ids[0] }, { $set: { annualCtc: 200000 } });
    await components.updateOne(
      { code: 'LOAN' },
      { $set: { name: 'Renamed Loan' } },
    );
    expect(await service.pdf(period(3), ids[0])).toEqual(bytes);
    expect((await service.history(ids[0]))[0].period).toBe(period(3));
    await employees.updateOne({ _id: ids[0] }, { $set: { annualCtc: 107500 } });
  });
  it('allows only one winner under concurrent submissions and concurrent draft creation', async () => {
    const draft = await save(4);
    const body = { version: draft.version, paymentDate: period(4) + '-28' };
    const attempts = await Promise.allSettled(
      [1, 2].map(() =>
        service.submit(
          period(4),
          { ...body, idempotencyKey: randomUUID() },
          'tester',
        ),
      ),
    );
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      await runs.countDocuments({ period: period(4), status: 'Submitted' }),
    ).toBe(1);
    const calculated = await preview(5);
    const request = {
      period: period(5),
      employeeIds: ids,
      version: 0,
      inputHash: calculated.inputHash,
    };
    const saves = await Promise.allSettled([
      service.save(request, 'a'),
      service.save(request, 'b'),
    ]);
    expect(saves.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
  it('leaves the draft untouched if PDF generation fails and permits a safe retry', async () => {
    const draft = await save(6);
    const original = pdf.payslipPdf;
    const generate = jest
      .spyOn(pdf, 'payslipPdf')
      .mockImplementationOnce(original)
      .mockImplementationOnce(() => {
        throw new Error('PDF failed');
      });
    const body = {
      version: draft.version,
      paymentDate: period(6) + '-28',
      idempotencyKey: randomUUID(),
    };
    await expect(service.submit(period(6), body, 'tester')).rejects.toThrow(
      'PDF failed',
    );
    generate.mockRestore();
    const persisted = await runs.findOne({ period: period(6) }).lean();
    expect(persisted?.status).toBe('Draft');
    expect(persisted?.checks.every((c) => !c.pdf)).toBe(true);
    expect((await service.submit(period(6), body, 'tester')).status).toBe(
      'Submitted',
    );
  });
  it('keeps failed persistence as a draft and supports concurrent retries with the same key', async () => {
    const draft = await save(7);
    const body = {
      version: draft.version,
      paymentDate: period(7) + '-28',
      idempotencyKey: randomUUID(),
    };
    const write = jest
      .spyOn(runs, 'findOneAndUpdate')
      .mockImplementationOnce(() => {
        throw new Error('Persistence unavailable');
      });
    await expect(service.submit(period(7), body, 'tester')).rejects.toThrow(
      'Persistence unavailable',
    );
    write.mockRestore();
    expect((await runs.findOne({ period: period(7) }).lean())?.status).toBe(
      'Draft',
    );
    const retries = await Promise.all([
      service.submit(period(7), body, 'tester'),
      service.submit(period(7), body, 'tester'),
    ]);
    expect(retries[0]).toEqual(retries[1]);
    expect(await runs.countDocuments({ period: period(7) })).toBe(1);
  });
  it('keeps organization histories, summaries and PDFs isolated', async () => {
    await tenantContext.run({ organizationId: 'ORG999999' }, async () => {
      expect(await service.history(ids[0])).toEqual([]);
      await expect(service.pdf(period(3), ids[0])).rejects.toThrow('not found');
      await expect(service.submission(period(3))).rejects.toThrow('not found');
      await expect(preview(10, [ids[0]])).rejects.toThrow('organization');
    });
    await expect(
      service.pdf(period(3), '000000000000000000000000'),
    ).rejects.toThrow('not found');
  });
  it('wires the real feature module through preview, save, submit, history and PDF HTTP endpoints', async () => {
    const api = request(app.getHttpServer());
    const calculated = (
      await api
        .post('/payroll/runs/preview')
        .send({ period: period(9), employeeIds: [ids[0]] })
        .expect(201)
    ).body;
    const draft = (
      await api
        .post('/payroll/runs/draft')
        .send({
          period: period(9),
          employeeIds: [ids[0]],
          version: calculated.version,
          inputHash: calculated.inputHash,
        })
        .expect(201)
    ).body;
    const result = await api
      .post(`/payroll/runs/${period(9)}/submit`)
      .send({
        version: draft.version,
        paymentDate: period(9) + '-28',
        idempotencyKey: randomUUID(),
      })
      .expect(201);
    expect(result.body.submittedBy).toBe('tester');
    await api.get(`/payroll/runs/${period(9)}`).expect(200);
    const history = await api
      .get(`/payroll/employees/${ids[0]}/checks`)
      .expect(200);
    expect(history.body[0].period).toBe(period(9));
    await api
      .get(`/payroll/runs/${period(9)}/checks/${ids[0]}/pdf`)
      .expect(200)
      .expect('Content-Type', /application\/pdf/);
  });
  it('reopens submitted selections as immutable history and processes only new employees in additional batches', async () => {
    const initial = await save(10, [ids[0]]);
    const originalBody = {
      version: initial.version,
      paymentDate: period(10) + '-15',
      idempotencyKey: randomUUID(),
    };
    const original = await service.submit(
      period(10),
      originalBody,
      'first-actor',
    );
    const originalPdf = await service.pdf(period(10), ids[0]);
    const originalChecks = (await runs.findOne({ period: period(10) }).lean())!
      .checks;
    await employees.updateOne(
      { _id: ids[0] },
      { $set: { status: 'Terminated', annualCtc: 999999 } },
    );
    const generate = jest.spyOn(pdf, 'payslipPdf');
    const historical = await service.preview({
      period: period(10),
      employeeIds: [ids[0]],
    });
    expect(historical.status).toBe('Draft');
    expect(historical.readOnly).toBe(true);
    expect(historical.checks).toHaveLength(0);
    expect(historical.historicalChecks[0].netPay).toBe(
      original.checks[0].netPay,
    );
    expect(historical.historicalChecks[0].paymentStatus).toBe(
      'Payment Pending',
    );
    expect(generate).not.toHaveBeenCalled();
    generate.mockRestore();
    expect(
      (await runs.findOne({ period: period(10) }).lean())!.pendingDraft,
    ).toBeUndefined();
    const mixed = await preview(10, [ids[0], ids[1]]);
    expect(mixed.checks.map((c: any) => c.employeeId)).toEqual([ids[1]]);
    expect(mixed.historicalChecks.map((c: any) => c.employeeId)).toEqual([
      ids[0],
    ]);
    expect(mixed.totals.netPay).toBe(mixed.checks[0].netPay);
    const pending = await service.save(
      {
        period: period(10),
        employeeIds: [ids[1]],
        version: mixed.version,
        inputHash: mixed.inputHash,
      },
      'second-actor',
    );
    const reopened = await service.preview({
      period: period(10),
      employeeIds: [ids[2]],
    });
    expect(reopened.checks.map((c: any) => c.employeeId)).toEqual([ids[1]]);
    expect(reopened.version).toBe(pending.version);
    const revisitFinalized = await service.preview({
      period: period(10),
      employeeIds: [ids[0]],
    });
    // The unified period view restores its saved draft selection while keeping
    // the launching employee locked in historicalChecks.
    expect(revisitFinalized.readOnly).toBe(false);
    expect(revisitFinalized.checks.map((c: any) => c.employeeId)).toEqual([
      ids[1],
    ]);
    expect(revisitFinalized.historicalChecks[0].employeeId).toBe(ids[0]);
    expect(
      (await runs
        .findOne({ period: period(10) })
        .lean())!.pendingDraft!.checks.map((c) => c.employeeId),
    ).toEqual([ids[1]]);
    const empty = await preview(10, []);
    const emptySaved = await service.save(
      {
        period: period(10),
        employeeIds: [],
        version: empty.version,
        inputHash: empty.inputHash,
      },
      'second-actor',
    );
    expect(emptySaved.totals.netPay).toBe(0);
    expect(
      (await service.preview({ period: period(10), employeeIds: [ids[2]] }))
        .checks,
    ).toHaveLength(0);
    await expect(
      service.submit(
        period(10),
        {
          version: emptySaved.version,
          paymentDate: period(10) + '-28',
          idempotencyKey: randomUUID(),
        },
        'second-actor',
      ),
    ).rejects.toThrow('at least one');
    const updated = await save(10, [ids[1], ids[2]]);
    const attempts = await Promise.allSettled(
      [1, 2].map(() =>
        service.submit(
          period(10),
          {
            version: updated.version,
            paymentDate: period(10) + '-28',
            idempotencyKey: randomUUID(),
          },
          'second-actor',
        ),
      ),
    );
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const finalized = (await runs.findOne({ period: period(10) }).lean())!;
    expect(finalized.additionalSubmissions).toHaveLength(1);
    expect(finalized.checks).toEqual(originalChecks);
    expect(finalized.totals).toEqual(original.totals);
    expect(await service.pdf(period(10), ids[0])).toEqual(originalPdf);
    for (const id of ids)
      expect(
        (await service.history(id)).filter((c) => c.period === period(10)),
      ).toHaveLength(1);
    const batch = finalized.additionalSubmissions![0];
    expect(
      (await service.submission(period(10), batch.idempotencyKey)).checks,
    ).toHaveLength(2);
    const batchSummary = await request(app.getHttpServer())
      .get(`/payroll/runs/${period(10)}`)
      .query({ submissionId: batch.idempotencyKey })
      .expect(200);
    expect(batchSummary.body.checks).toHaveLength(2);
    expect((await service.submission(period(10))).checks).toHaveLength(1);
    expect(JSON.stringify(await service.submission(period(10)))).not.toContain(
      'additionalSubmissions',
    );
    await expect(
      service.save(
        {
          period: period(10),
          employeeIds: [ids[0]],
          version: finalized.version,
          inputHash: original.inputHash,
        },
        'attacker',
      ),
    ).rejects.toThrow('already finalized');
    const allHistory = await preview(10);
    expect(allHistory.checks).toHaveLength(0);
    expect(allHistory.historicalChecks).toHaveLength(3);
    await employees.updateOne(
      { _id: ids[0] },
      { $set: { status: 'Active', annualCtc: 107500 } },
    );
  });
  it('preserves original submissions when a later batch fails and serializes identical later-batch retries', async () => {
    const initial = await save(11, [ids[0]]);
    await service.submit(
      period(11),
      {
        version: initial.version,
        paymentDate: period(11) + '-15',
        idempotencyKey: randomUUID(),
      },
      'tester',
    );
    const originalPdf = await service.pdf(period(11), ids[0]);
    const pending = await save(11, [ids[1], ids[2]]);
    const body = {
      version: pending.version,
      paymentDate: period(11) + '-28',
      idempotencyKey: randomUUID(),
    };
    const generate = jest
      .spyOn(pdf, 'payslipPdf')
      .mockImplementationOnce(() => {
        throw new Error('Later PDF failed');
      });
    await expect(service.submit(period(11), body, 'tester')).rejects.toThrow(
      'Later PDF failed',
    );
    generate.mockRestore();
    let run = (await runs.findOne({ period: period(11) }).lean())!;
    expect(run.pendingDraft!.checks).toHaveLength(2);
    expect(run.additionalSubmissions ?? []).toHaveLength(0);
    expect(await service.pdf(period(11), ids[0])).toEqual(originalPdf);
    const persistence = jest
      .spyOn(runs, 'findOneAndUpdate')
      .mockImplementationOnce(() => {
        throw new Error('Later persistence failed');
      });
    await expect(service.submit(period(11), body, 'tester')).rejects.toThrow(
      'Later persistence failed',
    );
    persistence.mockRestore();
    const retries = await Promise.all([
      service.submit(period(11), body, 'tester'),
      service.submit(period(11), body, 'tester'),
    ]);
    expect(retries[0]).toEqual(retries[1]);
    run = (await runs.findOne({ period: period(11) }).lean())!;
    expect(run.additionalSubmissions).toHaveLength(1);
    expect(run.pendingDraft).toBeUndefined();
    expect(
      (await service.submit(period(11), body, 'tester')).checks,
    ).toHaveLength(2);
    await tenantContext.run({ organizationId: 'ORG999999' }, async () => {
      expect(await service.history(ids[1])).toHaveLength(0);
      await expect(service.pdf(period(11), ids[1])).rejects.toThrow(
        'not found',
      );
      await expect(
        service.submission(period(11), body.idempotencyKey),
      ).rejects.toThrow('not found');
    });
  });
  it('persists, updates, clears and restores the independent draft Payment Date with server validation', async () => {
    await employees.updateOne(
      { _id: ids[0] },
      { $set: { annualCtc: 107500.01 } },
    );
    await employees.updateOne(
      { _id: ids[1] },
      { $set: { annualCtc: 215000.02 } },
    );
    const calculated = await preview(12, ids.slice(0, 2));
    expect(calculated.totalPayrollCost).toBe(26875);
    expect(calculated.checks[0].annualCtc).toBeDefined();
    const firstDate = period(12) + '-28';
    let draft = await service.save(
      {
        period: period(12),
        employeeIds: ids.slice(0, 2),
        version: calculated.version,
        inputHash: calculated.inputHash,
        paymentDate: firstDate,
      },
      'tester',
    );
    expect(draft.paymentDate).toBe(firstDate);
    expect(draft.draftSaved).toBe(true);
    expect(
      (await service.preview({ period: period(12), employeeIds: [ids[2]] }))
        .paymentDate,
    ).toBe(firstDate);
    expect((await preview(12, [ids[0]])).paymentDate).toBe(firstDate);
    expect(
      (await service.preview({ period: period(1), employeeIds: ids }))
        .paymentDate,
    ).toBeNull();
    for (const invalid of [
      'not-a-date',
      period(12).slice(0, 4) + '-02-30',
      firstDate + 'T00:00:00Z',
    ]) {
      await expect(
        service.save(
          {
            period: period(12),
            employeeIds: ids.slice(0, 2),
            version: draft.version,
            inputHash: draft.inputHash,
            paymentDate: invalid,
          },
          'tester',
        ),
      ).rejects.toThrow('valid payment date');
    }
    expect((await runs.findOne({ period: period(12) }).lean())!.version).toBe(
      draft.version,
    );
    draft = await service.save(
      {
        period: period(12),
        employeeIds: ids.slice(0, 2),
        version: draft.version,
        inputHash: draft.inputHash,
        paymentDate: null,
      },
      'tester',
    );
    expect(draft.paymentDate).toBeNull();
    const paymentDate = `${new Date().getFullYear() + 1}-01-05`;
    draft = await service.save(
      {
        period: period(12),
        employeeIds: ids.slice(0, 2),
        version: draft.version,
        inputHash: draft.inputHash,
        paymentDate,
      },
      'tester',
    );
    // Older API clients may omit this optional field without clearing it.
    draft = await service.save(
      {
        period: period(12),
        employeeIds: ids.slice(0, 2),
        version: draft.version,
        inputHash: draft.inputHash,
      },
      'tester',
    );
    expect(draft.paymentDate).toBe(paymentDate);
    expect(
      (await runs.findOne({ period: period(12) }).lean())!.checks.every(
        (c) => !c.pdf,
      ),
    ).toBe(true);
    expect(
      (await service.history(ids[0])).filter((c) => c.period === period(12)),
    ).toHaveLength(0);
    await expect(
      service.submit(
        period(12),
        {
          version: draft.version,
          paymentDate: firstDate,
          idempotencyKey: randomUUID(),
        },
        'tester',
      ),
    ).rejects.toThrow('Payment date changed');
    const submission = await service.submit(
      period(12),
      { version: draft.version, paymentDate, idempotencyKey: randomUUID() },
      'tester',
    );
    expect(submission.paymentDate).toBe(paymentDate);
    expect(submission.submittedAt).toBeInstanceOf(Date);
    expect(submission.totalPayrollCost).toBe(26875);
    const bytes = await service.pdf(period(12), ids[0]);
    await employees.updateOne({ _id: ids[0] }, { $set: { annualCtc: 999999 } });
    const mixed = await preview(12, ids);
    expect(mixed.checks.map((c: any) => c.employeeId)).toEqual([ids[2]]);
    expect(mixed.totalPayrollCost).toBe(8958.33);
    expect(
      mixed.historicalChecks.find((c: any) => c.employeeId === ids[0])
        .monthlyCtc,
    ).toBe(8958.33);
    expect(
      mixed.historicalChecks.find((c: any) => c.employeeId === ids[0])
        .annualCtc,
    ).toBe(107500.01);
    expect(
      mixed.historicalChecks.every(
        (c: any) => c.paymentStatus === 'Payment Pending',
      ),
    ).toBe(true);
    expect(await service.pdf(period(12), ids[0])).toEqual(bytes);
    expect(mixed.paymentDate).toBeNull();
    const pending = await service.save(
      {
        period: period(12),
        employeeIds: [ids[2]],
        version: mixed.version,
        inputHash: mixed.inputHash,
        paymentDate: firstDate,
      },
      'tester',
    );
    expect(
      (await runs.findOne({ period: period(12) }).lean())!.paymentDate,
    ).toBe(paymentDate);
    expect(pending.paymentDate).toBe(firstDate);
    expect(
      (await service.preview({ period: period(12), employeeIds: [ids[0]] }))
        .paymentDate,
    ).toBe(firstDate);
    await employees.updateMany(
      { _id: { $in: ids.slice(0, 2) } },
      { $set: { annualCtc: 107500 } },
    );
  });
  it('uses the existing annual reporting precision for current CTC and rejects unsupported pay-frequency conversions', async () => {
    await employees.updateOne({ _id: ids[0] }, { $set: { annualCtc: 0.055 } });
    const snapshot = await preview(1, [ids[0]]);
    expect(snapshot.checks[0].monthlyCtc).toBe(
      monthlyAmount(snapshot.checks[0].calculation.annual.annualCtc),
    );
    expect(
      snapshot.employeeCompensation.find((c) => c.employeeId === ids[0])!
        .monthlyCtc,
    ).toBe(snapshot.checks[0].monthlyCtc);
    // A legacy/out-of-band value must not be silently converted as Monthly.
    await employees.collection.updateOne(
      { _id: new (await import('mongoose')).Types.ObjectId(ids[0]) },
      { $set: { payFrequency: 'Weekly' } },
    );
    const other = await preview(1, [ids[1]]);
    expect(
      other.employeeCompensation.find((c) => c.employeeId === ids[0])!
        .monthlyCtc,
    ).toBeNull();
    await expect(preview(1, [ids[0]])).rejects.toThrow('not eligible');
    await employees.collection.updateOne(
      { _id: new (await import('mongoose')).Types.ObjectId(ids[0]) },
      { $set: { payFrequency: 'Monthly', annualCtc: 107500 } },
    );
  });
  it('rejects oversized PDFs before any finalization write', async () => {
    const draft = await save(8, [ids[0]]);
    const generate = jest
      .spyOn(pdf, 'payslipPdf')
      .mockReturnValueOnce('x'.repeat(13 * 1024 * 1024));
    await expect(
      service.submit(
        period(8),
        {
          version: draft.version,
          paymentDate: period(8) + '-28',
          idempotencyKey: randomUUID(),
        },
        'tester',
      ),
    ).rejects.toThrow('safe storage limit');
    generate.mockRestore();
    expect((await runs.findOne({ period: period(8) }).lean())?.status).toBe(
      'Draft',
    );
  });
});
