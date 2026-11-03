import { validatePaymentDate } from './contractor-payment';
import {
  calculateContractorPayment,
  deductionAmount,
  validateDeductionRule,
} from './contractor-deductions';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ContractorDto,
  ContractorPaymentDto,
  ContractorComponentDto,
} from './contractor.dto';
import { randomUUID } from 'node:crypto';
const fixed = (calculationValue: number) => ({
  calculationType: 'fixed',
  calculationValue,
});
const percentage = (calculationValue: number) => ({
  calculationType: 'percentage',
  calculationValue,
});
const formula = (formula: string) => ({ calculationType: 'formula', formula });
const check = (type: any, value: any) =>
  validate(plainToInstance(type, value), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
describe('Contractor Gross Pay and deduction validation independent of employee payroll', () => {
  it('calculates assigned percentage and fixed deductions using Gross Pay', () => {
    expect(
      calculateContractorPayment(50000, [percentage(10), fixed(2000)]),
    ).toEqual({
      grossPay: 50000,
      amounts: [5000, 2000],
      totalDeductions: 7000,
      netPayment: 43000,
    });
  });
  it('supports empty deductions and explicit zero Gross Pay', () => {
    expect(calculateContractorPayment(0, []).netPayment).toBe(0);
    expect(calculateContractorPayment(100.25, [])).toMatchObject({
      totalDeductions: 0,
      netPayment: 100.25,
    });
  });
  it('rounds half paise upward per component without binary floating errors', () => {
    expect(deductionAmount(0.1, percentage(5))).toBe(0.01);
    expect(deductionAmount(1.01, percentage(50))).toBe(0.51);
    expect(
      calculateContractorPayment(0.3, [fixed(0.1), fixed(0.2)]).netPayment,
    ).toBe(0);
  });
  it('returns negative net for display so the application can block submission', () =>
    expect(calculateContractorPayment(1, [fixed(2)]).netPayment).toBe(-1));
  it.each([-1, NaN, Infinity, 0.001, 1e10])(
    'rejects invalid Gross Pay %s',
    (amount) => expect(() => calculateContractorPayment(amount, [])).toThrow(),
  );
  it.each([-1, 100.01, NaN])('rejects invalid rate %s', (rate) =>
    expect(() => validateDeductionRule(percentage(rate))).toThrow(),
  );
  it.each([
    'grossPay * 10%',
    'grossPay / 10',
    '(grossPay * 0.1 + 2) - 2',
    '+grossPay * .1',
  ])('safely evaluates %s', (f) =>
    expect(deductionAmount(50000, formula(f))).toBe(5000),
  );
  it.each([
    'invoice * 10%',
    'globalThis.process.exit()',
    'grossPay.constructor',
    'Math.max(grossPay,1)',
    'grossPay ** 2',
    'grossPay; 1',
    'grossPay +',
    'grossPay % 2',
    '('.repeat(40) + 'grossPay' + ')'.repeat(40),
  ])('rejects unsupported expression %s', (f) =>
    expect(() => validateDeductionRule(formula(f))).toThrow(),
  );
  it.each([
    'grossPay / 0',
    '-grossPay',
    '1000000001',
    'grossPay / (grossPay - grossPay)',
  ])('rejects invalid result %s', (f) =>
    expect(() => deductionAmount(100, formula(f))).toThrow(),
  );
  it('requires explicit correction of earlier reference-only manual settings', () =>
    expect(() => validateDeductionRule({ calculationType: 'manual' })).toThrow(
      'earlier manual',
    ));
  it.each(['2026-02-29', '2026-13-01', '2026-04-31', 'invalid', '2026-1-1'])(
    'rejects invalid civil date %s',
    (date) => expect(() => validatePaymentDate(date)).toThrow(),
  );
  it('accepts leap dates literally', () =>
    expect(() => validatePaymentDate('2028-02-29')).not.toThrow());
  it('normalizes identity and rejects employee/organization injection', async () => {
    const d = plainToInstance(ContractorDto, {
      firstName: ' Ada ',
      lastName: ' Example ',
      email: ' ADA@example.test ',
    });
    expect(await validate(d)).toEqual([]);
    expect(d.email).toBe('ada@example.test');
    expect(
      (
        await check(ContractorDto, {
          ...d,
          annualCtc: 1,
          organizationId: 'ORG000002',
        })
      ).length,
    ).toBe(2);
  });
  const draft = () => ({
    idempotencyKey: randomUUID(),
    paymentDate: '2026-11-03',
    description: 'Invoice',
    entries: [
      {
        contractorId: '507f1f77bcf86cd799439011',
        contractorVersion: 0,
        grossPay: 100,
        components: [] as any[],
      },
    ],
  });
  it('accepts no-deduction payments and requires manual Gross Pay', async () => {
    const d = draft();
    expect(await check(ContractorPaymentDto, d)).toEqual([]);
    delete (d.entries[0] as any).grossPay;
    expect((await check(ContractorPaymentDto, d)).length).toBeGreaterThan(0);
  });
  it('rejects forged component amounts and computed totals', async () => {
    const d = draft();
    d.entries[0].components = [
      {
        componentId: '507f1f77bcf86cd799439012',
        componentVersion: 0,
        amount: 0,
      },
    ];
    expect((await check(ContractorPaymentDto, d)).length).toBeGreaterThan(0);
    expect(
      (await check(ContractorPaymentDto, { ...draft(), netPayment: 999 }))
        .length,
    ).toBeGreaterThan(0);
  });
  it.each(['earning', 'allowance', 'statutory'])(
    'rejects new classification %s',
    async (classification) =>
      expect(
        (
          await check(ContractorComponentDto, {
            name: 'Fee',
            code: 'FEE',
            classification,
            status: 'active',
            calculationType: 'fixed',
            calculationValue: 10,
          })
        ).length,
      ).toBeGreaterThan(0),
  );
  it('rejects client calculation bases', async () =>
    expect(
      (
        await check(ContractorComponentDto, {
          name: 'Fee',
          code: 'FEE',
          classification: 'deduction',
          status: 'active',
          calculationType: 'fixed',
          calculationValue: 10,
          calculationBase: 'annualCtc',
        })
      ).length,
    ).toBe(1));
});
