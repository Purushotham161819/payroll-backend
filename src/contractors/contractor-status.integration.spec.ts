import { Test } from '@nestjs/testing';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { APP_GUARD } from '@nestjs/core';
import { INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Connection } from 'mongoose';
import { MongoClient } from 'mongodb';
import { spawn, ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ContractorsModule } from './contractors.module';
import { ContractorsService } from './contractors.service';
import { AuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';

const suite = process.env.RUN_CONTRACTOR_MONGO_TESTS === '1' ? describe : describe.skip;
suite('Contractor status and transactional permanent deletion (isolated replica set)', () => {
  let app: INestApplication, db: Connection, service: ContractorsService, process: ChildProcess, admin: MongoClient;
  const org = 'ORG000901', other = 'ORG000902';
  const users: Record<string, any> = { admin: { id: 'admin', role: 'admin', organizationId: org }, member: { id: 'member', role: 'user', organizationId: org }, other: { id: 'other', role: 'admin', organizationId: other } };
  const api = (who = 'admin') => ({
    get: (path: string) => request(app.getHttpServer()).get('/contractors' + path).set('X-Test-User', who),
    post: (path: string, body: any) => request(app.getHttpServer()).post('/contractors' + path).set({ 'X-Test-User': who, Origin: 'http://localhost:4200', 'X-Payroll-Request': '1' }).send(body),
    patch: (path: string, body: any) => request(app.getHttpServer()).patch('/contractors' + path).set({ 'X-Test-User': who, Origin: 'http://localhost:4200', 'X-Payroll-Request': '1' }).send(body),
    remove: (id: string) => request(app.getHttpServer()).delete('/contractors/' + id).set({ 'X-Test-User': who, Origin: 'http://localhost:4200', 'X-Payroll-Request': '1' }),
  });
  const create = async (who = 'admin') => (await api(who).post('', { firstName: 'Status', lastName: 'Fixture', email: randomUUID() + '@example.test' }).expect(201)).body;
  const draft = (...rows: any[]) => ({ idempotencyKey: randomUUID(), paymentDate: '2026-11-03', entries: rows.map(c => ({ contractorId: c._id, contractorVersion: c.version, grossPay: 100, description: 'Invoice', components: [] })) });
  beforeAll(async () => {
    const server = createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as any).port; await new Promise<void>(resolve => server.close(() => resolve()));
    const directory = mkdtempSync(join(tmpdir(), 'paystream-contractor-replica-'));
    process = spawn(global.process.env.MONGOD_BINARY || 'C:/Program Files/MongoDB/Server/9.0/bin/mongod.exe', ['--dbpath', directory, '--port', String(port), '--bind_ip', '127.0.0.1', '--replSet', 'contractor_test', '--logpath', join(directory, 'mongo.log'), '--oplogSize', '16'], { windowsHide: true, stdio: 'ignore' });
    const uri = `mongodb://127.0.0.1:${port}`;
    admin = new MongoClient(uri, { directConnection: true, serverSelectionTimeoutMS: 500 });
    let ready = false;
    for (let i = 0; i < 100; i++) { try { await admin.connect(); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); } }
    if (!ready) throw new Error('Isolated MongoDB did not start: ' + directory);
    await admin.db('admin').command({ replSetInitiate: { _id: 'contractor_test', members: [{ _id: 0, host: `127.0.0.1:${port}` }] } });
    for (let i = 0; i < 100; i++) { if ((await admin.db('admin').command({ hello: 1 })).isWritablePrimary) break; await new Promise(resolve => setTimeout(resolve, 100)); }
    const module = await Test.createTestingModule({ imports: [MongooseModule.forRoot(uri + '/contractor_status_test?replicaSet=contractor_test'), ContractorsModule], providers: [
      { provide: AuthService, useValue: { current: async (id: string) => { if (!users[id]) throw new UnauthorizedException(); return users[id]; } } },
      { provide: APP_GUARD, useClass: AuthGuard },
    ] }).compile();
    app = module.createNestApplication();
    app.use((req: any, _res: any, next: () => void) => { req.session = { userId: req.get('X-Test-User'), expiresAt: Date.now() + 60000 }; next(); });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init(); db = app.get(getConnectionToken()); service = app.get(ContractorsService);
  }, 60000);
  afterAll(async () => { await app?.close(); await admin?.close(); if (process && process.exitCode === null) { const exited = new Promise(resolve => process.once('exit', resolve)); process.kill(); await exited; } }, 30000);

  it('defaults new contractors to Active and rejects status in Add', async () => {
    expect((await create()).status).toBe('Active');
    await api().post('', { firstName: 'X', lastName: 'Y', email: randomUUID() + '@example.test', status: 'Inactive' }).expect(400);
  });
  it('allows only tenant admins to change status, validates values and versions', async () => {
    const c = await create();
    await api('member').patch('/' + c._id + '/status', { version: 0, status: 'Inactive' }).expect(403);
    await api('other').patch('/' + c._id + '/status', { version: 0, status: 'Inactive' }).expect(404);
    await api().patch('/' + c._id + '/status', { version: 0, status: 'Terminated' }).expect(400);
    const saved = (await api().patch('/' + c._id + '/status', { version: 0, status: 'Inactive' }).expect(200)).body;
    expect(saved).toMatchObject({ status: 'Inactive', firstName: c.firstName, email: c.email });
    await api().patch('/' + c._id + '/status', { version: 0, status: 'Active' }).expect(409);
  });
  it('rejects inactive or deactivated reviewed payments while preserving history and successful replay', async () => {
    const c = await create(), d = draft(c);
    const saved = (await api().post('/payments', d).expect(201)).body;
    const history = (await api().get('/' + c._id + '/payments')).body;
    const inactive = (await api().patch('/' + c._id + '/status', { version: c.version, status: 'Inactive' }).expect(200)).body;
    await api().post('/payments', { ...d, idempotencyKey: randomUUID() }).expect(400);
    await api().post('/payments', draft(inactive)).expect(400);
    expect((await api().get('/' + c._id + '/payments')).body).toEqual(history);
    expect((await api().post('/payments', d).expect(201)).body.entries).toEqual(saved.entries);
  });
  it('deletes only the selected tenant contractor and its entries in shared and private envelopes', async () => {
    const a = await create(), b = await create(), foreign = await create('other');
    const shared = draft(a, b), privateDraft = draft(a);
    await api().post('/payments', shared).expect(201); await api().post('/payments', privateDraft).expect(201);
    await api('other').post('/payments', draft(foreign)).expect(201);
    const before = (await api().get('/' + b._id + '/payments')).body;
    const foreignBefore = (await api('other').get('/' + foreign._id + '/payments')).body;
    await api('member').remove(a._id).expect(403); await api('other').remove(a._id).expect(404);
    await api().remove(a._id).expect(200); await api().get('/' + a._id).expect(404);
    expect(await service.models(org).payments.countDocuments({ 'entries.contractorId': a._id })).toBe(0);
    expect(await service.models(org).payments.countDocuments({ idempotencyKey: privateDraft.idempotencyKey })).toBe(0);
    expect((await api().get('/' + b._id + '/payments')).body).toEqual(before);
    expect((await api('other').get('/' + foreign._id + '/payments')).body).toEqual(foreignBefore);
    const replay = (await api().post('/payments', shared).expect(201)).body;
    expect(replay.entries).toHaveLength(1); expect(replay.entries[0].contractorId).toBe(b._id);
  });
  it('rolls back contractor and history together when payment removal fails', async () => {
    const c = await create(); await api().post('/payments', draft(c)).expect(201);
    const history = (await api().get('/' + c._id + '/payments')).body;
    const collection = service.models(org).payments.collection;
    const spy = jest.spyOn(collection, 'updateMany').mockRejectedValueOnce(new Error('Simulated removal failure'));
    try { await api().remove(c._id).expect(500); } finally { spy.mockRestore(); }
    await api().get('/' + c._id).expect(200);
    expect((await api().get('/' + c._id + '/payments')).body).toEqual(history);
  });
  it('serializes concurrent payment insertion and deletion without orphan payment entries', async () => {
    for (let i = 0; i < 3; i++) {
      const c = await create(), d = draft(c);
      const [payment, removal] = await Promise.all([api().post('/payments', d), api().remove(c._id)]);
      expect([201, 404, 409]).toContain(payment.status); expect(removal.status).toBe(200);
      expect(await service.models(org).payments.countDocuments({ 'entries.contractorId': c._id })).toBe(0);
    }
  });
});
