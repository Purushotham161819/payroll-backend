import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { EmployeeIdentifierService } from './employee-identifier.service';
import { Model, Types } from 'mongoose';
import { Employee, EmployeeSchema } from './schemas/employee.schema';
import {
  RehireEmployeeDto,
  TerminateEmployeeDto,
  TERMINATION_REASONS,
} from './dto/lifecycle.dto';
import { PayrollGeneratorController } from '../payroll-generator/payroll-generator.controller';
import { PayrollGeneratorService } from '../payroll-generator/payroll-generator.service';

describe('Employee lifecycle', () => {
  const id = '507f1f77bcf86cd799439011';
  let record: any;
  let model: any;
  let service: EmployeesService;
  const terminate = (date = '2020-03-01') =>
    service.terminate(id, { terminationDate: date, reason: 'Retirement' });
  beforeEach(() => {
    record = {
      _id: new Types.ObjectId(id),
      employeeId: 'EMP001',
      hireDate: new Date('2020-01-01'),
      annualCtc: 500000,
      payFrequency: 'Monthly',
    };
    model = {
      findById: jest.fn(() => ({
        lean: () => ({ exec: async () => structuredClone(record) }),
      })),
      findOneAndUpdate: jest.fn((filter, update) => ({
        exec: async () => {
          const expected =
            typeof filter.lifecycleVersion === 'number'
              ? filter.lifecycleVersion
              : undefined;
          if (record.lifecycleVersion !== expected) return null;
          Object.assign(record, update.$set);
          record.lifecycleVersion = (record.lifecycleVersion ?? 0) + 1;
          return structuredClone(record);
        },
      })),
    };
    service = new EmployeesService(
      model as Model<Employee>,
      {} as EmployeeIdentifierService,
    );
  });
  it('preserves identity, original hire date, salary settings and every employment period across cycles', async () => {
    const original = structuredClone(record);
    await terminate();
    expect(record.status).toBe('Terminated');
    expect(record.employmentHistory[0]).toMatchObject({
      endDate: new Date('2020-03-01'),
      terminationReason: 'Retirement',
    });
    await service.rehire(id, { rehireDate: '2020-04-01' });
    expect(record.status).toBe('Active');
    expect(record.rehireDate).toEqual(new Date('2020-04-01'));
    await terminate('2020-05-01');
    await service.rehire(id, { rehireDate: '2020-06-01' });
    expect(record.employmentHistory).toHaveLength(3);
    expect(record.employmentHistory[0].endDate).toEqual(new Date('2020-03-01'));
    expect(record.employmentHistory[1].endDate).toEqual(new Date('2020-05-01'));
    expect(record.employeeId).toBe(original.employeeId);
    expect(record.hireDate).toEqual(original.hireDate);
    expect(record.annualCtc).toBe(original.annualCtc);
    expect(record.payFrequency).toBe(original.payFrequency);
    expect(Object.keys(model)).toEqual(['findById', 'findOneAndUpdate']);
  });
  it.each([
    '',
    'invalid',
    '2020-02-30',
    '2019-12-31',
    '2999-01-01',
    '2020-01-01T12:00:00Z',
  ])(
    'rejects invalid, preceding and future termination date %s',
    async (date) => {
      await expect(terminate(date)).rejects.toBeInstanceOf(BadRequestException);
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    },
  );
  it('requires a supported reason and limits explanation length', async () => {
    await expect(
      service.terminate(id, {
        terminationDate: '2020-03-01',
        reason: 'bad' as any,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.terminate(id, {
        terminationDate: '2020-03-01',
        reason: 'Other',
        explanation: 'x'.repeat(251),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('records optional Other explanation and timestamps', async () => {
    await service.terminate(id, {
      terminationDate: '2020-03-01',
      reason: 'Other',
      explanation: ' Contract completed ',
    });
    expect(record.employmentHistory[0]).toMatchObject({
      explanation: 'Contract completed',
      recordedAt: expect.any(Date),
      terminatedAt: expect.any(Date),
    });
  });
  it('rejects invalid and missing IDs', async () => {
    await expect(
      service.rehire('EMP001', { rehireDate: '2020-04-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    record = null;
    await expect(terminate()).rejects.toBeInstanceOf(NotFoundException);
  });
  it('rejects active rehire and sequential duplicate termination', async () => {
    await expect(
      service.rehire(id, { rehireDate: '2020-04-01' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await terminate();
    await expect(terminate()).rejects.toBeInstanceOf(ConflictException);
    expect(record.employmentHistory).toHaveLength(1);
  });
  it('permits only one concurrent lifecycle request', async () => {
    const results = await Promise.allSettled([terminate(), terminate()]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(record.lifecycleVersion).toBe(1);
  });
  it.each(['2020-03-01', '2020-02-01', '2999-01-01', '2020-04-31'])(
    'rejects conflicting or future rehire date %s',
    async (rehireDate) => {
      await terminate();
      await expect(service.rehire(id, { rehireDate })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(record.status).toBe('Terminated');
    },
  );
  it('defaults legacy documents to Active in MongoDB schema', () => {
    expect(EmployeeSchema.path('status').getDefault(null, false)).toBe(
      'Active',
    );
  });
  it('validates lifecycle payloads through the application ValidationPipe', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
    for (const body of [
      {},
      { terminationDate: '2020-03-01' },
      { terminationDate: '2020-03-01', reason: 'bad' },
      { terminationDate: '2020-03-01', reason: 'Other', status: 'Active' },
    ]) {
      await expect(
        pipe.transform(body, { type: 'body', metatype: TerminateEmployeeDto }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    await expect(
      pipe.transform({}, { type: 'body', metatype: RehireEmployeeDto }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(TERMINATION_REASONS).toHaveLength(7);
  });
});

describe('Payroll lifecycle selection', () => {
  it('excludes terminated employees by default and allows explicit historical projections without altering calculations', async () => {
    const records = [
      { annualCtc: 100, status: 'Active' },
      { annualCtc: 200 },
      { annualCtc: 300, status: 'Terminated' },
    ];
    const calculateAnnual = jest.fn((amount: number) => ({ amount }));
    const service = new PayrollGeneratorService(
      { find: () => ({ lean: () => ({ exec: async () => records }) }) } as any,
      { findAll: async () => [] } as any,
      { get: async () => ({}) } as any,
      { calculateAnnual } as any,
    );
    expect(
      (await service.annual()).employees.map((row) => row.employee.annualCtc),
    ).toEqual([100, 200]);
    expect(
      (await service.annual(undefined, true)).employees.map(
        (row) => row.employee.annualCtc,
      ),
    ).toEqual([100, 200, 300]);
    expect(records).toHaveLength(3);
    expect(calculateAnnual).toHaveBeenLastCalledWith(300, [], {});
  });
  it('validates the historical inclusion flag on both routes', () => {
    const controller = new PayrollGeneratorController({
      annual: jest.fn(),
    } as any);
    expect(() => controller.annual('yes')).toThrow(BadRequestException);
    expect(() =>
      controller.selectedAnnual({ includeTerminated: 'true' }),
    ).toThrow(BadRequestException);
  });
});
