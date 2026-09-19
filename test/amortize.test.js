import { test, assert, assertClose } from './env.js';
import { amortize, byYear, pmt, METHODS } from '../src/core/amortize.js';
import { principalFromPayment, principalFromAnnualPayment, existingDebtAnnualPayment } from '../src/core/invert.js';

test('원리금균등: 교과서 값과 일치한다', () => {
  // 3억원 / 연 4.5% / 30년 → 월 1,520,055.93원
  // 이 기대값은 잔액을 360회 직접 굴려 만기 잔액이 0이 되는 PMT를 이분탐색으로
  // 독립 검산한 값이다(공식과 소수 4자리까지 일치). 기억에서 꺼낸 값이 아니다.
  const r = amortize({ principal: 300_000_000, annualRate: 0.045, termMonths: 360 });
  assertClose(r.monthlyPayment, 1_520_056, 1, '월 상환액');
  assert.equal(r.schedule.length, 360);
  assert.equal(r.schedule[359].closing, 0, '만기 잔액은 0');
});

test('원리금균등: 첫 회차 이자는 원금 × 월이율', () => {
  const r = amortize({ principal: 300_000_000, annualRate: 0.045, termMonths: 360 });
  assertClose(r.schedule[0].interest, 300_000_000 * 0.045 / 12, 1);
});

test('원리금균등: 총상환액 = 원금 + 총이자', () => {
  const r = amortize({ principal: 380_000_000, annualRate: 0.042, termMonths: 420 });
  assertClose(r.totalPayment, 380_000_000 + r.totalInterest, 2);
});

test('원금균등: 첫 회차가 최대, 매 회차 원금은 일정', () => {
  const r = amortize({ principal: 240_000_000, annualRate: 0.05, termMonths: 240, method: METHODS.EQUAL_PRINCIPAL });
  assertClose(r.schedule[0].principal, 240_000_000 / 240, 1);
  assert.equal(r.maxPayment, r.firstPayment, '원금균등은 첫 회차가 최대');
  assert.ok(r.firstPayment > r.lastPayment);
  assert.equal(r.schedule[239].closing, 0);
});

test('무이자(0%)에서도 터지지 않는다', () => {
  const r = amortize({ principal: 120_000_000, annualRate: 0, termMonths: 120 });
  assertClose(r.monthlyPayment, 1_000_000, 1);
  assert.equal(r.totalInterest, 0);
});

test('거치기간: 거치 중에는 원금이 줄지 않고 이자만 낸다', () => {
  const r = amortize({ principal: 200_000_000, annualRate: 0.04, termMonths: 360, graceMonths: 36 });
  assert.equal(r.schedule[0].principal, 0);
  assert.equal(r.schedule[35].closing, 200_000_000, '거치 종료 시점 잔액 = 원금');
  assert.ok(r.schedule[36].principal > 0, '거치 종료 후 원금 상환 시작');
  assert.equal(r.schedule[359].closing, 0);
  assert.ok(r.maxPaymentAfterGrace > r.firstPayment, '거치 끝나면 상환액이 늘어난다');
});

test('만기일시: 만기 직전까지 이자만, 만기에 원금 전액', () => {
  const r = amortize({ principal: 100_000_000, annualRate: 0.06, termMonths: 12, method: METHODS.BULLET });
  assertClose(r.schedule[0].payment, 100_000_000 * 0.06 / 12, 1);
  assertClose(r.schedule[11].principal, 100_000_000, 1);
  assertClose(r.totalInterest, 100_000_000 * 0.06, 2);
});

test('원금 0 / 기간 0 은 빈 결과', () => {
  assert.equal(amortize({ principal: 0, annualRate: 0.04, termMonths: 360 }).schedule.length, 0);
  assert.equal(amortize({ principal: 1e8, annualRate: 0.04, termMonths: 0 }).schedule.length, 0);
});

