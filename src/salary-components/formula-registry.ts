export interface FormulaVariable {
  id: string;
  label: string;
  aliases?: string[];
  valueType: 'amount' | 'rate';
  dependencies: string[];
  componentCode?: string;
  setting?: string;
  available?: boolean;
}
export const FORMULA_VARIABLES: FormulaVariable[] = [
  {
    id: 'annualCtc',
    label: 'Annual CTC',
    valueType: 'amount',
    dependencies: [],
  },
  {
    id: 'annualBasicSalary',
    label: 'Annual Basic Salary',
    valueType: 'amount',
    dependencies: ['annualGrossWages'],
    componentCode: 'BASIC',
  },
  {
    id: 'annualDearnessAllowance',
    label: 'Annual Dearness Allowance',
    valueType: 'amount',
    dependencies: ['annualBasicSalary'],
    componentCode: 'DA',
  },
  {
    id: 'annualRetainingAllowance',
    label: 'Annual Retaining Allowance',
    valueType: 'amount',
    dependencies: ['annualBasicSalary'],
    componentCode: 'RA',
  },
  {
    id: 'annualGrossWages',
    label: 'Annual Gross Wages',
    valueType: 'amount',
    dependencies: [],
  },
  {
    id: 'annualCoreWages',
    label: 'Annual Core Wages',
    valueType: 'amount',
    dependencies: [
      'annualBasicSalary',
      'annualDearnessAllowance',
      'annualRetainingAllowance',
    ],
  },
  {
    id: 'annualTotalAllowances',
    label: 'Annual Total Allowances',
    valueType: 'amount',
    dependencies: ['allowance_components'],
  },
  {
    id: 'annualExcessAllowance',
    label: 'Annual Excess Allowance',
    valueType: 'amount',
    dependencies: ['annualTotalAllowances', 'annualGrossWages'],
  },
  {
    id: 'annualComplianceWageBase',
    label: 'Annual Compliance Wage Base',
    aliases: ['Compliance Wage Base'],
    valueType: 'amount',
    dependencies: ['annualCoreWages', 'annualExcessAllowance'],
  },
  {
    id: 'annualEpfCeilingLimit',
    label: 'Annual EPF Ceiling Limit',
    valueType: 'amount',
    dependencies: [],
    setting: 'wageCap',
  },
  {
    id: 'annualEsiCeilingLimit',
    label: 'Annual ESI Wage Ceiling Limit',
    valueType: 'amount',
    dependencies: [],
    setting: 'annualEsiCeilingLimit',
  },
  {
    id: 'epfEmployerContributionRate',
    label: 'EPF Employer Contribution Rate',
    valueType: 'rate',
    dependencies: [],
    setting: 'epfEmployerContributionPercentage',
  },
  {
    id: 'epsEmployerContributionRate',
    label: 'EPS Employer Contribution Rate',
    valueType: 'rate',
    dependencies: [],
    setting: 'epsEmployerContributionPercentage',
  },
  {
    id: 'esiEmployerContributionRate',
    label: 'ESI Employer Contribution Rate',
    valueType: 'rate',
    dependencies: [],
    setting: 'esiEmployerContributionPercentage',
  },
  {
    id: 'epfEmployeeContributionRate',
    label: 'EPF Employee Contribution Rate',
    valueType: 'rate',
    dependencies: [],
    setting: 'epfEmployeeContributionPercentage',
  },
  {
    id: 'esiEmployeeContributionRate',
    label: 'ESI Employee Contribution Rate',
    valueType: 'rate',
    dependencies: [],
    setting: 'esiEmployeeContributionPercentage',
  },
  {
    id: 'employerEpfContribution',
    label: 'Employer EPF Contribution',
    valueType: 'amount',
    dependencies: [
      'annualCoreWages',
      'annualEpfCeilingLimit',
      'epfEmployerContributionRate',
    ],
  },
  {
    id: 'employerEpsContribution',
    label: 'Employer EPS Contribution',
    valueType: 'amount',
    dependencies: [
      'annualCoreWages',
      'annualEpfCeilingLimit',
      'epsEmployerContributionRate',
    ],
  },
  {
    id: 'employerEsiContribution',
    label: 'Employer ESI Contribution',
    valueType: 'amount',
    dependencies: [
      'annualComplianceWageBase',
      'annualEsiCeilingLimit',
      'esiEmployerContributionRate',
    ],
  },
];
export const FORMULA_VARIABLE_BY_ID = new Map(
  FORMULA_VARIABLES.map((v) => [v.id, v]),
);
export const FORMULA_COMPARISONS = ['=', '!=', '<', '<=', '>', '>='] as const;
export function compareFormula(operator: string, difference: bigint): boolean {
  switch (operator) {
    case '=':
      return difference === 0n;
    case '!=':
      return difference !== 0n;
    case '<':
      return difference < 0n;
    case '<=':
      return difference <= 0n;
    case '>':
      return difference > 0n;
    case '>=':
      return difference >= 0n;
    default:
      throw new Error('Unsupported formula comparison.');
  }
}
