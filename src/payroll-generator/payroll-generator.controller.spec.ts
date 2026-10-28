import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import request from 'supertest';
import { Employee } from '../employees/schemas/employee.schema';
import { SalaryComponent } from '../salary-components/salary-component.schema';
import { SalaryComponentsService } from '../salary-components/salary-components.service';
import { StatutoryDeductions } from '../statutory-deductions/statutory-deductions.schema';
import { StatutoryDeductionsService } from '../statutory-deductions/statutory-deductions.service';
import { PayrollGeneratorModule } from './payroll-generator.module';

describe('Payroll Generator module HTTP contract', () => {
  it('wires feature dependencies and preserves the annual route, response and validation', async () => {
    const employee = { _id: 'employee', annualCtc: 107500 };
    const components = ['BASIC', 'DA', 'RA'].map((code, index) => ({
      _id: code,
      code,
      category: 'earning',
      status: 'active',
      calculationType: 'percentage',
      calculationValue: [40, 10, 15][index],
      calculationBaseType: 'annual_ctc',
      showInPayslip: true,
    }));
    const settings = {
      get: jest.fn().mockResolvedValue({
        epsEmployerContributionPercentage: 8,
        epfEmployerContributionPercentage: 4,
        esiEmployerContributionPercentage: 3,
      }),
    };
    const module = await Test.createTestingModule({
      imports: [PayrollGeneratorModule],
    })
      .overrideProvider(getModelToken(Employee.name))
      .useValue({
        find: () => ({ lean: () => ({ exec: async () => [employee] }) }),
      })
      .overrideProvider(getModelToken(SalaryComponent.name))
      .useValue({})
      .overrideProvider(getModelToken(StatutoryDeductions.name))
      .useValue({})
      .overrideProvider(SalaryComponentsService)
      .useValue({ findAll: async () => components })
      .overrideProvider(StatutoryDeductionsService)
      .useValue(settings)
      .compile();
    const app = module.createNestApplication();
    try {
      await app.init();
      const response = await request(app.getHttpServer())
        .get('/payroll/annual')
        .expect(200);
      expect(response.body.components).toEqual(components);
      expect(response.body.employees[0].employee).toEqual(employee);
      expect(
        response.body.employees[0].calculation.annual.annualGrossWages,
      ).toBe(100000);
      const selected = await request(app.getHttpServer())
        .post('/payroll/annual')
        .send({ selectedComponentIds: [] })
        .expect(201);
      expect(selected.body.employees).toEqual(response.body.employees);
      expect(
        selected.body.reportComponents.map(
          (c: { componentId: string }) => c.componentId,
        ),
      ).toEqual(['BASIC', 'DA', 'RA']);
      await request(app.getHttpServer())
        .post('/payroll/annual')
        .send({ selectedComponentIds: ['unknown'] })
        .expect(400);
      await request(app.getHttpServer())
        .post('/payroll/annual')
        .send({ selectedComponentIds: 'BASIC' })
        .expect(400);
      settings.get.mockResolvedValueOnce(null);
      const invalid = await request(app.getHttpServer())
        .get('/payroll/annual')
        .expect(400);
      expect(invalid.body.message).toBe(
        'Configure statutory deductions before calculating payroll.',
      );
    } finally {
      await app.close();
    }
  });
});
