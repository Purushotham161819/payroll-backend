import { BadRequestException, Injectable } from '@nestjs/common';
import { StatutoryDeductionsService } from './statutory-deductions.service';
import { StatutoryDeductionsDto } from './statutory-deductions.dto';

export type ContributionRate = Exclude<
  keyof StatutoryDeductionsDto,
  'wageCap' | 'annualEsiCeilingLimit' | 'isEpfCeilingApplicable'
>;

@Injectable()
export class StatutoryContributionService {
  constructor(private readonly settings: StatutoryDeductionsService) {}
  // Callers determine eligibility and contribution base using future explicit rules.
  // This arithmetic foundation applies no cap, allocation, or rounding policy.
  async calculate(contributionBase: number, rate: ContributionRate) {
    if (!Number.isFinite(contributionBase) || contributionBase < 0)
      throw new BadRequestException(
        'Contribution base must be a finite, non-negative number.',
      );
    const config = await this.settings.get();
    if (!config)
      throw new BadRequestException(
        'Configure statutory deductions before calculating contributions.',
      );
    const allowed: ContributionRate[] = [
      'epfEmployerContributionPercentage',
      'epsEmployerContributionPercentage',
      'epfEmployeeContributionPercentage',
      'esiEmployerContributionPercentage',
      'esiEmployeeContributionPercentage',
    ];
    if (!allowed.includes(rate))
      throw new BadRequestException('Unknown contribution rate.');
    const percentage = config[rate];
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100)
      throw new BadRequestException(
        'Configured contribution percentage is invalid.',
      );
    const amount = contributionBase * (percentage / 100);
    return {
      contributionBase,
      percentage,
      amount,
      configuredWageCap: config.wageCap,
    };
  }
}
