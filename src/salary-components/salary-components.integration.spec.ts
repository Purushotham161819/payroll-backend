import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { SalaryComponentsModule } from './salary-components.module';

const integration = process.env.RUN_MONGO_TESTS === '1' ? describe : describe.skip;
integration('Salary components persisted HTTP contract (isolated test database)', () => {
  let app: INestApplication;
  const dbName = `payroll_salary_test_${process.pid}_${Date.now()}`;
  const payload = {name:' Basic Salary ',code:' custom ',category:'earning',calculationBaseType:'annual_ctc',calculationType:'percentage',calculationValue:40,showInPayslip:false,status:'inactive'};
  async function start() {
    const module = await Test.createTestingModule({imports:[MongooseModule.forRoot('mongodb://127.0.0.1:27017', {dbName,serverSelectionTimeoutMS:3000}),SalaryComponentsModule]}).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true}));
    await app.init();
  }
  beforeAll(start,30000);
  afterAll(async () => {
    if (app) {
      const connection = app.get<Connection>(getConnectionToken());
      // Only this suite's uniquely named database is removed.
      if (connection.name === dbName && dbName.startsWith('payroll_salary_test_')) await connection.dropDatabase();
      await app.close();
    }
  });
  it('persists normalized configuration, preserves PATCH fields, rejects invalid graphs and survives restart', async () => {
    const api = () => request(app.getHttpServer());
    expect((await api().get('/salary-components').expect(200)).body).toHaveLength(3);
    const first = await api().post('/salary-components').send(payload).expect(201);
    const id = first.body._id;
    expect(first.body).toMatchObject({name:'Basic Salary',code:'CUSTOM',showInPayslip:false,status:'inactive'});
    await api().post('/salary-components').send(payload).expect(409);
    const edited = await api().patch(`/salary-components/${id}`).send({name:'Basic'}).expect(200);
    expect(edited.body).toMatchObject({showInPayslip:false,status:'inactive'});
    await api().patch(`/salary-components/${id}`).send({name:null}).expect(400);
    await api().patch(`/salary-components/${id}/status`).send({status:'active'}).expect(200);
    const second = await api().post('/salary-components').send({...payload,code:'HRA',status:'active',calculationBaseType:'salary_component',calculationBaseComponentId:id}).expect(201);
    await api().patch(`/salary-components/${id}`).send({calculationBaseType:'salary_component',calculationBaseComponentId:second.body._id}).expect(400);
    await api().patch(`/salary-components/${id}/status`).send({status:'inactive'}).expect(400);
    await api().post('/salary-components').send({...payload,code:'INVALID',calculationValue:101}).expect(400);
    await api().post('/salary-components').send({...payload,code:'FIXED',calculationType:'fixed',fixedAmountPeriod:'monthly',calculationValue:2000}).expect(201);
    const before = await api().get('/salary-components').expect(200);
    await app.close(); await start();
    const after = await api().get('/salary-components').expect(200);
    expect(after.body.filter((c: any) => !c.isSystemDefined)).toEqual(before.body.filter((c: any) => !c.isSystemDefined));
  },30000);
});

