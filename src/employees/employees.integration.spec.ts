import { EmployeeIdentifierService } from './employee-identifier.service';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import session from 'express-session';
import { randomBytes } from 'node:crypto';
import { configureSecurity } from '../auth/http-security';

// Read-only integration test: never inserts, updates, or deletes records.
const integration =
  process.env.RUN_MONGO_TESTS === '1' ? describe : describe.skip;

integration('Employees MongoDB reads', () => {
  let app: INestApplication;
  let api: ReturnType<typeof request.agent>;

  async function start() {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EmployeeIdentifierService)
      .useValue({
        onModuleInit: async () => {},
        nextId: async () => {
          throw new Error('Read-only test must not create employees.');
        },
      })
      .compile();
    const expressApp = module.createNestApplication<NestExpressApplication>();
    app = expressApp;
    process.env.SESSION_SECRET ??= randomBytes(48).toString('hex');
    configureSecurity(expressApp, new session.MemoryStore());
    await app.init();
    if (!process.env.TEST_AUTH_EMAIL || !process.env.TEST_AUTH_PASSWORD) throw new Error('Read-only integration tests require an existing account via TEST_AUTH_EMAIL and TEST_AUTH_PASSWORD');
    api = request.agent(app.getHttpServer()).set({ Origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:4200', 'X-Payroll-Request': '1' });
    await api.post('/auth/login').send({ email: process.env.TEST_AUTH_EMAIL, password: process.env.TEST_AUTH_PASSWORD }).expect(200);
  }

  beforeAll(start, 30000);
  afterAll(async () => {
    await app?.close();
  });

  it('returns database records and preserves them across an application restart', async () => {
    const connection = app.get<Connection>(getConnectionToken());
    const documents = await connection.collection('employees').find().toArray();
    const response = await api
      .get('/employees')
      .expect(200);
    expect(response.body).toEqual(
      JSON.parse(
        JSON.stringify(
          documents.map((employee) => ({
            ...employee,
            payFrequency: employee.payFrequency ?? 'Monthly',
            status: employee.status ?? 'Active',
            lifecycleVersion: employee.lifecycleVersion ?? 0,
          })),
        ),
      ),
    );
    if (documents.length === 0) expect(response.body).toEqual([]);
    await api
      .get('/employees/000000000000000000000000')
      .expect(404);
    await api
      .patch('/employees/000000000000000000000000')
      .send({})
      .expect(404);
    await api
      .delete('/employees/000000000000000000000000')
      .expect(404);
    await app.close();
    await start();
    const restarted = await api
      .get('/employees')
      .expect(200);
    expect(restarted.body).toEqual(response.body);
    console.info(
      `Read-only persistence check: ${documents.length} existing employee records.`,
    );
  }, 30000);
});
