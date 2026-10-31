import { Test } from '@nestjs/testing';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { IncomeTaxModule } from '../income-tax/income-tax.module';

const integration =
  process.env.RUN_TAX_MONGO_TESTS === '1' ? describe : describe.skip;
const sample = {
  name: 'Financial Year 2026-27',
  code: 'FY 2026-27',
  startDate: '2026-04-01',
  endDate: '2027-03-31',
  legislation: 'Income-tax Act, 2025',
  ruleVersion: 'ITACT2025_FA2026_V1.0',
};
integration('Financial Year save API regression (isolated MongoDB)', () => {
  let app: INestApplication, connection: Connection;
  const dbName = `tax_year_save_test_${process.pid}_${Date.now()}`;
  const endpoint = '/settings/tax-configuration/years';
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot('mongodb://127.0.0.1:27017', {
          dbName,
          serverSelectionTimeoutMS: 3000,
        }),
        IncomeTaxModule,
      ],
    }).compile();
    app = module.createNestApplication();
    // Isolated controller fixture; production session/CSRF guards are unchanged.
    app.use((req: any, _res: any, next: () => void) => {
      req.account = {
        id: 'test-admin',
        role: req.headers['x-test-role'] ?? 'admin',
      };
      next();
    });
    await app.init();
    connection = app.get(getConnectionToken());
  });
  beforeEach(async () => {
    await connection.collection('tax_configuration_registry').deleteMany({});
  });
  afterAll(async () => {
    if (connection?.name === dbName && dbName.startsWith('tax_year_save_test_'))
      await connection.dropDatabase();
    await app?.close();
  });
  it('persists the exact reported year and returns it in the list', async () => {
    const saved = await request(app.getHttpServer())
      .put(endpoint)
      .send({ version: 0, createOnly: true, year: sample })
      .expect(200);
    expect(saved.body.years).toEqual([expect.objectContaining(sample)]);
    const listed = await request(app.getHttpServer())
      .get('/settings/tax-configuration')
      .expect(200);
    expect(listed.body.years[0].code).toBe('FY 2026-27');
  });
  it.each([
    'name',
    'code',
    'startDate',
    'endDate',
    'legislation',
    'ruleVersion',
  ])('rejects a missing %s field', async (field) => {
    await request(app.getHttpServer())
      .put(endpoint)
      .send({ version: 0, createOnly: true, year: { ...sample, [field]: '' } })
      .expect(400);
    expect(
      (await request(app.getHttpServer()).get('/settings/tax-configuration'))
        .body.years,
    ).toEqual([]);
  });
  it.each([
    { startDate: '2027-04-01', endDate: '2026-03-31' },
    { startDate: '2026-04-31' },
    { startDate: '01-04-2026' },
    { endDate: '2027-03-30' },
    { code: 'FY/2026-27' },
    { code: '   ' },
    { name: '   ' },
    { legislation: '   ' },
    { ruleVersion: '   ' },
  ])('rejects invalid year fields: %j', async (fields) => {
    await request(app.getHttpServer())
      .put(endpoint)
      .send({ version: 0, createOnly: true, year: { ...sample, ...fields } })
      .expect(400);
  });
  it('rejects duplicate creation without overwriting the existing year', async () => {
    await request(app.getHttpServer())
      .put(endpoint)
      .send({ version: 0, createOnly: true, year: sample })
      .expect(200);
    const response = await request(app.getHttpServer())
      .put(endpoint)
      .send({
        version: 1,
        createOnly: true,
        year: { ...sample, name: 'Accidental duplicate' },
      })
      .expect(409);
    expect(response.body.message).toContain('already exists');
    const listed = await request(app.getHttpServer())
      .get('/settings/tax-configuration')
      .expect(200);
    expect(listed.body.years).toHaveLength(1);
    expect(listed.body.years[0].name).toBe(sample.name);
  });
  it('rejects overlaps and stale versions', async () => {
    await request(app.getHttpServer())
      .put(endpoint)
      .send({ version: 0, createOnly: true, year: sample })
      .expect(200);
    const overlap = await request(app.getHttpServer())
      .put(endpoint)
      .send({
        version: 1,
        createOnly: true,
        year: { ...sample, code: 'FY_OVERLAP' },
      })
      .expect(400);
    expect(overlap.body.message).toContain('overlap');
    await request(app.getHttpServer())
      .put(endpoint)
      .send({
        version: 0,
        createOnly: true,
        year: { ...sample, code: 'FY_STALE' },
      })
      .expect(409);
  });
  it('preserves the existing PUT editing contract and audit metadata', async () => {
    const saved = await request(app.getHttpServer())
      .put(endpoint)
      .send({ version: 0, createOnly: true, year: sample })
      .expect(200);
    const edited = await request(app.getHttpServer())
      .put(endpoint)
      .send({ version: 1, year: { ...sample, name: 'Reviewed year' } })
      .expect(200);
    expect(edited.body.years[0].name).toBe('Reviewed year');
    expect(edited.body.years[0].createdAt).toBe(saved.body.years[0].createdAt);
    expect(edited.body.years[0].createdBy).toBe('test-admin');
    expect(edited.body.audit).toHaveLength(2);
  });
  it('trims surrounding whitespace and retains legacy code formats', async () => {
    const saved = await request(app.getHttpServer())
      .put(endpoint)
      .send({
        version: 0,
        createOnly: true,
        year: {
          ...sample,
          code: '  FY_2026-27  ',
          name: '  Financial Year 2026-27  ',
        },
      })
      .expect(200);
    expect(saved.body.years[0].code).toBe('FY_2026-27');
    expect(saved.body.years[0].name).toBe(sample.name);
  });
  it('allows one winner under duplicate concurrent creation', async () => {
    const responses = await Promise.all(
      [1, 2].map(() =>
        request(app.getHttpServer())
          .put(endpoint)
          .send({ version: 0, createOnly: true, year: sample }),
      ),
    );
    expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([200, 409]);
  });
  it('preserves administrator authorization', async () => {
    await request(app.getHttpServer())
      .put(endpoint)
      .set('X-Test-Role', 'user')
      .send({ version: 0, createOnly: true, year: sample })
      .expect(403);
  });
});
