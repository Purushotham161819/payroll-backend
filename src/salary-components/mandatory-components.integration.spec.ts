import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { SalaryComponentsModule } from './salary-components.module';
import { SalaryComponentsService } from './salary-components.service';
import { SalaryCalculationService } from '../payroll-generator/salary-calculation.service';

const integration =
  process.env.RUN_MONGO_TESTS === '1' ? describe : describe.skip;
integration(
  'Mandatory salary component initialization and restrictions',
  () => {
    let app: INestApplication;
    const dbName = `payroll_mandatory_test_${process.pid}_${Date.now()}`;
    async function start() {
      const module = await Test.createTestingModule({
        imports: [
          MongooseModule.forRoot('mongodb://127.0.0.1:27017', {
            dbName,
            serverSelectionTimeoutMS: 3000,
          }),
          SalaryComponentsModule,
        ],
        providers: [SalaryCalculationService],
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
      if (app) {
        const connection = app.get<Connection>(getConnectionToken());
        if (
          connection.name === dbName &&
          dbName.startsWith('payroll_mandatory_test_')
        )
          await connection.dropDatabase();
        await app.close();
      }
    });
    it('initializes three blank rates, protects identity/type/status and preserves edited rates and bases on restart', async () => {
      const api = () => request(app.getHttpServer());
      let records = (await api().get('/salary-components').expect(200)).body;
      expect(records.map((c: any) => c.code)).toEqual(['BASIC', 'DA', 'RA']);
      for (const c of records) {
        expect(c).toMatchObject({
          isSystemDefined: true,
          status: 'active',
          category: 'earning',
          calculationType: 'percentage',
          calculationValue: null,
        });
      }
      expect(() =>
        app.get(SalaryCalculationService).calculate(1200000, records),
      ).toThrow('Mandatory');
      for (const [index, c] of records.entries()) {
        for (const update of [
          { name: 'Changed' },
          { code: 'NEW' },
          { status: 'inactive' },
          { calculationType: 'fixed' },
          { category: 'deduction' },
          { isSystemDefined: false },
          { calculationValue: null },
          { calculationValue: 101 },
          { calculationValue: -1 },
        ])
          await api()
            .patch(`/salary-components/${c._id}`)
            .send(update)
            .expect(400);
        await api()
          .patch(`/salary-components/${c._id}/status`)
          .send({ status: 'inactive' })
          .expect(400);
        await api().delete(`/salary-components/${c._id}`).expect(404);
        const base =
          index === 0
            ? {}
            : {
                calculationBaseType: 'salary_component',
                calculationBaseComponentId: records[index - 1]._id,
              };
        await api()
          .patch(`/salary-components/${c._id}`)
          .send({ ...base, calculationValue: [40, 10, 50][index] })
          .expect(200);
      }
      await api()
        .post('/salary-components')
        .send({
          name: 'Duplicate',
          code: 'basic',
          category: 'earning',
          calculationBaseType: 'annual_ctc',
          calculationType: 'percentage',
          calculationValue: 20,
        })
        .expect(409);
      await app.get(SalaryComponentsService).onModuleInit();
      await app.close();
      await start();
      const after = (await api().get('/salary-components').expect(200)).body;
      expect(after.map((c: any) => c._id)).toEqual(
        records.map((c: any) => c._id),
      );
      expect(after.map((c: any) => c.calculationValue)).toEqual([40, 10, 50]);
      expect(
        app
          .get(SalaryCalculationService)
          .calculate(1200000, after)
          .map((c) => c.monthly),
      ).toEqual([40000, 4000, 2000]);
      // Exercise upgrading pre-existing records without touching real application data.
      const collection = app
        .get<Connection>(getConnectionToken())
        .collection('salary_components');
      await collection.updateOne(
        { code: 'BASIC' },
        {
          $set: {
            calculationValue: 37.5,
            name: 'Old Basic',
            isSystemDefined: false,
          },
        },
      );
      await collection.updateOne(
        { code: 'DA' },
        {
          $set: {
            calculationType: 'fixed',
            calculationValue: 2000,
            fixedAmountPeriod: 'monthly',
          },
        },
      );
      await Promise.all([
        app.get(SalaryComponentsService).onModuleInit(),
        app.get(SalaryComponentsService).onModuleInit(),
      ]);
      records = (await api().get('/salary-components')).body;
      expect(records).toHaveLength(3);
      expect(records[0]).toMatchObject({
        name: 'Basic Salary',
        calculationValue: 37.5,
        isSystemDefined: true,
      });
      expect(records[1]).toMatchObject({
        calculationType: 'percentage',
        calculationValue: null,
        legacyCalculation: {
          calculationType: 'fixed',
          calculationValue: 2000,
          fixedAmountPeriod: 'monthly',
        },
      });
    }, 30000);
  },
);
