import { BadRequestException } from '@nestjs/common';
// Exact rational arithmetic for finite decimal inputs; round only at reporting.
export class Ratio {
  readonly n: bigint;
  readonly d: bigint;
  constructor(n: bigint, d = 1n) {
    if (!d) throw new Error('Division by zero');
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    let a = n < 0n ? -n : n,
      b = d;
    while (b) {
      const r = a % b;
      a = b;
      b = r;
    }
    this.n = n / a;
    this.d = d / a;
  }
  static of(value: number): Ratio {
    if (typeof value !== 'number' || !Number.isFinite(value))
      throw new Error('Invalid decimal');
    const [m, e = '0'] = String(value).split('e');
    const [w, f = ''] = m.split('.');
    const scale = f.length - Number(e);
    return scale >= 0
      ? new Ratio(BigInt(w + f), 10n ** BigInt(scale))
      : new Ratio(BigInt(w + f) * 10n ** BigInt(-scale));
  }
  add(v: Ratio) {
    return new Ratio(this.n * v.d + v.n * this.d, this.d * v.d);
  }
  sub(v: Ratio) {
    return new Ratio(this.n * v.d - v.n * this.d, this.d * v.d);
  }
  mul(v: Ratio) {
    return new Ratio(this.n * v.n, this.d * v.d);
  }
  div(v: Ratio) {
    return new Ratio(this.n * v.d, this.d * v.n);
  }
  money() {
    const sign = this.n < 0n ? -1n : 1n;
    const cents = ((this.n * sign * 200n + this.d) / (2n * this.d)) * sign;
    if (
      cents > BigInt(Number.MAX_SAFE_INTEGER) ||
      cents < -BigInt(Number.MAX_SAFE_INTEGER)
    )
      throw new BadRequestException('Amount outside supported currency range');
    return Number(cents) / 100;
  }
}
