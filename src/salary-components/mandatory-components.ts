export const MANDATORY_COMPONENTS = [
  { code: 'BASIC', name: 'Basic Salary' },
  { code: 'DA', name: 'Dearness Allowance' },
  { code: 'RA', name: 'Retaining Allowance' },
] as const;
export function mandatoryComponent(code: string) {
  return MANDATORY_COMPONENTS.find((component) => component.code === code);
}
