import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Types } from 'mongoose';
import { SalaryComponentsController } from './salary-components.controller';
import { SalaryComponentsService } from './salary-components.service';
const id = '507f1f77bcf86cd799439011',
  other = '507f1f77bcf86cd799439012';
const record = (key = id, extra: any = {}) => ({
  _id: new Types.ObjectId(key),
  name: 'Optional',
  code: 'OPTIONAL',
  category: 'earning',
  calculationType: 'percentage',
  calculationValue: 10,
  calculationBaseType: 'annual_ctc',
  status: 'active',
  showInPayslip: true,
  isSystemDefined: false,
  ...extra,
});
describe('Salary component DELETE protections', () => {
  let app: INestApplication, records: any[], service: SalaryComponentsService;
  const remove = jest.fn((key: string) => ({
    exec: async () => {
      const index = records.findIndex((r) => r._id.toString() === key);
      return index < 0 ? null : records.splice(index, 1)[0];
    },
  }));
  const create = jest.fn(async (value: any) => {
    records.push(value);
    return value;
  });
  beforeAll(async () => {
    service = new SalaryComponentsService({
      findById: (key: string) => ({
        exec: async () =>
          records.find((r) => r._id.toString() === key.toLowerCase()) ?? null,
      }),
      find: () => ({
        lean: () => ({ exec: async () => records }),
        sort: () => ({ exec: async () => records }),
      }),
      findByIdAndDelete: remove,
      create,
    } as never);
    jest.spyOn(service, 'onModuleInit').mockResolvedValue(undefined);
    const module = await Test.createTestingModule({
      controllers: [SalaryComponentsController],
      providers: [{ provide: SalaryComponentsService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  beforeEach(() => {
    records = [record(), record(other, { name: 'Keep', code: 'KEEP' })];
    remove.mockClear();
    create.mockClear();
  });
  afterAll(async () => {
    await app.close();
  });
  it('deletes an optional unreferenced component only and refreshes the existing list API', async () => {
    const result = await request(app.getHttpServer())
      .delete('/salary-components/' + id)
      .expect(200);
    expect(result.body).toEqual({
      message: 'Salary component deleted successfully.',
      deletedId: id,
    });
    expect(
      (
        await request(app.getHttpServer()).get('/salary-components').expect(200)
      ).body.map((r: any) => r.code),
    ).toEqual(['KEEP']);
    await request(app.getHttpServer())
      .delete('/salary-components/' + id)
      .expect(404);
  });
  it.each(['BASIC', 'DA', 'RA'])(
    'protects mandatory code %s independently of display name or flag',
    async (code) => {
      records[0] = {
        ...records[0],
        code,
        name: 'Manipulated display name',
        isSystemDefined: false,
      };
      const result = await request(app.getHttpServer())
        .delete('/salary-components/' + id)
        .send({ isSystemDefined: false, code: 'OPTIONAL' })
        .expect(409);
      expect(result.body.message).toContain('Mandatory');
      expect(remove).not.toHaveBeenCalled();
    },
  );
  it('protects a system-defined component even without a mandatory code', async () => {
    records[0].isSystemDefined = true;
    await request(app.getHttpServer())
      .delete('/salary-components/' + id)
      .expect(409);
    expect(remove).not.toHaveBeenCalled();
  });
  it.each(['active', 'inactive'])(
    'blocks %s calculation-base dependencies',
    async (status) => {
      records[1] = {
        ...records[1],
        calculationBaseType: 'salary_component',
        calculationBaseComponentId: new Types.ObjectId(id),
        status,
      };
      const result = await request(app.getHttpServer())
        .delete('/salary-components/' + id)
        .expect(409);
      expect(result.body.message).toContain('Keep (KEEP)');
      expect(remove).not.toHaveBeenCalled();
    },
  );
  it.each([
    'component_' + id + ' * 12%',
    'IF(annualCtc > 0, 0, component_' + id + ')',
    'MIN(COMPONENT_' + id.toUpperCase() + ', annualBasicSalary)',
  ])('blocks stable references inside formulas: %s', async (formula) => {
    records[1] = {
      ...records[1],
      calculationType: 'formula',
      formula,
      status: 'inactive',
    };
    const result = await request(app.getHttpServer())
      .delete('/salary-components/' + id.toUpperCase())
      .expect(409);
    expect(result.body.message).toContain('Keep (KEEP)');
    expect(remove).not.toHaveBeenCalled();
  });
  it('does not mistake component display-name text for a dependency', async () => {
    records[1] = {
      ...records[1],
      name: 'Optional',
      calculationType: 'formula',
      formula: 'annualCtc * 1%',
    };
    await request(app.getHttpServer())
      .delete('/salary-components/' + id)
      .expect(200);
    expect(records[0].code).toBe('KEEP');
  });
  it('fails closed when a saved formula cannot be parsed', async () => {
    records[1] = {
      ...records[1],
      calculationType: 'formula',
      formula: 'unknown + 1',
    };
    const result = await request(app.getHttpServer())
      .delete('/salary-components/' + id)
      .expect(409);
    expect(result.body.message).toContain('repair the invalid formula');
    expect(remove).not.toHaveBeenCalled();
  });
  it('returns 400/404 for invalid/missing IDs', async () => {
    await request(app.getHttpServer())
      .delete('/salary-components/invalid')
      .expect(400);
    expect(remove).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .delete('/salary-components/507f1f77bcf86cd799439099')
      .expect(404);
    expect(remove).not.toHaveBeenCalled();
  });
  it('serializes creation and deletion on the existing graph-write queue', async () => {
    const creation = service.create({
      name: 'Dependent',
      code: 'DEPENDENT',
      category: 'deduction',
      calculationBaseType: 'annual_ctc',
      calculationType: 'formula',
      formula: 'component_' + id,
      showInPayslip: true,
      status: 'active',
    });
    const deletion = service.remove(id);
    await creation;
    await expect(deletion).rejects.toThrow('Dependent (DEPENDENT)');
    expect(remove).not.toHaveBeenCalled();
  });
  it('sanitizes database failures and leaves the queue usable for a retry', async () => {
    remove.mockImplementationOnce(() => ({
      exec: async () => {
        throw new Error('private database credentials');
      },
    }));
    const result = await request(app.getHttpServer())
      .delete('/salary-components/' + id)
      .expect(503);
    expect(result.body.message).toContain('Unable to delete');
    expect(records).toHaveLength(2);
    await request(app.getHttpServer())
      .delete('/salary-components/' + id)
      .expect(200);
  });
});
