import { StatutoryContributionService } from './statutory-contribution.service';
import { StatutoryDeductionsService } from './statutory-deductions.service';
describe('Configured contribution arithmetic', () => {
  const get = jest.fn();
  const service = new StatutoryContributionService({get} as unknown as StatutoryDeductionsService);
  beforeEach(() => get.mockReset());
  it('uses the saved rate and a separately supplied base without silently applying the cap', async () => {
    get.mockResolvedValue({wageCap:10000,epfEmployeeContributionPercentage:12,epsEmployerContributionPercentage:5});
    expect(await service.calculate(15000,'epfEmployeeContributionPercentage')).toEqual({contributionBase:15000,percentage:12,amount:1800,configuredWageCap:10000});
    expect((await service.calculate(15000,'epsEmployerContributionPercentage')).amount).toBe(750);
    get.mockResolvedValue({wageCap:10000,epfEmployeeContributionPercentage:0});
    expect((await service.calculate(15000,'epfEmployeeContributionPercentage')).amount).toBe(0);
  });
  it('requires saved configuration and valid bases', async () => {
    get.mockResolvedValue(null);
    await expect(service.calculate(0,'esiEmployeeContributionPercentage')).rejects.toThrow('Configure');
    for (const base of [NaN,Infinity,-1]) await expect(service.calculate(base,'esiEmployeeContributionPercentage')).rejects.toThrow('base');
  });
});
