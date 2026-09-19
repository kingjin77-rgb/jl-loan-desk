import { test, assert, assertClose } from './env.js';
import { POLICIES, baseInput } from './fixtures/policies.js';
import { derive } from '../src/state/derive.js';
import { buildTimeline } from '../src/core/timeline.js';
import { jungdogeumPlan } from '../src/core/jungdogeum.js';
import { janggeumPlan } from '../src/core/janggeum.js';
import { daysBetween, addMonths, expandYearMonth, monthsBetween } from '../src/core/dates.js';

/** 분양가 5억, 계약금 10% / 중도금 6회 × 10% / 잔금 30% */
const SCHEDULE = {
  계약금: { ratio: 0.10, date: '2026-03-20' },
  중도금: {
    회차수: 6, ratioPerRound: 0.10, loanEligible: true, interestMode: '후불제',
    rounds: [
      { seq: 1, ratio: 0.10, date: '2026-09-20' },
      { seq: 2, ratio: 0.10, date: '2027-01-20' },
      { seq: 3, ratio: 0.10, date: '2027-05-20' },
      { seq: 4, ratio: 0.10, date: '2027-09-20' },
      { seq: 5, ratio: 0.10, date: '2028-01-20' },
      { seq: 6, ratio: 0.10, date: '2028-04-20' },
    ],
  },
  잔금: { ratio: 0.30, date: null },
};

const PRICE = 500_000_000;
const CONVERSION = '2028-06-01';

// ─────────────────────────── 날짜 ───────────────────────────

test('날짜: 경과일수는 실제 일수(ACT)', () => {
  assert.equal(daysBetween('2026-01-01', '2026-01-31'), 30);
  assert.equal(daysBetween('2026-01-01', '2027-01-01'), 365);
  assert.equal(daysBetween('2028-01-01', '2029-01-01'), 366, '2028년은 윤년');
});

test('날짜: 말일 가산은 그 달의 말일로 잘린다', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(addMonths('2026-03-15', 12), '2027-03-15');
});

test('날짜: 연월만 있으면 그 달 1일(또는 말일)로 확장', () => {
  assert.equal(expandYearMonth('2028-06'), '2028-06-01');
  assert.equal(expandYearMonth('2028-06', { endOfMonth: true }), '2028-06-30');
  assert.equal(expandYearMonth('2028-06-15'), '2028-06-15');
});

test('날짜: 개월 수는 일자를 넘겨야 1개월로 센다', () => {
  assert.equal(monthsBetween('2026-01-15', '2026-02-14'), 0);
  assert.equal(monthsBetween('2026-01-15', '2026-02-15'), 1);
});

// ────────────────────────── 타임라인 ──────────────────────────

test('타임라인: 회차 금액과 비율 합계가 맞는다', () => {
  const t = buildTimeline({ totalPrice: PRICE, paymentSchedule: SCHEDULE, conversionDate: CONVERSION, jungdogeumRatio: 1 });
  assertClose(t.totals.비율합계, 1, 1e-9);
  assertClose(t.totals.계약금, 50_000_000, 1);
  assertClose(t.totals.중도금, 300_000_000, 1);
  assertClose(t.totals.잔금, 150_000_000, 1);
  assert.equal(t.warnings.length, 0);
});

test('타임라인: 날짜 없는 잔금은 잔금 기표일로 해석된다', () => {
  const t = buildTimeline({ totalPrice: PRICE, paymentSchedule: SCHEDULE, conversionDate: CONVERSION });
  const 잔금 = t.events.find((e) => e.kind === '잔금');
  assert.equal(잔금.date, CONVERSION);
});

test('타임라인: 계약금 분납이 개별 이벤트로 쪼개진다', () => {
  const t = buildTimeline({
    totalPrice: PRICE, conversionDate: CONVERSION,
    paymentSchedule: {
      ...SCHEDULE,
      계약금: { ratio: 0.10, 분납: [{ ratio: 0.05, date: '2026-03-20' }, { ratio: 0.05, date: '2026-05-20' }] },
    },
  });
  assert.equal(t.events.filter((e) => e.kind === '계약금').length, 2);
  assertClose(t.totals.계약금, 50_000_000, 1);
});

test('타임라인: 비율 합계가 100%가 아니면 경고한다', () => {
  const t = buildTimeline({
    totalPrice: PRICE, conversionDate: CONVERSION,
    paymentSchedule: { ...SCHEDULE, 잔금: { ratio: 0.20, date: null } },
  });
  assert.ok(t.warnings.some((w) => w.includes('납부 비율 합계')));
});

