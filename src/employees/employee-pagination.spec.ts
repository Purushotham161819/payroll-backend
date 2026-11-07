import { employeePageQuery } from './employee-page-query';
import { EmployeesService } from './employees.service';
import { EmployeesController } from './employees.controller';
import { BusinessModelsModule } from '../organizations/business-models.module';
import { Employee, EmployeeSchema } from './schemas/employee.schema';
import { tenantContext } from '../organizations/tenant-context';
import { createConnection } from 'mongoose';
import { workforceFilter } from '../reports/reports.service';
describe('Employee server pagination', () => {
  it('keeps the legacy unpaged API and selects the optional paged contract', () => {
    const service = {
      findAll: jest.fn().mockReturnValue([]),
      findPage: jest.fn().mockReturnValue({ items: [] }),
    };
    const controller = new EmployeesController(service as any);
    expect(controller.findAll()).toEqual([]);
    controller.findAll({ page: '1', pageSize: '10' });
    expect(service.findPage).toHaveBeenCalledWith({
      page: '1',
      pageSize: '10',
    });
  });
  it('normalizes search, escapes literals and retains legacy active status semantics', () => {
    const { filter } = employeePageQuery({
      page: '1',
      pageSize: '10',
      status: 'Active',
      search: '  Ada.*   Lovelace  ',
    });
    const clauses = (filter as any).$and;
    expect(clauses[0]).toEqual({
      $or: [{ status: 'Active' }, { status: null }],
    });
    expect(clauses[1].$or[0].employeeId).toEqual({
      $regex: 'Ada\\.\\* Lovelace',
      $options: 'i',
    });
    expect(clauses[1].$or[3].$expr.$regexMatch.input.$concat).toEqual([
      { $ifNull: ['$firstName', ''] },
      ' ',
      { $ifNull: ['$lastName', ''] },
    ]);
    expect(employeePageQuery({ status: 'All' }).filter).toEqual({});
    expect(employeePageQuery({ status: 'Terminated' }).filter).toEqual({
      $and: [{ status: 'Terminated' }],
    });
  });
  for (const query of [
    { page: '0' },
    { pageSize: '500' },
    { page: '1.5' },
    { status: 'Inactive' },
  ])
    it('rejects invalid page/filter ' + JSON.stringify(query), () => {
      expect(() => employeePageQuery(query)).toThrow();
    });
  it('returns deterministic non-overlapping pages and filtered totals, and clamps a deleted last page', async () => {
    const records = Array.from({ length: 23 }, (_, i) => ({
      _id: String(i + 1),
    }));
    let offset = 0,
      size = 10;
    const query = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn((value: number) => {
        offset = value;
        return query;
      }),
      limit: jest.fn((value: number) => {
        size = value;
        return query;
      }),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn(async () => records.slice(offset, offset + size)),
    };
    const model = {
      countDocuments: jest.fn(() => ({ exec: async () => records.length })),
      find: jest.fn(() => query),
    };
    const service = new EmployeesService(model as any, null as any);
    const one = await service.findPage({
        page: '1',
        pageSize: '10',
        status: 'Terminated',
      }),
      two = await service.findPage({
        page: '2',
        pageSize: '10',
        status: 'Terminated',
      });
    expect(one.items).toHaveLength(10);
    expect(two.items).toHaveLength(10);
    expect(two.total).toBe(23);
    expect(one.items.some((e) => two.items.some((f) => f._id === e._id))).toBe(
      false,
    );
    expect(query.sort).toHaveBeenCalledWith({ _id: 1 });
    expect(model.countDocuments).toHaveBeenCalledWith({
      $and: [{ status: 'Terminated' }],
    });
    expect((await service.findPage({ page: '99', pageSize: '10' })).page).toBe(
      3,
    );
    records.length = 0;
    expect(await service.findPage({ page: '3', pageSize: '10' })).toMatchObject(
      { items: [], total: 0, page: 1 },
    );
  });
  it('uses the existing authenticated organization collection without accepting a caller-selected tenant', async () => {
    const connection = createConnection();
    const factory = (
      BusinessModelsModule.forFeature([
        { name: Employee.name, schema: EmployeeSchema },
      ]).providers as any[]
    )[0];
    const model = factory.useFactory(connection);
    const a = tenantContext.run(
        { organizationId: 'ORG000001' },
        () => model.collection.name,
      ),
      b = tenantContext.run(
        { organizationId: 'ORG000002' },
        () => model.collection.name,
      );
    expect(a).toMatch(/^org000001_/);
    expect(b).toMatch(/^org000002_/);
    expect(a).not.toBe(b);
    await connection.close();
  });
  it('workforce All is unrestricted while Active/Terminated filter and Inactive is no longer selectable', () => {
    expect(workforceFilter({ status: '' })).toEqual({});
    expect(workforceFilter({ status: 'Active' })).toEqual({
      $or: [{ status: 'Active' }, { status: null }],
    });
    expect(workforceFilter({ status: 'Terminated' })).toEqual({
      status: 'Terminated',
    });
    expect(() => workforceFilter({ status: 'Inactive' })).toThrow();
  });
});
