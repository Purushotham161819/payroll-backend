import { BadRequestException, Injectable } from '@nestjs/common';
import { MANDATORY_COMPONENTS } from './mandatory-components';

export interface CalculationComponent {
  _id: { toString(): string };
  code: string;
  category: 'earning' | 'deduction';
  calculationBaseType: 'annual_ctc' | 'salary_component';
  calculationBaseComponentId?: { toString(): string } | null;
  calculationType: 'percentage' | 'fixed';
  calculationValue: number | null;
  fixedAmountPeriod?: 'annual' | 'monthly' | null;
  showInPayslip: boolean;
  status: 'active' | 'inactive';
}

// Round each annual component to paise, then derive its rounded monthly amount.
@Injectable()
export class SalaryCalculationService {
  calculate(annualCtc: number, components: CalculationComponent[]) {
    for (const mandatory of MANDATORY_COMPONENTS) {
      const matches = components.filter((c) => c.code === mandatory.code);
      const component = matches[0];
      if (
        matches.length !== 1 ||
        !component ||
        component.status !== 'active' ||
        component.category !== 'earning' ||
        component.calculationType !== 'percentage' ||
        typeof component.calculationValue !== 'number' ||
        !Number.isFinite(component.calculationValue) ||
        component.calculationValue < 0 ||
        component.calculationValue > 100
      )
        throw new BadRequestException(
          `Mandatory component ${mandatory.code} requires an active earning configuration and a percentage from 0 to 100.`,
        );
    }
    const money = (value: number) => {
      if (
        !Number.isFinite(value) ||
        value < 0 ||
        value * 100 > Number.MAX_SAFE_INTEGER
      )
        throw new BadRequestException(
          'Amount is outside the supported currency range.',
        );
      return Math.round((value + Number.EPSILON) * 100) / 100;
    };
    annualCtc = money(annualCtc);
    const records = new Map(components.map((c) => [c._id.toString(), c]));
    const visiting = new Set<string>();
    const result = new Map<
      string,
      {
        componentId: string;
        code: string;
        category: string;
        annual: number;
        monthly: number;
        showInPayslip: boolean;
      }
    >();
    const resolve = (id: string): number => {
      if (visiting.has(id))
        throw new BadRequestException('Circular salary component dependency.');
      const cached = result.get(id);
      if (cached) return cached.annual;
      const c = records.get(id);
      if (!c || c.status !== 'active')
        throw new BadRequestException(
          'Calculation base is missing or inactive.',
        );
      visiting.add(id);
      let base = annualCtc;
      if (c.calculationBaseType === 'salary_component') {
        base = resolve(c.calculationBaseComponentId?.toString() ?? '');
      } else if (c.calculationBaseType !== 'annual_ctc')
        throw new BadRequestException('Invalid calculation base.');
      if (
        typeof c.calculationValue !== 'number' ||
        !Number.isFinite(c.calculationValue) ||
        c.calculationValue < 0
      )
        throw new BadRequestException('Invalid calculation value.');
      let annual: number;
      if (c.calculationType === 'percentage') {
        if (c.calculationValue > 100)
          throw new BadRequestException(
            'Percentage must be between 0 and 100.',
          );
        annual = money(base * (c.calculationValue / 100));
      } else if (
        c.calculationType === 'fixed' &&
        ['annual', 'monthly'].includes(c.fixedAmountPeriod ?? '')
      ) {
        annual = money(
          c.calculationValue * (c.fixedAmountPeriod === 'monthly' ? 12 : 1),
        );
      } else
        throw new BadRequestException(
          'Fixed amounts require an annual or monthly period.',
        );
      visiting.delete(id);
      result.set(id, {
        componentId: id,
        code: c.code,
        category: c.category,
        annual,
        monthly: money(annual / 12),
        showInPayslip: c.showInPayslip,
      });
      return annual;
    };
    for (const c of components)
      if (c.status === 'active') resolve(c._id.toString());
    return [...result.values()];
  }
}
