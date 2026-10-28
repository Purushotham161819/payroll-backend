import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { StatutoryDeductionsModule } from './statutory-deductions.module';

const integration =
  process.env.RUN_MONGO_TESTS === '1' ? describe : describe.skip;
integration('Statutory deductions persisted HTTP configuration', () => {
  let app: INestApplication;
  const dbName = `payroll_statutory_test_${process.pid}_${Date.now()}`;
  // Arithmetic fixtures only, not statutory recommendations.
  const config = {
    wageCap: 15000,
    epfEmployerContributionPercentage: 12,
    epsEmployerContributionPercentage: 8.33,
    epfEmployeeContributionPercentage: 12,
    esiEmployerContributionPercentage: 3.25,
    esiEmployeeContributionPercentage: 0.75,
  };
  const path = '/settings/statutory-deductions';
  async function start() {
    const module = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot('mongodb://127.0.0.1:27017', {
          dbName,
          serverSelectionTimeoutMS: 3000,
        }),
        StatutoryDeductionsModule,
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
  }
  beforeAll(start, 30000);
  afterAll(async () => {
    if (!app) return;
    const connection = app.get<Connection>(getConnectionToken());
    if (
      connection.name === dbName &&
      dbName.startsWith('payroll_statutory_test_')
    )
      await connection.dropDatabase();
    await app.close();
  });
  it('starts unconfigured, updates a singleton, validates input, and persists after restart', async () => {
    const api = () => request(app.getHttpServer());
    const initial = await api().get(path).expect(200);
    expect(initial.text === '' || initial.text === 'null').toBe(true);
    const first = await api().put(path).send(config).expect(200);
    expect(first.body).toMatchObject({ ...config, _id: 'current' });
    const changed = {
      ...config,
      wageCap: 17000.25,
      epfEmployeeContributionPercentage: 0,
    };
    const second = await api().put(path).send(changed).expect(200);
    expect(second.body.createdAt).toBe(first.body.createdAt);
    expect(new Date(second.body.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(first.body.updatedAt).getTime(),
    );
    for (const invalid of [
      { ...changed, wageCap: -1 },
      { ...changed, wageCap: 1.234 },
      { ...changed, wageCap: null },
      { ...changed, wageCap: 'abc' },
      { ...changed, esiEmployeeContributionPercentage: 101 },
      { ...changed, epsEmployerContributionPercentage: '12%' },
      { ...changed, esiEmployerContributionPercentage: null },
      { ...changed, epfEmployeeContributionPercentage: -1 },
      {},
    ]) {
      const response = await api().put(path).send(invalid).expect(400);
      expect(response.body.message.length).toBeGreaterThan(0);
    }
    expect((await api().get(path)).body).toMatchObject(changed);
    await Promise.all(
      Array.from({ length: 5 }, () =>
        api().put(path).send(changed).expect(200),
      ),
    );
    expect(
      await app
        .get<Connection>(getConnectionToken())
        .collection('statutory_deductions')
        .countDocuments(),
    ).toBe(1);
    const before = await api().get(path).expect(200);
    await app.close();
    await start();
    expect((await api().get(path).expect(200)).body).toEqual(before.body);
  }, 30000);
  it('preserves legacy EPF settings and independently creates, edits and retains the ESI ceiling', async () => {
    const api = request(app.getHttpServer());
    const legacy = (await api.get(path).expect(200)).body;
    expect(legacy.annualEsiCeilingLimit).toBeUndefined();
    const first = (await api.put(path).send({ ...config, wageCap: legacy.wageCap, annualEsiCeilingLimit: 250000.25 }).expect(200)).body;
    expect(first).toMatchObject({ wageCap: legacy.wageCap, annualEsiCeilingLimit: 250000.25 });
    expect(first._id).toBe(legacy._id);
    expect(first.createdAt).toBe(legacy.createdAt);
    await api.put(path).send({ ...config, wageCap: 180000.50 }).expect(200);
    expect((await api.get(path)).body).toMatchObject({ wageCap: 180000.50, annualEsiCeilingLimit: 250000.25 });
    await api.put(path).send({ ...config, wageCap: 180000.50, annualEsiCeilingLimit: 300000.75 }).expect(200);
    for (const value of [-1, 1.234, null, 'invalid'])
      await api.put(path).send({ ...config, annualEsiCeilingLimit: value }).expect(400);
    await app.close(); await start();
    expect((await request(app.getHttpServer()).get(path)).body).toMatchObject({ wageCap: 180000.50, annualEsiCeilingLimit: 300000.75 });
  });
});
