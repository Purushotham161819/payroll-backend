import { jsPDF } from 'jspdf';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PayCheckSnapshot } from './schemas/payroll-run.schema';
export interface PayslipAddress {
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
}
let fonts: { normal: string; bold: string } | undefined;
const clean = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';
// Monetary cells are copied from the finalized snapshot, never recalculated.
export function payslipPdf(
  organization: string,
  period: string,
  paymentDate: string,
  check: PayCheckSnapshot,
  address?: PayslipAddress,
  logo?: string,
): string {
  fonts ??= {
    normal: readFileSync(join(__dirname, 'fonts/Carlito-Regular.ttf')).toString(
      'base64',
    ),
    bold: readFileSync(join(__dirname, 'fonts/Carlito-Bold.ttf')).toString(
      'base64',
    ),
  };
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: [595.32, 841.92],
    putOnlyUsedFonts: true,
    compress: true,
  });
  for (const style of ['normal', 'bold'] as const) {
    doc.addFileToVFS('Carlito-' + style + '.ttf', fonts[style]);
    doc.addFont('Carlito-' + style + '.ttf', 'Carlito', style);
  }
  doc.setFont('Carlito', 'normal');
  doc.setTextColor(0);
  if (logo) {
    const image = doc.getImageProperties(logo);
    const scale = Math.min(110 / image.width, 65 / image.height);
    const width = image.width * scale, height = image.height * scale;
    doc.addImage(logo, image.fileType, 545 - width, 55, width, height);
  }
  const money = (value: number) =>
    new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  const payPeriod = new Intl.DateTimeFormat('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(period + '-01T00:00:00Z'));
  const dateParts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).formatToParts(new Date(paymentDate + 'T00:00:00Z'));
  const paidOn = ['day', 'month', 'year']
    .map((type) => dateParts.find((part) => part.type === type)!.value)
    .join('-');

  // PDF points measured from the supplied reference; values remain snapshot data.
  const fontSize = 11.04,
    lineHeight = 14.2,
    bottom = 792;
  let y = 140.42;
  const setFont = (bold = false) => {
    doc.setFont('Carlito', bold ? 'bold' : 'normal');
    doc.setFontSize(fontSize);
  };
  const nextPage = () => {
    doc.addPage();
    y = 60;
  };
  const text = (value: string) => {
    if (!value) return;
    setFont();
    for (const line of doc.splitTextToSize(value, 495) as string[]) {
      if (y > bottom) nextPage();
      doc.text(line, 49.68, y);
      y += 14.48;
    }
  };
  text(clean(organization));
  text(clean(address?.addressLine1));
  text(clean(address?.addressLine2));
  text(
    [address?.city, address?.state, address?.zipCode, address?.country]
      .map(clean)
      .filter(Boolean)
      .join(', '),
  );
  y = Math.max(227.42, y + 29.08);
  text(check.employeeCode ?? check.employeeId);
  text([check.firstName, check.lastName].map(clean).filter(Boolean).join(', '));
  if (clean(check.designation)) {
    doc.setFontSize(9);
    for (const line of doc.splitTextToSize(clean(check.designation), 495) as string[]) {
      doc.text(line, 49.68, y);
      y += 12;
    }
  }
  const row = (
    label: string,
    value: string,
    left: number,
    colon: number,
    right: number,
    shaded = false,
    boldValue = false,
  ) => {
    setFont(true);
    const labels = doc.splitTextToSize(label, colon - left - 2) as string[];
    setFont(boldValue);
    const values = doc.splitTextToSize(value, right - colon - 10) as string[];
    const lines = Math.max(labels.length, values.length);
    if (shaded) {
      doc.setFillColor(242, 242, 242);
      doc.rect(
        left - 5.4,
        y - 10.5,
        right - left + 10.8,
        lines * lineHeight,
        'F',
      );
    }
    setFont(true);
    doc.text(labels, left, y, { lineHeightFactor: lineHeight / fontSize });
    doc.text(':', colon, y);
    setFont(boldValue);
    values.forEach((line, index) =>
      doc.text(line, right, y + index * lineHeight, { align: 'right' }),
    );
    y += lines * lineHeight;
  };
  y = Math.max(308.45, y + 52.07);
  if (y + 3 * lineHeight > bottom) nextPage();
  row('Pay Period', payPeriod, 373.27, 442, 539.8, false, true);
  row('Payment Date', paidOn, 373.27, 442, 539.8, true);
  row('Net Payment', money(check.netPay), 373.27, 442, 539.8);
  y = Math.max(386.81, y + 35.76);
  // Exclude only the engine's appended synthetic TDS row from ordinary deductions.
  const last = check.components.at(-1);
  const syntheticTds =
    !!check.tax &&
    last?.name === 'Income Tax / TDS' &&
    last.category === 'deduction' &&
    last.amount === check.tax.amount
      ? check.components.length - 1
      : -1;
  const visible = check.components.filter(
    (c, i) => c.showInPayslip === true && i !== syntheticTds,
  );

  const table = (
    title: string,
    body: string[][],
    total: number,
    rightSide = false,
  ) => {
    const left = rightSide ? 310.99 : 55.08;
    const colon = rightSide ? 415.75 : 174.5;
    const right = rightSide ? 541.2 : 278;
    const heading = () => {
      setFont(true);
      doc.text(title, left, y);
      doc.setFillColor(242, 242, 242);
      // Blank gray band below the heading, as in the reference.
      doc.rect(left - 5.4, y + 3.62, right - left + 10.8, lineHeight, 'F');
      y += 28.32;
    };
    if (y + 3 * lineHeight > bottom) nextPage();
    heading();
    [...body, ['Total', money(total)]].forEach(([label, value], index) => {
      setFont(true);
      const labels = doc.splitTextToSize(label, colon - left - 2) as string[];
      setFont();
      const values = doc.splitTextToSize(value, right - colon - 10) as string[];
      const lines = Math.max(labels.length, values.length);
      if (y + lines * lineHeight > bottom) {
        nextPage();
        heading();
      }
      let offset = 0;
      while (offset < lines) {
        const count = Math.max(1, Math.floor((bottom - y) / lineHeight));
        row(
          labels.slice(offset, offset + count).join('\n'),
          values.slice(offset, offset + count).join('\n'),
          left,
          colon,
          right,
          index % 2 === 1,
        );
        offset += count;
        if (offset < lines) {
          nextPage();
          heading();
        }
      }
    });
  };
  table(
    'Earnings and Allowances',
    visible
      .filter((c) => c.category !== 'deduction')
      .map((c) => [c.name, money(c.amount)]),
    check.grossPay,
  );
  // Extra dynamic rows move subsequent sections down while retaining reference gaps.
  y = Math.max(515.23, y + 43.28);
  const deductions = visible
    .filter((c) => c.category === 'deduction')
    .map((c) => [c.name, money(c.amount)]);
  if (syntheticTds >= 0 && last?.showInPayslip === true)
    deductions.push(['TDS', money(check.tds ?? check.tax!.amount)]);
  else if (syntheticTds < 0 && (check.tds ?? 0) > 0)
    deductions.push(['TDS', money(check.tds!)]);
  table('Deductions', deductions, check.deductions, true);
  y = Math.max(658.06, y + 43.43);
  if (y + lineHeight > bottom) nextPage();
  row('Net Payment', money(check.netPay), 55.08, 154.15, 278);
  return Buffer.from(doc.output('arraybuffer')).toString('base64');
}
