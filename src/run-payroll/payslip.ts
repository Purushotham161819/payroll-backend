import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { PayCheckSnapshot } from './schemas/payroll-run.schema';

export function payslipPdf(
  organization: string,
  period: string,
  paymentDate: string,
  check: PayCheckSnapshot,
): string {
  const doc = new jsPDF();
  const money = (amount: number) => 'INR ' + amount.toFixed(2);
  doc.setFontSize(18);
  const heading = doc.splitTextToSize(organization, 175) as string[];
  doc.text(heading, 18, 20);
  let y = 25 + heading.length * 8;
  doc.setFontSize(14);
  doc.text('PAYSLIP', 18, y);
  doc.setFontSize(10);
  const info = [
    `Pay period: ${new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(period + '-01T00:00:00Z'))}    Payment date: ${paymentDate}`,
    `Employee: ${check.firstName} ${check.lastName}`,
    `Employee ID: ${check.employeeCode ?? check.employeeId}`,
    'Submitted payroll. Payment has not been confirmed.',
  ].flatMap((line) => doc.splitTextToSize(line, 175) as string[]);
  doc.text(info, 18, y + 9);
  y += 14 + info.length * 5;
  const visible = check.components.filter((c) => c.showInPayslip === true);
  const body: string[][] = [];
  for (const [label, deduction] of [
    ['Earnings', false],
    ['Deductions', true],
  ] as const) {
    body.push([label, '']);
    visible
      .filter((c) => (c.category === 'deduction') === deduction)
      .forEach((c) => body.push([c.name, money(c.amount)]));
  }
  autoTable(doc, {
    startY: y,
    head: [['Salary component', 'Monthly amount']],
    body,
    foot: [
      ['Gross Pay', money(check.grossPay)],
      ['Employer Contributions (separate)', money(check.employerContributions)],
      ['Total Employee Deductions', money(check.deductions)],
      ['NET Pay', money(check.netPay)],
    ],
    theme: 'striped',
    margin: { left: 18, right: 18, bottom: 20 },
    styles: { fontSize: 10, cellPadding: 3, overflow: 'linebreak' },
    columnStyles: { 0: { cellWidth: 120 }, 1: { halign: 'right' } },
    headStyles: { fillColor: [25, 85, 64] },
    footStyles: { fillColor: [235, 243, 238], textColor: [25, 55, 40] },
    showFoot: 'lastPage',
  });
  return Buffer.from(doc.output('arraybuffer')).toString('base64');
}
