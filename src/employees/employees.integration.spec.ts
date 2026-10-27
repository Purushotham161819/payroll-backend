import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../app.module';

// Read-only integration test: never inserts, updates, or deletes records.
const integration = process.env.RUN_MONGO_TESTS === '1' ? describe : describe.skip;

integration('Employees MongoDB reads', () => {
  let app: INestApplication;

  async function start() {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    await app.init();
  }

  beforeAll(start, 30000);
  afterAll(async () => { await app?.close(); });

  it('returns database records and preserves them across an application restart', async () => {
    const connection = app.get<Connection>(getConnectionToken());
    const documents = await connection.collection('employees').find().toArray();
    const response = await request(app.getHttpServer()).get('/employees').expect(200);
    expect(response.body).toEqual(JSON.parse(JSON.stringify(documents)));
    if (documents.length === 0) expect(response.body).toEqual([]);
    await request(app.getHttpServer()).get('/employees/000000000000000000000000').expect(404);
    await request(app.getHttpServer()).patch('/employees/000000000000000000000000').send({}).expect(404);
    await request(app.getHttpServer()).delete('/employees/000000000000000000000000').expect(404);
    await app.close();
    await start();
    const restarted = await request(app.getHttpServer()).get('/employees').expect(200);
    expect(restarted.body).toEqual(response.body);
    console.info(`Read-only persistence check: ${documents.length} existing employee records.`);
  }, 30000);
});
