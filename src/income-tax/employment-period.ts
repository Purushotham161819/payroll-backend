import { BadRequestException } from '@nestjs/common';
import type { TaxYear } from './tax.types';

const month = (date: Date) => date.getUTCFullYear() * 12 + date.getUTCMonth();

/** Month-based projection: include the joining month and the year-end month. */
export function employmentPeriod(
  employee: { hireDate: Date | string; rehireDate?: Date | string },
  year: Pick<TaxYear, 'startDate' | 'endDate'>,
  submittedPeriods: string[] = [],
) {
  const start = new Date(employee.rehireDate ?? employee.hireDate);
  const yearStart = new Date(year.startDate);
  const yearEnd = new Date(year.endDate);
  if (![start, yearStart, yearEnd].every((d) => Number.isFinite(d.getTime())))
    throw new BadRequestException(
      'Valid employment and financial-year dates are required.',
    );
  if (start > yearEnd)
    throw new BadRequestException(
      'Employment starts after the selected financial year ends.',
    );
  const firstMonth = Math.max(0, month(start) - month(yearStart));
  const eligibleMonths = Array.from(
    { length: 12 - firstMonth },
    (_, i) => firstMonth + i,
  );
  const submitted = new Set(
    submittedPeriods.map((p) => month(new Date(p + '-01')) - month(yearStart)),
  );
  return {
    hireDate: new Date(employee.hireDate).toISOString().slice(0, 10),
    employmentStartDate: start.toISOString().slice(0, 10),
    financialYearStartDate: year.startDate,
    eligibleMonths,
    eligibleMonthCount: eligibleMonths.length,
    remainingMonths: eligibleMonths.filter((m) => !submitted.has(m)),
  };
}
