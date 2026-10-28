import { IsNumber, Max, Min } from 'class-validator';

export class StatutoryDeductionsDto {
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  wageCap!: number;

  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) @Max(100)
  epfEmployerContributionPercentage!: number;

  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) @Max(100)
  epsEmployerContributionPercentage!: number;

  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) @Max(100)
  epfEmployeeContributionPercentage!: number;

  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) @Max(100)
  esiEmployerContributionPercentage!: number;

  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) @Max(100)
  esiEmployeeContributionPercentage!: number;
}
