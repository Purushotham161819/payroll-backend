import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { EmployeesModule } from './employees.module';
import { EmployeesService } from './employees.service';
import { tenantContext } from '../organizations/tenant-context';

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
  it('persists optional profile fields independently, allows clearing, and preserves existing business data', async () => {
    const api = request(app.getHttpServer());
    const created = (
      await api
        .post('/employees')
        .send({ ...original, email: 'profile@example.test' })
        .expect(201)
    ).body;
    for (const key of [
      'designation',
      'addressLine1',
      'addressLine2',
      'city',
      'state',
      'zipCode',
      'country',
    ])
      expect(created[key]).toBeUndefined();
    const employment = (
      await api
        .patch('/employees/' + created._id)
        .send({ designation: '  Engineer  ' })
        .expect(200)
    ).body;
    expect(employment.designation).toBe('Engineer');
    const address = {
      addressLine1: '10 Test Street',
      addressLine2: '',
      city: 'Test City',
      state: 'Test State',
      zipCode: '00120',
      country: 'India',
    };
    const personal = (
      await api
        .patch('/employees/' + created._id)
        .send(address)
        .expect(200)
    ).body;
    expect(personal).toMatchObject({
      ...created,
      ...address,
      designation: 'Engineer',
      updatedAt: expect.any(String),
    });
    const changed = (
      await api
        .patch('/employees/' + created._id)
        .send({ designation: 'Senior Engineer' })
        .expect(200)
    ).body;
    expect(changed).toMatchObject({
      ...personal,
      designation: 'Senior Engineer',
      updatedAt: expect.any(String),
    });
    const reloaded = (await api.get('/employees').expect(200)).body.find(
      (employee: any) => employee._id === created._id,
    );
    expect(reloaded).toEqual(changed);
    await api
      .patch('/employees/' + created._id)
      .send({
        designation: '',
        ...Object.fromEntries(Object.keys(address).map((key) => [key, ''])),
      })
      .expect(200);
    for (const body of [
      { designation: null },
      { city: 123 },
      { zipCode: 'a'.repeat(33) },
      { addressLine1: 'a'.repeat(251) },
      { designation: 'bad\nvalue' },
      { employeeId: 'EMP999', designation: 'Forged' },
    ])
      await api
        .patch('/employees/' + created._id)
        .send(body)
        .expect(400);
    await api.delete('/employees/' + created._id).expect(200);
  });
  it('keeps profile writes scoped to the authenticated organization context', async () => {
    const service = app.get(EmployeesService);
    const inOrganization = <T>(organizationId: string, work: () => T) =>
      tenantContext.run({ organizationId }, work);
    const created = await inOrganization('ORG000071', () =>
      service.create({ ...original, email: 'tenant-profile@example.test' }),
    );
    await expect(
      inOrganization('ORG000072', () =>
        service.update(String(created._id), { designation: 'Foreign' }),
      ),
    ).rejects.toMatchObject({ status: 404 });
    const saved = await inOrganization('ORG000071', () =>
      service.update(String(created._id), {
        designation: 'Scoped',
        city: 'Own City',
      }),
    );
    expect(saved.designation).toBe('Scoped');
    expect(saved.city).toBe('Own City');
    expect(
      await inOrganization('ORG000072', () => service.findAll()),
    ).toHaveLength(0);
  });
  it('creates with or without a contact number and persists contact-only edits without changing other fields', async () => {
    const api = request(app.getHttpServer());
    const created = (
      await api
        .post('/employees')
        .send({
          ...original,
          email: 'contact@example.test',
          contactNumber: '+1 (212) 555-0100 ext. 123',
        })
        .expect(201)
    ).body;
    expect(created.contactNumber).toBe('+1 (212) 555-0100 ext. 123');
    const saved = (
      await api
        .patch('/employees/' + created._id)
        .send({ contactNumber: '+91 98765 43210' })
        .expect(200)
    ).body;
    expect(saved).toMatchObject({
      ...created,
      contactNumber: '+91 98765 43210',
      updatedAt: expect.any(String),
    });
    const reloaded = (await api.get('/employees').expect(200)).body.find(
      (employee: any) => employee._id === created._id,
    );
    expect(reloaded).toEqual(saved);
    await api
      .patch('/employees/' + created._id)
      .send({ contactNumber: '' })
      .expect(200);
    await api.delete('/employees/' + created._id).expect(200);
    const without = (
      await api
        .post('/employees')
        .send({ ...original, email: 'without-contact@example.test' })
        .expect(201)
    ).body;
    expect(without.contactNumber).toBeUndefined();
    await api.delete('/employees/' + without._id).expect(200);
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
