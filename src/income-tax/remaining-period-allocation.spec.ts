import { allocateMonthly, allocatePeriods } from './tax-engine';

describe('Remaining eligible payroll allocation', () => {
  it('preserves the existing full-year allocation', () => {
    expect(
      allocatePeriods(
        12345.67,
        Array.from({ length: 12 }, (_, i) => i),
      ),
    ).toEqual(allocateMonthly(12345.67));
  });
  it('allocates September through March for an April financial year', () => {
    expect(allocatePeriods(35000, [5, 6, 7, 8, 9, 10, 11])).toEqual([
      0, 0, 0, 0, 0, 5000, 5000, 5000, 5000, 5000, 5000, 5000,
    ]);
  });
  it('excludes submitted periods and gives the last eligible check the remainder', () => {
    expect(allocatePeriods(100, [7, 9, 11])).toEqual([
      0, 0, 0, 0, 0, 0, 0, 33.33, 0, 33.33, 0, 33.34,
    ]);
  });
  it('allows no remaining periods only with zero remaining liability', () => {
    expect(allocatePeriods(0, [])).toEqual(Array(12).fill(0));
    expect(() => allocatePeriods(1, [])).toThrow('No eligible payroll periods');
  });
  it.each([[1, 1], [-1], [12], [2, 1], [1.5]])(
    'rejects invalid indexes %j',
    (...months) => {
      expect(() => allocatePeriods(1, months)).toThrow(
        'Eligible payroll months',
      );
    },
  );
});
