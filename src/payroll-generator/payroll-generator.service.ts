import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Employee } from '../employees/schemas/employee.schema';
import { SalaryComponentsService } from '../salary-components/salary-components.service';
import { SalaryCalculationService } from './salary-calculation.service';
import { StatutoryDeductionsService } from '../statutory-deductions/statutory-deductions.service';
import { mandatoryComponent } from '../salary-components/mandatory-components';

@Injectable()
export class PayrollGeneratorService {
  constructor(
    @InjectModel(Employee.name) private readonly employees: Model<Employee>,
    private readonly components: SalaryComponentsService,
    private readonly settings: StatutoryDeductionsService,
    private readonly calculator: SalaryCalculationService,
  ) {}
  async annual(selectedComponentIds?: unknown) {
    const [employees, components, settings] = await Promise.all([
      this.employees.find().lean().exec(),
      this.components.findAll(),
      this.settings.get(),
    ]);
    const available = components.filter((c) => c.status === 'active');
    if (
      selectedComponentIds !== undefined &&
      (!Array.isArray(selectedComponentIds) ||
        selectedComponentIds.some(
          (id) =>
            typeof id !== 'string' ||
            !available.some((c) => c._id.toString() === id),
        ))
    )
      throw new BadRequestException(
        'Select valid active salary component IDs.',
      );
    const reportComponents = available
      .filter(
        (c) =>
          mandatoryComponent(c.code) ||
          selectedComponentIds === undefined ||
          (selectedComponentIds as string[]).includes(c._id.toString()),
      )
      .map((c) => ({
        componentId: c._id.toString(),
        code: c.code,
        name: c.name,
        category: c.category,
        mandatory: !!mandatoryComponent(c.code),
      }));
    if (!settings)
      throw new BadRequestException(
        'Configure statutory deductions before calculating payroll.',
      );
    return {
      components,
      reportComponents,
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