test('타임라인: 중도금대출 비율이 회차별 대출액/자납액으로 갈린다', () => {
  const t = buildTimeline({ totalPrice: PRICE, paymentSchedule: SCHEDULE, conversionDate: CONVERSION, jungdogeumRatio: 0.6 });
  const r1 = t.events.find((e) => e.kind === '중도금');
  assertClose(r1.amount, 50_000_000, 1);
  assertClose(r1.loanAmount, 30_000_000, 1);
  assertClose(r1.selfAmount, 20_000_000, 1);
  assertClose(t.totals.중도금대출대상, 180_000_000, 1);
  assertClose(t.totals.중도금자납, 120_000_000, 1);
});

// ───────────────────────── 중도금대출 ─────────────────────────

test('중도금: 후불이자는 회차별 경과일수로 따로 쌓인다', () => {
  const t = buildTimeline({ totalPrice: PRICE, paymentSchedule: SCHEDULE, conversionDate: CONVERSION, jungdogeumRatio: 1 });
  const j = jungdogeumPlan({ events: t.events, annualRate: 0.045, conversionDate: CONVERSION, interestMode: '후불제', salePrice: PRICE });

  // 1회차: 5,000만 × 4.5% × (2026-09-20 → 2028-06-01) / 365
  const d1 = daysBetween('2026-09-20', CONVERSION);
  assertClose(j.drawdowns[0].accruedInterest, 50_000_000 * 0.045 * d1 / 365, 1);

  // 마지막 회차가 가장 짧게 붙는다
  assert.ok(j.drawdowns[0].accruedInterest > j.drawdowns[5].accruedInterest);
  assertClose(j.totalAccruedInterest, j.drawdowns.reduce((s, d) => s + d.accruedInterest, 0), 1);
  assertClose(j.totalDrawn, 300_000_000, 1);
});

test('중도금: 무이자면 후불이자가 0', () => {
  const t = buildTimeline({ totalPrice: PRICE, paymentSchedule: SCHEDULE, conversionDate: CONVERSION, jungdogeumRatio: 1 });
  const j = jungdogeumPlan({ events: t.events, annualRate: 0.045, conversionDate: CONVERSION, interestMode: '무이자', salePrice: PRICE });
  assert.equal(j.totalAccruedInterest, 0);
});

test('중도금: 이자납부식은 후불이자 대신 월이자가 쌓인다', () => {
  const t = buildTimeline({ totalPrice: PRICE, paymentSchedule: SCHEDULE, conversionDate: CONVERSION, jungdogeumRatio: 1 });
  const j = jungdogeumPlan({ events: t.events, annualRate: 0.045, conversionDate: CONVERSION, interestMode: '이자납부', salePrice: PRICE });
  assert.equal(j.totalAccruedInterest, 0);
  assertClose(j.peakMonthlyInterest, 300_000_000 * 0.045 / 12, 10);
});

test('중도금: ★ 잔금 전환 시 DSR 적용을 항상 경고한다', () => {
  const t = buildTimeline({ totalPrice: PRICE, paymentSchedule: SCHEDULE, conversionDate: CONVERSION });
  const j = jungdogeumPlan({ events: t.events, annualRate: 0.045, conversionDate: CONVERSION, salePrice: PRICE });
  assert.ok(j.warnings.some((w) => w.includes('DSR')));
});

test('중도금: 회차 전액 대출이면 분양가의 60%로, 상한과 정확히 맞아떨어진다', () => {
  // 중도금 6회 × 10% = 분양가의 60%. 회차를 전액 대출받으면 딱 60% 상한이다.
  const t = buildTimeline({ totalPrice: PRICE, paymentSchedule: SCHEDULE, conversionDate: CONVERSION, jungdogeumRatio: 1 });
  const j = jungdogeumPlan({ events: t.events, annualRate: 0.045, conversionDate: CONVERSION, salePrice: PRICE, ratioCap: 0.6 });
  assertClose(j.ratioCap.amount, 300_000_000, 1);
  assertClose(j.totalDrawn, 300_000_000, 1);
  assert.ok(!j.warnings.some((w) => w.includes('비율 상한')), '상한과 같으면 초과가 아니다');
});

test('중도금: 비율 상한을 넘으면 초과분 자납 경고', () => {
  const t = buildTimeline({ totalPrice: PRICE, paymentSchedule: SCHEDULE, conversionDate: CONVERSION, jungdogeumRatio: 1 });
  const j = jungdogeumPlan({ events: t.events, annualRate: 0.045, conversionDate: CONVERSION, salePrice: PRICE, ratioCap: 0.5 });
  assert.ok(j.warnings.some((w) => w.includes('비율 상한')));
  assert.ok(j.warnings.some((w) => w.includes('자납')));
  assertClose(j.ratioCap.amount, 250_000_000, 1);
});

test('중도금: 잔금 기표일이 늦어지면 후불이자가 늘어난다 (입주 지연 시나리오)', () => {
  const mk = (conv) => {
    const t = buildTimeline({ totalPrice: PRICE, paymentSchedule: SCHEDULE, conversionDate: conv, jungdogeumRatio: 1 });
    return jungdogeumPlan({ events: t.events, annualRate: 0.045, conversionDate: conv, salePrice: PRICE }).totalAccruedInterest;
  };
  assert.ok(mk('2028-08-31') > mk('2028-06-01'), '입주가 밀리면 이자가 더 붙는다');
});

