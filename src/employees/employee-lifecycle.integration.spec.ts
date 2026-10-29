import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { EmployeesModule } from './employees.module';

const integration =
  process.env.RUN_MONGO_TESTS === '1' ? describe : describe.skip;
integration('Employee lifecycle HTTP and MongoDB (isolated database)', () => {
  let app: INestApplication;
  let connection: Connection;
  const dbName = `payroll_lifecycle_test_${process.pid}_${Date.now()}`;
  const original = {
    firstName: 'Lifecycle',
    lastName: 'Example',
    email: 'lifecycle@example.com',
    dateOfBirth: '1990-01-01',
    hireDate: '2020-01-01',
    annualCtc: 120000,
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot('mongodb://127.0.0.1:27017', {
          dbName,
          serverSelectionTimeoutMS: 3000,
        }),
        EmployeesModule,
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    connection = app.get(getConnectionToken());
  }, 30000);
  afterAll(async () => {
    if (!app) return;
    if (
      connection?.name === dbName &&
      /^payroll_lifecycle_test_\d+_\d+$/.test(dbName)
    )
      await connection.dropDatabase();
    await app.close();
  });
  it('persists multiple periods atomically, preserves payroll records, protects original hire date and supports existing edits', async () => {
    const api = request(app.getHttpServer());
    const employee = (await api.post('/employees').send(original).expect(201))
      .body;
    expect(employee.status).toBe('Active');
    const payroll = {
      employeeId: employee._id,
      month: '2020-02',
      amount: 10000,
      snapshot: original,
    };
    await connection.collection('payroll_history').insertOne(payroll);
    const payrollBefore = await connection
      .collection('payroll_history')
      .find()
      .toArray();
    const url = `/employees/${employee._id}`;
    const results = await Promise.all(
      [1, 2].map(() =>
        api
          .patch(url + '/terminate')
          .send({ terminationDate: '2020-03-01', reason: 'Retirement' }),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    await api.patch(url).send({ hireDate: '2019-01-01' }).expect(409);
    await api
      .patch(url)
      .send({ hireDate: original.hireDate, firstName: 'Updated' })
      .expect(200);
    await api
      .patch(url + '/rehire')
      .send({ rehireDate: '2020-03-01' })
      .expect(400);
    const rehired = (
      await api
        .patch(url + '/rehire')
        .send({ rehireDate: '2020-04-01' })
        .expect(200)
    ).body;
    expect(rehired).toMatchObject({
      status: 'Active',
      employeeId: employee.employeeId,
      hireDate: employee.hireDate,
      annualCtc: original.annualCtc,
      rehireDate: '2020-04-01T00:00:00.000Z',
    });
    await api
      .patch(url + '/rehire')
      .send({ rehireDate: '2020-04-02' })
      .expect(409);
    await api
      .patch(url + '/terminate')
      .send({
        terminationDate: '2020-05-01',
        reason: 'Other',
        explanation: 'End of assignment',
      })
      .expect(200);
    await api
      .patch(url + '/rehire')
      .send({ rehireDate: '2020-06-01' })
      .expect(200);
    const stored = await connection
      .collection('employees')
      .findOne({ _id: new Types.ObjectId(employee._id) });
    expect(stored!.employmentHistory).toHaveLength(3);
    expect(stored!.employmentHistory[0].terminationReason).toBe('Retirement');
    expect(stored!.employmentHistory[1].explanation).toBe('End of assignment');
    expect(stored!.status).toBe('Active');
    expect(await connection.collection('employees').countDocuments()).toBe(1);
    expect(
      await connection.collection('payroll_history').find().toArray(),
    ).toEqual(payrollBefore);
    const read = (await api.get('/employees').expect(200)).body;
    expect(read[0].employmentHistory).toHaveLength(3);
  });
  it('handles legacy records without writes on read and rejects invalid payloads and IDs', async () => {
    const api = request(app.getHttpServer());
    const legacy = {
      ...original,
      email: 'legacy@example.com',
      hireDate: new Date('2020-01-01'),
      dateOfBirth: new Date('1990-01-01'),
    };
    const { insertedId } = await connection
      .collection('employees')
      .insertOne(legacy);
    const url = `/employees/${insertedId}`;
    const response = (await api.get('/employees').expect(200)).body;
    expect(
      response.find(
        (employee: any) => employee._id === insertedId.toHexString(),
      ).status,
    ).toBe('Active');
    expect(
      (await connection.collection('employees').findOne({ _id: insertedId }))!
        .status,
    ).toBeUndefined();
    for (const body of [
      {},
      { terminationDate: '2020-02-30', reason: 'Other' },
      { terminationDate: '2999-01-01', reason: 'Retirement' },
      { terminationDate: '2020-03-01', reason: 'Invalid' },
      { terminationDate: '2020-03-01', reason: 'Other', status: 'Active' },
    ]) {
      await api
        .patch(url + '/terminate')
        .send(body)
        .expect(400);
    }
    await api
      .patch('/employees/bad/terminate')
      .send({ terminationDate: '2020-03-01', reason: 'Retirement' })
      .expect(400);
    await api
      .patch('/employees/000000000000000000000000/terminate')
      .send({ terminationDate: '2020-03-01', reason: 'Retirement' })
      .expect(404);
    await api
      .patch(url + '/terminate')
      .send({ terminationDate: '2020-03-01', reason: 'Voluntary Resignation' })
      .expect(200);
    const updated = await connection
      .collection('employees')
      .findOne({ _id: insertedId });
    expect(updated!.status).toBe('Terminated');
    expect(updated!.employmentHistory[0].startDate).toEqual(legacy.hireDate);
    await api.delete(url).expect(200);
  });
});
