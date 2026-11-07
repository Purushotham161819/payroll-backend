import { Test } from '@nestjs/testing';
import { Body, Controller, Patch } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { configureOrganizationLogoBodyParser } from './organization-logo-body-parser';
import { RunPayrollController } from '../run-payroll/run-payroll.controller';
import { RunPayrollService } from '../run-payroll/run-payroll.service';

@Controller('settings/organization-profile')
class LogoParserProbe {
  @Patch('logo') logo(@Body() body: { dataUrl: string }) { return { length: body.dataUrl.length }; }
}

describe('Logo parser and payroll JSON requests share the Nest bootstrap', () => {
 let app: NestExpressApplication;
 const service = {
  preview: jest.fn((body: {period?: string}) => {
   RunPayrollService.prototype.period(body?.period);
   return body;
  }),
  save: jest.fn((body: unknown) => body),
  submit: jest.fn((_period: string, body: unknown) => body),
 };
 beforeAll(async () => {
  const module = await Test.createTestingModule({controllers:[RunPayrollController,LogoParserProbe],providers:[{provide:RunPayrollService,useValue:service}]}).compile();
  app = module.createNestApplication<NestExpressApplication>();
  configureOrganizationLogoBodyParser(app);
  app.use((req: any, _res: any, next: () => void) => { req.account = {id:'test-actor'}; next(); });
  await app.init();
 });
 afterAll(async () => { await app.close(); });
 it('parses the selected month and employees when Run Payroll opens', async () => {
  const body = {period:'2026-11',employeeIds:['507f1f77bcf86cd799439011'],recalculate:false};
  await request(app.getHttpServer()).post('/payroll/runs/preview').send(body).expect(201).expect(body);
 });
 it('preserves draft and submission bodies', async () => {
  const draft = {period:'2026-11',employeeIds:['507f1f77bcf86cd799439011'],version:1,inputHash:'hash'};
  await request(app.getHttpServer()).post('/payroll/runs/draft').send(draft).expect(201).expect(draft);
  const submit = {version:1,paymentDate:'2026-11-30',idempotencyKey:'submission-key-12345'};
  await request(app.getHttpServer()).post('/payroll/runs/2026-11/submit').send(submit).expect(201).expect(submit);
 });
 it('retains the larger upload allowance on the logo route', async () => {
  const dataUrl = 'data:image/png;base64,' + 'A'.repeat(200000);
  await request(app.getHttpServer()).patch('/settings/organization-profile/logo').send({dataUrl}).expect(200).expect({length:dataUrl.length});
 });
 it('retains the default JSON size limit for payroll requests', async () => {
  await request(app.getHttpServer()).post('/payroll/runs/preview').send({period:'2026-11',padding:'A'.repeat(200000)}).expect(413);
 });
});
