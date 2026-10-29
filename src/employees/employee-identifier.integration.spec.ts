import { createConnection, Connection, Model, Types } from 'mongoose';
import { Employee, EmployeeSchema } from './schemas/employee.schema';
import { EmployeeIdentifierService } from './employee-identifier.service';
import { EmployeesService } from './employees.service';
const integration =
  process.env.RUN_EMPLOYEE_ID_TESTS === '1' ? describe : describe.skip;
integration('Persistent employee IDs against isolated MongoDB', () => {
  let connection: Connection, model: Model<Employee>, database: string;
  beforeEach(async () => {
    database =
      'payroll_employee_ids_test_' +
      process.pid +
      '_' +
      Date.now() +
      '_' +
      Math.random().toString(16).slice(2);
    connection = await createConnection('mongodb://127.0.0.1:27017', {
      dbName: database,
      serverSelectionTimeoutMS: 5000,
    }).asPromise();
    model = connection.model(Employee.name, EmployeeSchema);
  }, 15000);
  afterEach(async () => {
    if (
      connection?.name === database &&
      database.startsWith('payroll_employee_ids_test_')
    )
      await connection.dropDatabase();
    await connection?.close();
  });
  const dto = (n: number) => ({
    firstName: 'Employee',
    lastName: String(n),
    email: 'employee' + n + '@example.com',
    dateOfBirth: '1990-01-01',
    hireDate: '2026-01-01',
    annualCtc: 107500,
  });
  it('assigns sorted legacy employees once, preserves existing IDs and every other stored field/timestamp', async () => {
    const originals = [
      {
        _id: new Types.ObjectId(),
        ...dto(1),
        createdAt: new Date('2020-01-01'),
        updatedAt: new Date('2020-02-01'),
      },
      {
        _id: new Types.ObjectId(),
        ...dto(2),
        employeeId: 'EMP009',
        createdAt: new Date('2021-01-01'),
        updatedAt: new Date('2021-02-01'),
      },
      {
        _id: new Types.ObjectId(),
        ...dto(3),
        employeeId: '',
        createdAt: new Date('2022-01-01'),
        updatedAt: new Date('2022-02-01'),
      },
    ];
    await model.collection.insertMany(originals as never);
    await new EmployeeIdentifierService(model).initialize();
    const first = await model.collection
      .find()
      .sort({ createdAt: 1 })
      .toArray();
    expect(first.map((e) => e.employeeId)).toEqual([
      'EMP010',
      'EMP009',
      'EMP011',
    ]);
    first.forEach((employee, i) => {
      const { employeeId, ...rest } = employee;
      const { employeeId: _old, ...original } = originals[i] as any;
      expect(rest).toEqual(original);
    });
    await new EmployeeIdentifierService(model).initialize();
    expect(
      await model.collection.find().sort({ createdAt: 1 }).toArray(),
    ).toEqual(first);
  });
  it('allocates unique sequential IDs across concurrent service instances and retains them after restart', async () => {
    const first = new EmployeeIdentifierService(model),
      second = new EmployeeIdentifierService(model);
    const a = new EmployeesService(model, first),
      b = new EmployeesService(model, second);
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) => (i % 2 ? a : b).create(dto(i))),
    );
    const ids = results.map((r) => r.employeeId!);
    expect(new Set(ids).size).toBe(40);
    expect(ids.sort()).toEqual(
      Array.from(
        { length: 40 },
        (_, i) => 'EMP' + String(i + 1).padStart(3, '0'),
      ),
    );
    const reopened = new EmployeeIdentifierService(model);
    await reopened.initialize();
    const service = new EmployeesService(model, reopened);
    const next = await service.create(dto(100));
    expect(next.employeeId).toBe('EMP041');
    const saved = await model.findById(results[0]._id).lean();
    expect(saved?.employeeId).toBe(results[0].employeeId);
    await service.update(results[0]._id.toString(), { annualCtc: 200000 });
    expect((await model.findById(results[0]._id).lean())?.employeeId).toBe(
      results[0].employeeId,
    );
    await service.remove(results[0]._id.toString());
    expect((await service.create(dto(101))).employeeId).toBe('EMP042');
  });
  it('uses a real unique index and expands padding past EMP999', async () => {
    await model.collection.insertOne({
      ...dto(1),
      employeeId: 'EMP999',
    } as never);
    const ids = new EmployeeIdentifierService(model);
    await ids.initialize();
    expect(await ids.nextId()).toBe('EMP1000');
    await expect(
      model.collection.insertOne({ ...dto(2), employeeId: 'EMP999' } as never),
    ).rejects.toMatchObject({ code: 11000 });
  });
  it.each([
    ['EMP001', 'EMP001'],
    ['bad', 'EMP002'],
  ])(
    'fails closed on duplicate or malformed existing IDs %p without reassigning data',
    async (left, right) => {
      await model.collection.insertMany([
        { ...dto(1), employeeId: left },
        { ...dto(2), employeeId: right },
      ] as never);
      const before = await model.collection.find().toArray();
      await expect(
        new EmployeeIdentifierService(model).initialize(),
      ).rejects.toThrow('migration blocked');
      expect(await model.collection.find().toArray()).toEqual(before);
    },
  );
});
