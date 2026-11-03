import { BadRequestException } from '@nestjs/common';
export function validatePaymentDate(value: string) {
  const date = new Date(value + 'T00:00:00Z');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value ||
    value < '1900-01-01'
  )
    throw new BadRequestException('Enter a valid payment date.');
}
