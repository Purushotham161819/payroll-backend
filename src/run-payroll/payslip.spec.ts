import { payslipPdf } from './payslip';
import { PayCheckSnapshot } from './schemas/payroll-run.schema';
import { inspectPdf } from '../../test/pdf-document';
const snapshot = (): PayCheckSnapshot => ({
  id: 'employee',
  employeeId: 'employee',
  employeeCode: 'EMP001',
  firstName: 'Ada',
  lastName: 'Example',
  grossPay: 1000,
  employerContributions: 75,
  deductions: 50,
  netPay: 950,
  calculation: {},
  components: [
    {
      name: 'Visible salary',
      category: 'earning',
      amount: 1000,
      showInPayslip: true,
    },
    {
      name: 'Private internal earning',
      category: 'earning',
      amount: 123.45,
      showInPayslip: false,
    },
    {
      name: 'Visible deduction',
      category: 'deduction',
      amount: 50,
      showInPayslip: true,
    },
    {
      name: 'Private internal deduction',
      category: 'deduction',
      amount: 12.34,
      showInPayslip: false,
    },
  ],
});
async function read(check = snapshot(), address?: any) {
  const bytes = Buffer.from(
    payslipPdf('Example Organization', '2026-11', '2026-11-30', check, address),
    'base64',
  );
  return { ...(await inspectPdf(bytes)), bytes };
}
describe('Black-and-white pay check PDF from finalized snapshot', () => {
  it('retains Indian grouping for all requested monetary scales in actual PDF text', async () => {
    const check = snapshot();
    const amounts = [1000, 10000, 100000, 1000000, 10000000, 1400000.5];
    check.components = amounts.map((amount, index) => ({
      name: 'Visible component ' + index, category: 'earning', amount, showInPayslip: true,
    }));
    check.grossPay = amounts.reduce((sum, amount) => sum + amount, 0);
    check.deductions = 0;
    check.netPay = check.grossPay;
    const result = await read(check);
    for (const amount of ['1,000.00', '10,000.00', '1,00,000.00', '10,00,000.00', '1,00,00,000.00', '14,00,000.50'])
      expect(result.text).toContain(String.fromCodePoint(0x20b9) + amount);
  });
  it('prints snapshot totals and only approved component names without exposing employer/internal values', async () => {
    const check = snapshot(),
      before = structuredClone(check);
    const result = await read(check);
    expect(result.bytes.subarray(0, 5).toString()).toBe('%PDF-');
    for (const value of [
      'Example Organization',
      'November 2026',
      '30-Nov-2026',
      'EMP001',
      'Ada, Example',
      'Visible salary',
      'Visible deduction',
      '950.00',
      'Deductions',
      'Earnings and Allowances',
      'Net Payment',
    ])
      expect(result.text).toContain(value);
    expect(result.text).toContain(String.fromCodePoint(0x20b9));
    expect(result.text).not.toContain('Private internal');
    expect(result.text).not.toContain('123.45');
    expect(result.text).not.toContain('12.34');
    expect(result.text).not.toContain('75.00');
    expect(result.text).not.toContain('Employer Contributions');
    expect(check).toEqual(before);
  });
  it.each([
    [
      {
        addressLine1: '123 Main Street',
        addressLine2: 'Floor 2',
        city: 'Dallas',
        state: 'Texas',
        zipCode: '00750',
        country: 'United States',
      },
      'Dallas, Texas, 00750, United States',
      true,
    ],
    [
      {
        addressLine1: '123 Main Street',
        addressLine2: '',
        city: 'Dallas',
        state: '',
        zipCode: null,
        country: 'United States',
      },
      'Dallas, United States',
      false,
    ],
    [{}, '', false],
  ])(
    'formats available address lines without blank placeholders or dangling commas',
    async (address, locality, secondLine) => {
      const result = await read(snapshot(), address);
      if (locality) expect(result.text).toContain(locality);
      expect(result.text.includes('Floor 2')).toBe(secondLine);
      expect(result.text).not.toMatch(/undefined|null|,\s*,/);
      expect(result.text.split('Example Organization').length - 1).toBe(1);
    },
  );
  it('shows applied TDS once, copies total deductions and net, and honors zero/hidden TDS visibility', async () => {
    const check = snapshot();
    check.tds = 25;
    check.tax = { amount: 25 } as any;
    check.deductions = 75;
    check.netPay = 925;
    check.components.push({
      name: 'Income Tax / TDS',
      category: 'deduction',
      amount: 25,
      showInPayslip: true,
    });
    let result = await read(check);
    expect((result.text.match(/\bTDS\b/g) ?? []).length).toBe(1);
    expect(result.text).toContain('25.00');
    expect(result.text).toContain('75.00');
    expect(result.text).toContain('925.00');
    check.components.at(-1)!.showInPayslip = false;
    result = await read(check);
    expect(result.text).not.toContain('TDS');
    expect(result.text).not.toContain(String.fromCodePoint(0x20b9) + '25.00');
    check.tds = 0;
    check.tax!.amount = 0;
    check.components.at(-1)!.amount = 0;
    check.components.at(-1)!.showInPayslip = true;
    result = await read(check);
    expect((result.text.match(/\bTDS\b/g) ?? []).length).toBe(1);
  });
  it('wraps long names across A4 pages, repeats table headings, and keeps final totals on the last page', async () => {
    const check = snapshot();
    check.components = Array.from({ length: 100 }, (_, index) => ({
      name:
        'Component ' +
        String(index).padStart(3, '0') +
        ' Long dynamic allowance description '.repeat(5),
      category: 'allowance',
      amount: 10,
      showInPayslip: true,
    }));
    const result = await read(check);
    expect(result.pageCount).toBeGreaterThan(1);
    expect(result.text.indexOf('Component 000')).toBeLessThan(
      result.text.indexOf('Component 099'),
    );
    for (const viewport of result.pageSizes) {
      expect(viewport.width).toBeCloseTo(595.28, 0);
      expect(viewport.height).toBeCloseTo(841.89, 0);
    }
    expect(result.texts.slice(1, -1).join(' ')).not.toContain('Net Payment');
    expect(result.texts.at(-1)).toContain('Deductions');
    expect(result.texts.at(-1)).toContain('Net Payment');
    expect(
      result.texts.filter((text) => text.includes('Earnings and Allowances'))
        .length,
    ).toBeGreaterThan(1);
  });
  it('retains the measured reference anchors and typography without extra design elements', async () => {
    const result = await read();
    for (const [label, x, y] of [
      ['Example Organization', 49.68, 140.42],
      ['EMP001', 49.68, 227.42],
      ['Pay Period', 373.27, 308.45],
      ['Earnings and Allowances', 55.08, 386.81],
      ['Deductions', 310.99, 515.23],
    ] as const) {
      const item = result.positions.find((item) => item.text === label)!;
      expect(item).toBeDefined();
      expect(item.x).toBeCloseTo(x, 2);
      expect(item.y).toBeCloseTo(y, 2);
      expect(item.size).toBeCloseTo(11.04, 2);
    }
    expect(result.text).not.toMatch(
      /PAY CHECK|Description|Page 1|Payment has not been confirmed/,
    );
    expect(
      result.positions.find(
        (item) => item.text === 'Net Payment' && item.x === 55.08,
      )!.y,
    ).toBeCloseTo(658.06, 2);
  });
  it('renders the actual PDF entirely in grayscale', async () => {
    const bytes = Buffer.from(
      payslipPdf('Example Organization', '2026-11', '2026-11-30', snapshot()),
      'base64',
    );
    expect((await inspectPdf(bytes, true)).coloredPixels).toBe(0);
  });
});

it('renders designation immediately below the name and embeds the logo only when supplied', async () => {
 const check = {...snapshot(), designation: 'Software Engineer'};
 const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAADUlEQVR4XmP4z8AARAAI/gH/egE/eAAAAABJRU5ErkJggg==';
 const generate = (logo?: string) => Buffer.from(payslipPdf('Org A', '2026-11', '2026-11-30', check, undefined, logo), 'base64');
 const withLogo = generate(png), withoutLogo = generate();
 expect(withLogo.toString('latin1')).toContain('/Subtype /Image');
 expect(withoutLogo.toString('latin1')).not.toContain('/Subtype /Image');
 const pdf = await inspectPdf(withLogo);
 expect(pdf.text.indexOf('Software Engineer')).toBeGreaterThan(pdf.text.indexOf('Ada, Example'));
 const name = pdf.positions.find(p => p.text === 'Ada, Example')!;
 const designation = pdf.positions.find(p => p.text === 'Software Engineer')!;
 expect(designation.x).toBeCloseTo(name.x);
 expect(designation.y).toBeGreaterThan(name.y);
 expect(designation.size).toBeLessThan(name.size);
 expect(pdf.text).toContain('950.00');
});
