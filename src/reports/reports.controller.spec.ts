import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { BusinessModelsModule } from '../organizations/business-models.module';
import { tenantContext } from '../organizations/tenant-context';
import { Employee,EmployeeSchema } from '../employees/schemas/employee.schema';
import { PayrollRunSchema } from '../run-payroll/schemas/payroll-run.schema';
import { createConnection } from 'mongoose';
describe('Reports authorization and tenant models',()=>{
 let app:INestApplication;
 const reports={dashboard:jest.fn().mockResolvedValue({annualRunRate:0}),workforce:jest.fn().mockResolvedValue({rows:[]}),periods:jest.fn().mockResolvedValue([]),payroll:jest.fn().mockResolvedValue({rows:[]})};
 beforeAll(async()=>{
  const module=await Test.createTestingModule({controllers:[ReportsController],providers:[{provide:ReportsService,useValue:reports},{provide:AuthService,useValue:{current:async(id:string)=>({id,role:id,organizationId:'ORG000001'})}},{provide:APP_GUARD,useClass:AuthGuard}]}).compile();
  app=module.createNestApplication();app.use((req:any,_res:any,next:()=>void)=>{const role=req.get('X-Test-Role');if(role)req.session={userId:role,expiresAt:Date.now()+60000};next();});await app.init();
 });
 afterAll(()=>app.close());
 it('requires authentication for report data',async()=>{await request(app.getHttpServer()).get('/reports/dashboard').expect(401);});
 for(const role of ['admin','user'])it('admits existing business role '+role,async()=>{await request(app.getHttpServer()).get('/reports/workforce').set('X-Test-Role',role).expect(200);});
 it('denies customer reports to platform-only accounts',async()=>{await request(app.getHttpServer()).get('/reports/payroll/2026-07').set('X-Test-Role','super_admin').expect(403);});
 it('resolves dashboard and workforce models to separate organization collections',async()=>{
  const connection=createConnection();
  const module=BusinessModelsModule.forFeature([{name:Employee.name,schema:EmployeeSchema},{name:'PayrollRun',schema:PayrollRunSchema}]);
  const factories=module.providers as any[];
  for(const factory of factories){
   const model=factory.useFactory(connection);
   const a=tenantContext.run({organizationId:'ORG000001'},()=>model.collection.name);
   const b=tenantContext.run({organizationId:'ORG000002'},()=>model.collection.name);
   expect(a).toMatch(/^org000001_/);expect(b).toMatch(/^org000002_/);expect(a).not.toBe(b);
  }
  await connection.close();
 });
});
