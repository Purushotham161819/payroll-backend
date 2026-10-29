import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { SalaryComponentsController } from './salary-components.controller';
import { Types, model } from 'mongoose';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SalaryComponentsService } from './salary-components.service';
import { SalaryComponentSchema } from './salary-component.schema';
import {
  CreateSalaryComponentDto,
  UpdateSalaryComponentDto,
} from './salary-component.dto';
const a = new Types.ObjectId(),
  b = new Types.ObjectId();
const dto = (): CreateSalaryComponentDto => ({
  name: 'Formula component',
  code: 'FORMULA',
  category: 'deduction',
  calculationBaseType: 'annual_ctc',
  calculationType: 'formula',
  formula: 'annualCtc * 0.10',
  showInPayslip: true,
  status: 'active',
});
function setup(records: any[] = []) {
  const db = {
    find: () => ({
      lean: () => ({ exec: async () => records }),
      sort: () => ({ exec: async () => records }),
    }),
    findById: (id: string) => ({
      exec: async () => {
        const record = records.find((c) => c._id.toString() === id);
        return record
          ? {
              ...record,
              toObject: () => ({ ...record }),
              set: (value: any) => Object.assign(record, value),
              save: async () => record,
            }
          : null;
      },
    }),
    create: jest.fn(async (value: any) => {
      records.push(value);
      return value;
    }),
  };
  return { service: new SalaryComponentsService(db as never), db };
}
describe('Formula configuration persistence and mixed graph validation', () => {
  it('validates DTO and schema, saves/retrieves/edits a formula without a numeric calculation value', async () => {
    expect(
      await validate(plainToInstance(CreateSalaryComponentDto, dto())),
    ).toHaveLength(0);
    const Model = model('FormulaSchemaTest', SalaryComponentSchema);
    await expect(new Model(dto()).validate()).resolves.toBeUndefined();
    const { service } = setup();
    const saved = await service.create(dto());
    expect(saved).toMatchObject({
      formula: 'annualCtc * 0.10',
      calculationValue: null,
      fixedAmountPeriod: null,
    });
    expect(await service.findAll()).toContain(saved);
    expect(
      await service.update(saved._id.toString(), {
        formula: 'annualCtc / 20 + 1200',
      }),
    ).toMatchObject({ formula: 'annualCtc / 20 + 1200' });
    await expect(
      service.update(saved._id.toString(), {
        calculationType: 'fixed',
        calculationValue: 100,
        fixedAmountPeriod: 'annual',
      }),
    ).resolves.toMatchObject({ formula: null, calculationValue: 100 });
    await expect(
      service.update(saved._id.toString(), { calculationType: 'formula' }),
    ).rejects.toThrow('Formula must');
    expect(
      await validate(plainToInstance(UpdateSalaryComponentDto, { formula: 3 })),
    ).not.toHaveLength(0);
  });
  it.each([
    '1 / 0',
    'annualGrossWages * annualCoreWages',
    'annualCtc / annualGrossWages',
    'unknown + 1',
    'Math.random()',
    '1 +',
    'component_000000000000000000000001',
  ])('rejects invalid definitions before writing: %s', async (formula) => {
    const { service, db } = setup();
    await expect(service.create({ ...dto(), formula })).rejects.toThrow();
    expect(db.create).not.toHaveBeenCalled();
  });
  it('validates custom ID references, mixed cycles, inactive references and deactivation of dependencies', async () => {
    const records = [
      { ...dto(), _id: a },
      {
        ...dto(),
        _id: b,
        code: 'SECOND',
        formula: 'component_' + a.toString() + ' / 2',
      },
    ];
    const { service } = setup(records);
    await expect(
      service.update(a.toString(), { formula: 'component_' + b.toString() }),
    ).rejects.toThrow('Circular');
    await expect(
      service.update(a.toString(), { status: 'inactive' }),
    ).rejects.toThrow('active bases');
    await expect(
      service.update(a.toString(), {
        calculationType: 'percentage',
        calculationValue: 10,
        calculationBaseType: 'salary_component',
        calculationBaseComponentId: b.toString(),
      }),
    ).rejects.toThrow('Circular');
    const inactive = setup([{ ...dto(), _id: a, status: 'inactive' }]);
    await expect(
      inactive.service.create({
        ...dto(),
        formula: 'component_' + a.toString(),
      }),
    ).rejects.toThrow('active bases');
  });
  it('validates and round-trips formula configuration through the existing HTTP routes', async () => {
    const { service } = setup();
    jest.spyOn(service, 'onModuleInit').mockResolvedValue(undefined);
    const module = await Test.createTestingModule({
      controllers: [SalaryComponentsController],
      providers: [{ provide: SalaryComponentsService, useValue: service }],
    }).compile();
    const app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    try {
      const first = await request(app.getHttpServer())
        .post('/salary-components')
        .send(dto())
        .expect(201);
      expect(first.body.formula).toBe('annualCtc * 0.10');
      const updated = await request(app.getHttpServer())
        .patch('/salary-components/' + first.body._id)
        .send({ formula: 'annualCtc / 20' })
        .expect(200);
      expect(updated.body.formula).toBe('annualCtc / 20');
      expect(
        (
          await request(app.getHttpServer())
            .get('/salary-components')
            .expect(200)
        ).body[0].formula,
      ).toBe('annualCtc / 20');
      for (const formula of [
        'process.env.SECRET',
        '1/0',
        'annualGrossWages * annualGrossWages',
      ])
        await request(app.getHttpServer())
          .patch('/salary-components/' + first.body._id)
          .send({ formula })
          .expect(400);
      expect((await service.findAll())[0].formula).toBe('annualCtc / 20');
    } finally {
      await app.close();
    }
  });
  it('saves and edits the requested readable MIN formula without rewriting its definition', async () => {
    const { service } = setup();
    const formula = 'MIN(Annual Core Wages, Annual EPF Ceiling Limit) * 12%';
    const saved = await service.create({ ...dto(), formula });
    expect(saved.formula).toBe(formula);
    expect((await service.findAll())[0].formula).toBe(formula);
    expect(
      (
        await service.update(saved._id.toString(), {
          formula: formula.replace('12%', '10%'),
        })
      ).formula,
    ).toBe(formula.replace('12%', '10%'));
  });
  it('serves centralized metadata, active custom IDs and saved-setting availability', async () => {
    const records = [
      { ...dto(), _id: a },
      { ...dto(), _id: b, code: 'INACTIVE', status: 'inactive' },
    ];
    const { db } = setup(records);
    const service = new SalaryComponentsService(
      db as never,
      {
        get: async () => ({
          wageCap: 180000,
          esiEmployeeContributionPercentage: 0.75,
        }),
      } as never,
    );
    const variables = await service.formulaVariables();
    expect(variables).toContainEqual(
      expect.objectContaining({
        id: 'annualEpfCeilingLimit',
        valueType: 'amount',
        available: true,
      }),
    );
    expect(variables).toContainEqual(
      expect.objectContaining({
        id: 'esiEmployeeContributionRate',
        valueType: 'rate',
        available: true,
      }),
    );
    expect(variables).toContainEqual(
      expect.objectContaining({
        id: 'annualEsiCeilingLimit',
        available: false,
      }),
    );
    expect(variables).toContainEqual(
      expect.objectContaining({
        id: 'component_' + a.toString(),
        dependencies: ['annualCtc'],
      }),
    );
    expect(variables.some((v) => v.id === 'component_' + b.toString())).toBe(
      false,
    );
  });
  it('creates, retrieves and edits IF definitions and rejects bad conditions before persistence', async () => {
    const { service, db } = setup();
    const saved = await service.create({
      ...dto(),
      formula: 'IF(Annual CTC <= 100000, annualCtc * 1%, 0)',
    });
    expect((await service.findAll())[0].formula).toBe(saved.formula);
    expect(
      (
        await service.update(saved._id.toString(), {
          formula: 'IF(Annual CTC > 100000, annualCtc * 2%, 0)',
        })
      ).formula,
    ).toContain('2%');
    for (const formula of [
      'IF(1,2,0)',
      'IF(annualCtc == 0,1,0)',
      'IF(annualCtc>0,,0)',
    ])
      await expect(service.create({ ...dto(), formula })).rejects.toThrow();
    expect(db.create).toHaveBeenCalledTimes(1);
  });
  it('preserves mandatory components as percentage earnings', async () => {
    const { service } = setup([
      {
        ...dto(),
        _id: a,
        code: 'BASIC',
        name: 'Basic Salary',
        category: 'earning',
        calculationType: 'percentage',
        calculationValue: 40,
      },
    ]);
    await expect(
      service.update(a.toString(), {
        calculationType: 'formula',
        formula: '1',
      }),
    ).rejects.toThrow('Mandatory');
  });
});
