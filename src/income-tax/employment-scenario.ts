import { BadRequestException } from '@nestjs/common';
import { amount } from './tax-engine';

export function employmentScenario(profile: any) {
  const scenario = profile.employmentScenario ?? null;
  if (scenario !== null && !['first_job', 'job_change'].includes(scenario))
    throw new BadRequestException(
      'Select First job or Job change for this financial year.',
    );
  if (scenario !== 'job_change')
    return {
      employmentScenario: scenario,
      previousEmployerGrossWages: 0,
      previousEmployerExemptWages: 0,
      previousEmployerTds: 0,
      previousEmployerExemptionsVerified: false,
    };
  for (const [field, label] of [
    ['previousEmployerGrossWages', 'Previous employer gross wages'],
    ['previousEmployerExemptWages', 'Previous employer exempt wages'],
    ['previousEmployerTds', 'Previous employer TDS'],
  ]) {
    amount(profile[field], label);
    if (
      Math.abs(profile[field] * 100 - Math.round(profile[field] * 100)) > 0.001
    )
      throw new BadRequestException(
        `${label} must have at most two decimal places.`,
      );
  }
  if (profile.previousEmployerExemptWages > profile.previousEmployerGrossWages)
    throw new BadRequestException(
      'Previous employer exempt wages cannot exceed gross wages.',
    );
  if (
    profile.previousEmployerExemptWages > 0 &&
    profile.previousEmployerExemptionsVerified !== true
  )
    throw new BadRequestException(
      'Verify documented previous-employer exemptions before calculating TDS.',
    );
  return {
    employmentScenario: scenario,
    previousEmployerGrossWages: profile.previousEmployerGrossWages,
    previousEmployerExemptWages: profile.previousEmployerExemptWages,
    previousEmployerTds: profile.previousEmployerTds,
    previousEmployerExemptionsVerified:
      profile.previousEmployerExemptionsVerified === true,
  };
}
