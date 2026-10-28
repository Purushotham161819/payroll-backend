import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { StatutoryDeductions } from './statutory-deductions.schema';
import { StatutoryDeductionsDto } from './statutory-deductions.dto';

@Injectable()
export class StatutoryDeductionsService {
  constructor(
    @InjectModel(StatutoryDeductions.name)
    private readonly model: Model<StatutoryDeductions>,
  ) {}
  async get() {
    try {
      return await this.model.findById('current').lean().exec();
    } catch {
      throw new ServiceUnavailableException(
        'Unable to load statutory deductions. Please try again.',
      );
    }
  }
  async save(dto: StatutoryDeductionsDto) {
    const values = {
      ...(dto.annualEsiCeilingLimit !== undefined
        ? { annualEsiCeilingLimit: dto.annualEsiCeilingLimit }
        : {}),
      wageCap: dto.wageCap,
      epfEmployerContributionPercentage: dto.epfEmployerContributionPercentage,
      epsEmployerContributionPercentage: dto.epsEmployerContributionPercentage,
      ...(dto.epfEmployeeContributionPercentage !== undefined
        ? {
            epfEmployeeContributionPercentage:
              dto.epfEmployeeContributionPercentage,
          }
        : {}),
      esiEmployerContributionPercentage: dto.esiEmployerContributionPercentage,
      ...(dto.esiEmployeeContributionPercentage !== undefined
        ? {
            esiEmployeeContributionPercentage:
              dto.esiEmployeeContributionPercentage,
          }
        : {}),
    };
    const update = (upsert: boolean) =>
      this.model
        .findOneAndUpdate(
          { _id: 'current' },
          {
            $set: values,
            $setOnInsert: {
              // Retain legacy values on updates; initialize absent employee settings only on first save.
              ...(dto.epfEmployeeContributionPercentage === undefined
                ? { epfEmployeeContributionPercentage: 0 }
                : {}),
              ...(dto.esiEmployeeContributionPercentage === undefined
                ? { esiEmployeeContributionPercentage: 0 }
                : {}),
            },
          },
          { upsert, returnDocument: 'after', runValidators: true },
        )
        .lean()
        .exec();
    try {
      return await update(true);
    } catch (error) {
      // Another writer may have inserted the singleton between matching and upserting.
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 11000
      ) {
        try {
          const saved = await update(false);
          if (saved) return saved;
        } catch {
          /* report the save failure below */
        }
      }
      throw new ServiceUnavailableException(
        'Unable to save statutory deductions. Please try again.',
      );
    }
  }
}