// ─────────────────────── 잔금 자금수지 ───────────────────────

test('잔금: 소요자금 = 잔금 + 중도금상환 + 후불이자 + 취득세 + 부대비용', () => {
  const t = buildTimeline({ totalPrice: PRICE, paymentSchedule: SCHEDULE, conversionDate: CONVERSION, jungdogeumRatio: 1 });
  const j = jungdogeumPlan({ events: t.events, annualRate: 0.045, conversionDate: CONVERSION, salePrice: PRICE });
  const g = janggeumPlan({
    timeline: t, jungdogeum: j,
    balanceLoanLimit: 300_000_000, ownFunds: 50_000_000,
    extras: { 취득세율: 0.011, '중개·법무비추정': 3_000_000, 선수관리비: 300_000 },
    taxBase: PRICE,
  });
  const expected = 150_000_000 + 300_000_000 + j.totalAccruedInterest + PRICE * 0.011 + 3_300_000;
  assertClose(g.requiredAtMoveIn, expected, 2);
});

test('잔금: 부족자금이 결론이다', () => {
  const t = buildTimeline({ totalPrice: PRICE, paymentSchedule: SCHEDULE, conversionDate: CONVERSION, jungdogeumRatio: 1 });
  const j = jungdogeumPlan({ events: t.events, annualRate: 0.045, conversionDate: CONVERSION, salePrice: PRICE });
  const g = janggeumPlan({ timeline: t, jungdogeum: j, balanceLoanLimit: 300_000_000, ownFunds: 50_000_000, taxBase: PRICE });
  assertClose(g.shortfall, g.requiredAtMoveIn - g.balanceLoanAmount - g.ownFunds, 1);
  assert.ok(g.shortfall > 0);
  assert.ok(g.headline.includes('더 필요합니다'));
});

test('잔금: 한도가 남아도 필요한 만큼만 대출받는다', () => {
  const t = buildTimeline({ totalPrice: PRICE, paymentSchedule: SCHEDULE, conversionDate: CONVERSION, jungdogeumRatio: 1 });
  const j = jungdogeumPlan({ events: t.events, annualRate: 0, conversionDate: CONVERSION, interestMode: '무이자', salePrice: PRICE });
  const g = janggeumPlan({ timeline: t, jungdogeum: j, balanceLoanLimit: 900_000_000, ownFunds: 400_000_000, taxBase: PRICE });
  assert.equal(g.shortfall, 0);
  assert.ok(g.unusedLimit > 0, '남는 한도를 따로 보여준다');
  assert.ok(g.balanceLoanAmount < 900_000_000);
});

test('잔금: 자금이 충분하면 남는 금액을 알려준다', () => {
  const t = buildTimeline({ totalPrice: PRICE, paymentSchedule: SCHEDULE, conversionDate: CONVERSION, jungdogeumRatio: 1 });
  const j = jungdogeumPlan({ events: t.events, annualRate: 0, conversionDate: CONVERSION, interestMode: '무이자', salePrice: PRICE });
  const g = janggeumPlan({ timeline: t, jungdogeum: j, balanceLoanLimit: 0, ownFunds: 600_000_000, taxBase: PRICE });
  assert.ok(g.shortfall < 0);
  assert.ok(g.headline.includes('남습니다'));
});

// ──────────────────── derive 를 통한 통합 ────────────────────

test('derive: 단지 일정이 붙으면 입주 시 부족자금이 결론으로 나온다', () => {
  const r = derive(baseInput({
    borrower: { annualIncome: 80_000_000 },
    collateral: { amount: PRICE },
    schedule: {
      enabled: true,
      totalPrice: PRICE,
      salePrice: PRICE,
      paymentSchedule: SCHEDULE,
      conversionDate: CONVERSION,
      jungdogeumRatio: 0.6,
      jungdogeumRate: 0.045,
      interestMode: '후불제',
      ownFunds: 100_000_000,
      extras: { 취득세율: 0.011, '중개·법무비추정': 3_000_000, 선수관리비: 300_000 },
    },
  }), POLICIES);

  assert.ok(r.timeline && r.jungdogeum && r.janggeum);
  assert.equal(r.headline, r.janggeum.headline);
  assert.ok(r.janggeum.requiredAtMoveIn > 0);
  assert.ok(r.warnings.some((w) => w.includes('DSR')), '중도금→잔금 DSR 경고가 전달된다');
});

test('derive: 단지 일정이 없으면 타임라인은 null', () => {
  const r = derive(baseInput(), POLICIES);
  assert.equal(r.timeline, null);
  assert.equal(r.janggeum, null);
});
