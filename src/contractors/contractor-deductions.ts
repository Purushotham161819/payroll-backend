/** Contractor-only arithmetic. No employee formula parser or payroll engine is used. */
export interface DeductionRule {
  calculationType: string;
  calculationValue?: number | null;
  formula?: string | null;
}
type Ratio = { n: bigint; d: bigint };
type Expr =
  | { kind: 'number'; value: Ratio }
  | { kind: 'gross' }
  | { kind: 'unary'; sign: string; value: Expr }
  | { kind: 'binary'; op: string; left: Expr; right: Expr };
function ratio(n: bigint, d = 1n): Ratio {
  if (!d) throw new Error('Deduction formula cannot divide by zero.');
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const gcd = (a: bigint, b: bigint): bigint => {
    a = a < 0n ? -a : a;
    while (b) {
      const t = b;
      b = a % b;
      a = t;
    }
    return a || 1n;
  };
  const g = gcd(n, d);
  n /= g;
  d /= g;
  if (n.toString().length > 80 || d.toString().length > 80)
    throw new Error('Deduction formula is too large.');
  return { n, d };
}
function decimal(text: string): Ratio {
  if (text.length > 32) throw new Error('Formula number is too large.');
  const [whole, fraction = ''] = text.split('.');
  return ratio(
    BigInt((whole || '0') + fraction),
    10n ** BigInt(fraction.length),
  );
}
function operation(op: string, a: Ratio, b: Ratio): Ratio {
  if (op === '+') return ratio(a.n * b.d + b.n * a.d, a.d * b.d);
  if (op === '-') return ratio(a.n * b.d - b.n * a.d, a.d * b.d);
  if (op === '*') return ratio(a.n * b.n, a.d * b.d);
  return ratio(a.n * b.d, a.d * b.n);
}
function parse(text: string): Expr {
  if (!text.trim() || text.length > 1024)
    throw new Error('Enter a Gross Pay formula of at most 1024 characters.');
  const tokens: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    if (/\s/.test(text[cursor])) {
      cursor++;
      continue;
    }
    const match = /^(?:\d+(?:\.\d+)?|\.\d+|grossPay\b|[()+*/%\-])/.exec(
      text.slice(cursor),
    );
    if (!match)
      throw new Error(
        'Formula supports only grossPay, numbers, + - * /, parentheses and %.',
      );
    tokens.push(match[0]);
    cursor += match[0].length;
    if (tokens.length > 256)
      throw new Error('Deduction formula is too complex.');
  }
  let pos = 0,
    depth = 0;
  function atom(): Expr {
    if (++depth > 32)
      throw new Error('Deduction formula is too deeply nested.');
    const token = tokens[pos++];
    let result: Expr;
    if (token === '+' || token === '-')
      result = { kind: 'unary', sign: token, value: atom() };
    else if (token === '(') {
      result = sum();
      if (tokens[pos++] !== ')')
        throw new Error('Unbalanced formula parentheses.');
    } else if (token === 'grossPay') result = { kind: 'gross' };
    else if (token && /^(?:\d|\.)/.test(token))
      result = { kind: 'number', value: decimal(token) };
    else throw new Error('Incomplete deduction formula.');
    if (tokens[pos] === '%') {
      pos++;
      result = {
        kind: 'binary',
        op: '/',
        left: result,
        right: { kind: 'number', value: ratio(100n) },
      };
    }
    depth--;
    return result;
  }
  function product(): Expr {
    let left = atom();
    while (tokens[pos] === '*' || tokens[pos] === '/') {
      const op = tokens[pos++];
      left = { kind: 'binary', op, left, right: atom() };
    }
    return left;
  }
  function sum(): Expr {
    let left = product();
    while (tokens[pos] === '+' || tokens[pos] === '-') {
      const op = tokens[pos++];
      left = { kind: 'binary', op, left, right: product() };
    }
    return left;
  }
  const expression = sum();
  if (pos !== tokens.length) throw new Error('Unexpected formula input.');
  return expression;
}
function evaluate(e: Expr, gross: Ratio): Ratio {
  if (e.kind === 'number') return e.value;
  if (e.kind === 'gross') return gross;
  if (e.kind === 'unary') {
    const r = evaluate(e.value, gross);
    return ratio(e.sign === '-' ? -r.n : r.n, r.d);
  }
  return operation(e.op, evaluate(e.left, gross), evaluate(e.right, gross));
}
export function moneyCents(value: number): number {
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1e9 ||
    !/^\d+(?:\.\d{1,2})?$/.test(String(value))
  )
    throw new Error(
      'Enter a non-negative currency amount up to 1,000,000,000 with at most two decimals.',
    );
  return Math.round(value * 100);
}
export function validateDeductionRule(rule: DeductionRule): void {
  if (rule.calculationType === 'fixed')
    moneyCents(rule.calculationValue as number);
  else if (rule.calculationType === 'percentage') {
    moneyCents(rule.calculationValue as number);
    if (rule.calculationValue! > 100)
      throw new Error('Deduction percentage must be between 0 and 100.');
  } else if (rule.calculationType === 'formula') parse(rule.formula || '');
  else
    throw new Error(
      'Configure this earlier manual component as Percentage, Fixed Amount or a valid Gross Pay formula before payment.',
    );
}
export function deductionAmount(grossPay: number, rule: DeductionRule): number {
  const grossCents = moneyCents(grossPay);
  validateDeductionRule(rule);
  let result: Ratio;
  if (rule.calculationType === 'fixed') return rule.calculationValue!;
  if (rule.calculationType === 'percentage')
    result = ratio(
      BigInt(grossCents) * BigInt(Math.round(rule.calculationValue! * 100)),
      10000n,
    );
  else {
    const amount = evaluate(
      parse(rule.formula || ''),
      ratio(BigInt(grossCents), 100n),
    );
    result = ratio(amount.n * 100n, amount.d);
  }
  if (result.n < 0n || result.n > 100000000000n * result.d)
    throw new Error(
      'Calculated deduction must be non-negative and no greater than 1,000,000,000.',
    );
  const cents = (result.n * 2n + result.d) / (2n * result.d);
  return Number(cents) / 100;
}
export function calculateContractorPayment(
  grossPay: number,
  rules: DeductionRule[],
) {
  const grossCents = moneyCents(grossPay);
  if (rules.length > 100)
    throw new Error(
      'A contractor can have at most 100 assigned deduction components.',
    );
  const amounts = rules.map((r) => deductionAmount(grossPay, r));
  const deductions = amounts.reduce(
    (sum, amount) => sum + Math.round(amount * 100),
    0,
  );
  return {
    grossPay: grossCents / 100,
    amounts,
    totalDeductions: deductions / 100,
    netPayment: (grossCents - deductions) / 100,
  };
}