test('byYear: 연 단위 합계가 월 단위 합계와 같다', () => {
  const r = amortize({ principal: 300_000_000, annualRate: 0.045, termMonths: 360 });
  const years = byYear(r.schedule);
  assert.equal(years.length, 30);
  assertClose(years.reduce((s, y) => s + y.interest, 0), r.totalInterest, 360);
  assertClose(years.reduce((s, y) => s + y.principal, 0), 300_000_000, 360);
});

// ─────────────────────────────── 역산 ───────────────────────────────

test('역산: 원리금균등 왕복이 일치한다', () => {
  const P = 380_000_000;
  const opts = { annualRate: 0.0485, termMonths: 360 };
  const r = amortize({ principal: P, ...opts });
  const back = principalFromPayment({ monthlyPayment: r.monthlyPayment, ...opts });
  assertClose(back, P, 500, '역산 원금');
});

test('역산: 원금균등 왕복이 일치한다', () => {
  const P = 250_000_000;
  const opts = { annualRate: 0.05, termMonths: 240, method: METHODS.EQUAL_PRINCIPAL };
  const r = amortize({ principal: P, ...opts });
  const back = principalFromPayment({ monthlyPayment: r.maxPayment, ...opts });
  assertClose(back, P, 500);
});

test('역산: 거치가 있으면 이분탐색으로도 왕복이 맞는다', () => {
  const P = 200_000_000;
  const opts = { annualRate: 0.04, termMonths: 360, method: METHODS.EQUAL_PRINCIPAL, graceMonths: 24 };
  const r = amortize({ principal: P, ...opts });
  const back = principalFromPayment({ monthlyPayment: r.maxPaymentAfterGrace, ...opts });
  assertClose(back, P, 5000);
});

test('역산: 연 상환가능액 진입점', () => {
  const annual = 24_000_000;
  const p = principalFromAnnualPayment({ annualPayment: annual, annualRate: 0.0485, termMonths: 360 });
  const r = amortize({ principal: p, annualRate: 0.0485, termMonths: 360 });
  assertClose(r.monthlyPayment * 12, annual, 100);
});

test('역산: 상환가능액이 0 이하면 한도 0', () => {
  assert.equal(principalFromPayment({ monthlyPayment: 0, annualRate: 0.04, termMonths: 360 }), 0);
  assert.equal(principalFromPayment({ monthlyPayment: -100, annualRate: 0.04, termMonths: 360 }), 0);
});

test('역산: 만기가 길수록 한도가 커진다 (DSR 산정만기 상한이 필요한 이유)', () => {
  const base = { monthlyPayment: 2_000_000, annualRate: 0.0485 };
  const p30 = principalFromPayment({ ...base, termMonths: 360 });
  const p40 = principalFromPayment({ ...base, termMonths: 480 });
  assert.ok(p40 > p30, '만기를 늘리면 한도가 부풀려진다');
});

// ───────────────────────── 기존부채 연원리금 ─────────────────────────

test('기존부채: 신용대출은 잔액을 산정만기로 분할 + 이자', () => {
  const rules = { 신용대출: { mode: 'amortized', maturityMonths: 60 } };
  const { total } = existingDebtAnnualPayment([{ kind: '신용대출', balance: 50_000_000, rate: 0.06 }], rules);
  // 5,000만 × (12/60) + 5,000만 × 6% = 1,000만 + 300만
  assertClose(total, 13_000_000, 1);
});

test('기존부채: 마이너스통장은 잔액이 아니라 한도금액 기준', () => {
  const rules = { 마이너스통장: { mode: 'limitAmortized', maturityMonths: 60 } };
  const { total } = existingDebtAnnualPayment(
    [{ kind: '마이너스통장', balance: 0, limitAmount: 30_000_000, rate: 0.055 }], rules
  );
  assertClose(total, 30_000_000 * (12 / 60) + 30_000_000 * 0.055, 1);
});

test('기존부채: 없으면 0', () => {
  assert.equal(existingDebtAnnualPayment([], {}).total, 0);
  assert.equal(existingDebtAnnualPayment(undefined, {}).total, 0);
});
