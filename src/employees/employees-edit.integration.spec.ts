import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { EmployeesModule } from './employees.module';

const integration =
  process.env.RUN_MONGO_TESTS === '1' ? describe : describe.skip;
integration('Employee edits and pay frequency (isolated database)', () => {
  let app: INestApplication;
  const dbName = `payroll_employee_edit_test_${process.pid}_${Date.now()}`;
  const original = {
    firstName: 'Edit',
    lastName: 'Example',
    email: 'edit@example.com',
    dateOfBirth: '1990-01-01',
    hireDate: '2026-01-01',
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
  }, 30000);
  afterAll(async () => {
    if (!app) return;
    const connection = app.get<Connection>(getConnectionToken());
    if (
      connection.name === dbName &&
      dbName.startsWith('payroll_employee_edit_test_')
    )
      await connection.dropDatabase();
    await app.close();
  });
  it('defaults new and legacy employees to Monthly, persists partial edits and preserves omitted fields', async () => {
    const api = request(app.getHttpServer());
    const created = (await api.post('/employees').send(original).expect(201))
      .body;
    expect(created.payFrequency).toBe('Monthly');
    const updated = (
      await api
        .patch(`/employees/${created._id}`)
        .send({ firstName: 'Updated', payFrequency: 'Monthly' })
        .expect(200)
    ).body;
    expect(updated).toMatchObject({
      ...created,
      firstName: 'Updated',
      updatedAt: expect.any(String),
    });
    await api
      .patch(`/employees/${created._id}`)
      .send({ email: '  NEW@Example.com  ' })
      .expect(200);
    const collection = app
      .get<Connection>(getConnectionToken())
      .collection('employees');
    await collection.updateOne(
      { _id: new Types.ObjectId(created._id) },
      { $unset: { payFrequency: '' } },
    );
    const before = await collection.findOne({
      _id: new Types.ObjectId(created._id),
    });
    expect(before?.payFrequency).toBeUndefined();
    const records = (await api.get('/employees').expect(200)).body;
    expect(records[0]).toMatchObject({
      firstName: 'Updated',
      email: 'new@example.com',
      payFrequency: 'Monthly',
      annualCtc: original.annualCtc,
    });
    expect(
      (await collection.findOne({ _id: new Types.ObjectId(created._id) }))
        ?.payFrequency,
    ).toBeUndefined();
    await api
      .patch(`/employees/${created._id}`)
      .send({ annualCtc: 240000 })
      .expect(200);
    expect((await api.get('/employees')).body[0]).toMatchObject({
      annualCtc: 240000,
      payFrequency: 'Monthly',
      firstName: 'Updated',
    });
  });
  it('rejects unsupported frequency, null fields, unknown fields, bad IDs and missing employees', async () => {
    const api = request(app.getHttpServer());
    const created = (
      await api
        .post('/employees')
        .send({ ...original, email: 'other@example.com' })
        .expect(201)
    ).body;
    await api
      .post('/employees')
      .send({ ...original, email: 'duplicate@example.com' })
      .expect(201);
    for (const payFrequency of ['Semi-Monthly', 'Annual', '', null]) {
      await api
        .patch(`/employees/${created._id}`)
        .send({ payFrequency })
        .expect(400);
      await api
        .post('/employees')
        .send({ ...original, payFrequency })
        .expect(400);
    }
    for (const changes of [
      { firstName: null },
      { annualCtc: -1 },
      { email: 'bad' },
      { _id: created._id },
    ])
      await api.patch(`/employees/${created._id}`).send(changes).expect(400);
    await api.patch('/employees/not-an-id').send({ annualCtc: 1 }).expect(400);
    await api
      .patch(`/employees/${new Types.ObjectId().toHexString()}`)
      .send({ annualCtc: 1 })
      .expect(404);
    await api
      .patch(`/employees/${created._id}`)
      .send({ email: 'duplicate@example.com' })
      .expect(409);
    await api.patch(`/employees/${created._id}`).send({}).expect(200);
  });
});
