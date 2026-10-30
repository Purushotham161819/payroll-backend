import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import { RunPayrollController } from './run-payroll.controller';
import { RunPayrollService } from './run-payroll.service';
import { AuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';

describe('Payroll routes use existing authentication and authorization', () => {
  let app: INestApplication;
  const service = {
    preview: jest.fn().mockResolvedValue({ status: 'Draft' }),
    save: jest.fn().mockResolvedValue({ status: 'Draft' }),
    submit: jest.fn().mockResolvedValue({ status: 'Submitted' }),
    submission: jest.fn().mockResolvedValue({ status: 'Submitted' }),
    history: jest.fn().mockResolvedValue([]),
    pdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4')),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [RunPayrollController],
      providers: [
        { provide: RunPayrollService, useValue: service },
        {
          provide: AuthService,
          useValue: {
            current: async (id: string) => ({
              id,
              email: 'tester@example.test',
              role: id === 'super' ? 'super_admin' : 'user',
            }),
          },
        },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    // Test-only persisted-session stand-in; no production bypass is introduced.
    app.use((req: any, _res: any, next: () => void) => {
      if (['user', 'super'].includes(req.get('X-Test-Session')))
        req.session = {
          userId: req.get('X-Test-Session'),
          expiresAt: Date.now() + 10000,
          sessionVersion: 0,
        };
      next();
    });
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  it('protects preview, draft, submission, summary, history and PDF endpoints from unauthenticated callers', async () => {
    const api = request(app.getHttpServer());
    for (const route of [
      '/payroll/runs/2026-01',
      '/payroll/employees/507f1f77bcf86cd799439011/checks',
      '/payroll/runs/2026-01/checks/507f1f77bcf86cd799439011/pdf',
    ])
      await api.get(route).expect(401);
    for (const route of [
      '/payroll/runs/preview',
      '/payroll/runs/draft',
      '/payroll/runs/2026-01/submit',
    ])
      await api.post(route).send({}).expect(401);
    expect(service.pdf).not.toHaveBeenCalled();
  });
  it('preserves Super Admin isolation and origin verification for writes', async () => {
    const api = request(app.getHttpServer());
    await api
      .get('/payroll/runs/2026-01')
      .set('X-Test-Session', 'super')
      .expect(403);
    await api
      .post('/payroll/runs/preview')
      .set('X-Test-Session', 'user')
      .send({})
      .expect(403);
    await api
      .post('/payroll/runs/draft')
      .set({
        'X-Test-Session': 'user',
        Origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:4200',
        'X-Payroll-Request': '1',
      })
      .send({ period: '2026-01' })
      .expect(201);
    expect(service.save).toHaveBeenCalledWith({ period: '2026-01' }, 'user');
  });
  it('serves PDFs only through the authenticated controller with private cache headers', async () => {
    const response = await request(app.getHttpServer())
      .get('/payroll/runs/2026-01/checks/507f1f77bcf86cd799439011/pdf')
      .set('X-Test-Session', 'user')
      .expect(200)
      .expect('Content-Type', /application\/pdf/);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['content-disposition']).toContain(
      'Payslip_2026-01_',
    );
    expect(response.body.toString()).toBe('%PDF-1.4');
  });
});
