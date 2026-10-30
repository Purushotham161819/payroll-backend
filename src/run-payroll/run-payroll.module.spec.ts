import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import request from 'supertest';
import { RunPayrollModule } from './run-payroll.module';
import { RunPayrollService } from './run-payroll.service';
import { PayrollGeneratorModule } from '../payroll-generator/payroll-generator.module';
import { PayrollGeneratorService } from '../payroll-generator/payroll-generator.service';
import { SalaryCalculationService } from '../payroll-generator/salary-calculation.service';
import { SalaryComponentsService } from '../salary-components/salary-components.service';

describe('Run Payroll feature boundary', () => {
  async function compile(withGenerator: boolean) {
    const builder = Test.createTestingModule({
      imports: [
        MongooseModule.forRoot('mongodb://unused/feature-boundary'),
        RunPayrollModule,
        ...(withGenerator ? [PayrollGeneratorModule] : []),
      ],
    }).overrideProvider(getConnectionToken()).useValue({ close: async () => {} })
      .overrideProvider(SalaryComponentsService).useValue({ findAll: async () => [] });
    for (const name of ['Employee', 'SalaryComponent', 'StatutoryDeductions', 'PayrollRun'])
      builder.overrideProvider(getModelToken(name)).useValue({});
    return builder.compile();
  }

  it('boots without the Generator feature and does not register its report endpoint', async () => {
    const module = await compile(false);
    const app = module.createNestApplication();
    try {
      await app.init();
      expect(app.get(RunPayrollService)).toBeInstanceOf(RunPayrollService);
      expect(app.get(SalaryCalculationService)).toBeInstanceOf(SalaryCalculationService);
      await request(app.getHttpServer()).get('/payroll/annual').expect(404);
      await request(app.getHttpServer()).post('/payroll/runs/preview').send({}).expect(400);
    } finally {
      await app.close();
    }
  });

  it('shares one calculator instance when both independent features are loaded', async () => {
    const module = await compile(true);
    try {
      const calculator = module.get(SalaryCalculationService);
      expect(Reflect.get(module.get(RunPayrollService), 'calculator')).toBe(calculator);
      expect(Reflect.get(module.get(PayrollGeneratorService), 'calculator')).toBe(calculator);
    } finally {
      await module.close();
    }
  });
});
