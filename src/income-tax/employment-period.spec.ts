import { employmentPeriod } from './employment-period';

const year = { startDate: '2026-04-01', endDate: '2027-03-31' };
describe('Employment month projection', () => {
  it('includes September joining month and March year end', () => {
    const result = employmentPeriod({ hireDate: '2026-09-06' }, year);
    expect(result.eligibleMonthCount).toBe(7);
    expect(result.eligibleMonths).toEqual([5, 6, 7, 8, 9, 10, 11]);
  });
  it.each(['2026-04-01', '2025-02-01'])(
    'projects twelve months for %s',
    (hireDate) => {
      expect(employmentPeriod({ hireDate }, year).eligibleMonthCount).toBe(12);
    },
  );
  it('handles the final month and crossing the calendar year', () => {
    expect(
      employmentPeriod({ hireDate: '2027-03-31' }, year).eligibleMonths,
    ).toEqual([11]);
    expect(
      employmentPeriod({ hireDate: '2027-01-06' }, year).eligibleMonths,
    ).toEqual([9, 10, 11]);
  });
  it('excludes submitted months from allocation without removing their projected earnings', () => {
    const result = employmentPeriod({ hireDate: '2026-09-06' }, year, [
      '2026-09',
      '2026-10',
    ]);
    expect(result.eligibleMonthCount).toBe(7);
    expect(result.remainingMonths).toEqual([7, 8, 9, 10, 11]);
  });
  it('uses rehire as current employment start', () => {
    expect(
      employmentPeriod(
        { hireDate: '2025-01-01', rehireDate: '2026-09-06' },
        year,
      ).eligibleMonthCount,
    ).toBe(7);
  });
  it('rejects employment after the year end', () => {
    expect(() => employmentPeriod({ hireDate: '2027-04-01' }, year)).toThrow(
      'after',
    );
  });
});
