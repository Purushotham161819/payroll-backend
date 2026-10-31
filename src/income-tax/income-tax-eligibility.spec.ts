import { IncomeTaxService } from './income-tax.service';

describe('Saved employee TDS eligibility', () => {
  let service: IncomeTaxService;
  let employee: any, profile: any, revision: any, profiles: any;
  let calculateAnnual: jest.Mock, persist: jest.SpyInstance;
  beforeEach(() => {
    employee = {
      annualCtc: 1440000,
      payFrequency: 'Monthly',
      hireDate: new Date('2025-04-01'),
      dateOfBirth: new Date('1990-01-01'),
    };
    profile = {
      tdsApplicable: true,
      regime: 'new',
      resident: true,
      salaryOnly: true,
      panOperative: true,
      fullYearEmployment: true,
      exemptionConditionsConfirmed: true,
    };
    revision = {
      id: 'published',
      rules: { mappings: [], minimumAge: 18, maximumAge: null },
    };
    profiles = {
      employee: jest.fn(async () => employee),
      get: jest.fn(async () => profile),
    };
    calculateAnnual = jest.fn(() => ({ annualCtc: 1440000 }));
    service = new IncomeTaxService(
      {} as any,
      {
        get: async () => ({
          years: [
            {
              code: 'FY 2026-27',
              startDate: '2026-04-01',
              endDate: '2027-03-31',
            },
          ],
          revisions: [revision],
          published: { 'FY 2026-27:new': 'published' },
        }),
      } as any,
      profiles,
      { findAll: async () => [] } as any,
      { get: async () => ({}) } as any,
      { calculateAnnual, calculateProjection: calculateAnnual } as any,
      { run: (work: () => Promise<unknown>) => work() } as any,
    );
    jest.spyOn(service as any, 'submitted').mockResolvedValue([]);
    persist = jest
      .spyOn(service as any, 'persist')
      .mockResolvedValue({ status: 'calculated' });
  });
  const project = (service: IncomeTaxService) =>
    service.project('employee', 'FY 2026-27');
  it.each(['Monthly', 'monthly', ' MONTHLY '])(
    'accepts saved confirmations and %s payroll',
    async (frequency) => {
      employee.payFrequency = frequency;
      await expect(project(service)).resolves.toEqual({ status: 'calculated' });
      expect(profiles.get).toHaveBeenCalledWith('employee', 'FY 2026-27');
      expect(calculateAnnual).toHaveBeenCalled();
      expect(persist).toHaveBeenCalled();
    },
  );
  it.each([
    ['resident', 'Indian tax residency'],
    ['salaryOnly', 'Salary-only income'],
    ['panOperative', 'PAN operative'],
    ['fullYearEmployment', 'Full-year employment is not confirmed'],
  ])(
    'identifies missing saved %s even if the request could claim otherwise',
    async (field, message) => {
      profile[field] = false;
      await expect(project(service)).rejects.toThrow(message);
      expect(persist).not.toHaveBeenCalled();
    },
  );
  it('reports the actual mid-year hire despite every confirmation being selected', async () => {
    employee.hireDate = new Date('2026-10-06');
    await expect(project(service)).rejects.toThrow(
      'hire date 2026-10-06 is after financial year FY 2026-27 start 2026-04-01',
    );
    expect(calculateAnnual).not.toHaveBeenCalled();
  });
  it('uses the rehire date when employment restarted after year start', async () => {
    employee.rehireDate = new Date('2026-08-01');
    await expect(project(service)).rejects.toThrow('rehire date 2026-08-01');
  });
  it('identifies unsupported payroll frequency', async () => {
    employee.payFrequency = 'Weekly';
    await expect(project(service)).rejects.toThrow(
      'Payroll frequency "Weekly" is unsupported',
    );
  });
  it('requires documented exemption confirmation only when mappings need it', async () => {
    profile.exemptionConditionsConfirmed = false;
    await expect(project(service)).resolves.toEqual({ status: 'calculated' });
    revision.rules.mappings = [{ type: 'exempt' }];
    await expect(project(service)).rejects.toThrow(
      'Confirm documented exemption conditions',
    );
  });
  it('keeps disabled TDS optional', async () => {
    profile.tdsApplicable = false;
    profile.resident = false;
    await expect(project(service)).resolves.toMatchObject({
      status: 'disabled',
      annualTds: 0,
    });
    expect(calculateAnnual).not.toHaveBeenCalled();
  });
});
