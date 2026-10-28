import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Employee } from '../employees/schemas/employee.schema';
import { SalaryComponentsService } from '../salary-components/salary-components.service';
import { SalaryCalculationService } from './salary-calculation.service';
import { StatutoryDeductionsService } from '../statutory-deductions/statutory-deductions.service';

@Injectable()
export class PayrollGeneratorService {
  constructor(
    @InjectModel(Employee.name) private readonly employees: Model<Employee>,
    private readonly components: SalaryComponentsService,
    private readonly settings: StatutoryDeductionsService,
    private readonly calculator: SalaryCalculationService,
  ) {}
  async annual() {
    const [employees, components, settings] = await Promise.all([
      this.employees.find().lean().exec(),
      this.components.findAll(),
      this.settings.get(),
    ]);
    if (!settings)
      throw new BadRequestException(
        'Configure statutory deductions before calculating payroll.',
      );
    return {
      components,
      employees: employees.map((employee) => ({
        employee,
        calculation: this.calculator.calculateAnnual(
          employee.annualCtc,
          components,
          settings,
        ),
      })),
    };
  }
}
