export type TaxRegime = 'old' | 'new';
export interface TaxSlab {
  from: number;
  to: number | null;
  rate: number;
}
export interface TaxabilityMapping {
  componentId: string;
  componentName?: string;
  type: 'taxable' | 'exempt' | 'partial' | 'conditional';
  taxablePercentage?: number;
  exemptAmount?: number;
  legalReference: string;
  conditions?: string;
}
export interface TaxRules {
  ruleVersion: 'salary-only-v1';
  standardDeduction: number;
  rebateLimit: number;
  maximumRebate: number;
  rebateMarginalRelief: boolean;
  cessPercentage: number;
  surcharge: { threshold: number; rate: number }[];
  surchargeMarginalRelief: boolean;
  incomeRounding: 'nearest-ten-ignore-paise' | 'paise';
  liabilityRounding: 'nearest-ten-ignore-paise' | 'paise';
  minimumAge: number;
  maximumAge: number | null;
  slabs: TaxSlab[];
  mappings: TaxabilityMapping[];
  employerContributionsReviewed: boolean;
  legalReferences: string[];
  reviewNote: string;
}
export interface TaxYear {
  code: string;
  name: string;
  startDate: string;
  endDate: string;
  legislation: string;
  ruleVersion: string;
  active: boolean;
}
export interface TaxRevision {
  id: string;
  yearCode: string;
  regime: TaxRegime;
  version: number;
  effectiveDate: string;
  rules: TaxRules;
  createdBy: string;
  createdAt: string;
}
export interface AnnualSalaryInput {
  annual: Record<string, number>;
  components: {
    componentId: string;
    code: string;
    category: string;
    annual: number;
  }[];
}
