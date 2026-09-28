/**
 * 우대금리 합계 상한 · 상한 밖 조정 · 만기별 요건.
 *
 * 상담일지 「디딤돌」의 세 줄에서 나온 규칙이다:
 *   "대상주택이 지방 소재인 경우 연 0.2%인하 (우대금리와 별개)"
 *   "우대금리 : 상한 0.5% , 다자녀 0.7%"
 * 상한을 빼먹으면 우대항목을 많이 체크한 고객의 금리가 실제보다 낮게 나온다.
 */
import { test, assert } from './env.js';
import { productRate, termLimit } from '../src/core/products.js';

const 디딤돌 = {
  name: '디딤돌 일반',
  rateTable: {
    incomeBands: [20_000_000, 40_000_000, 70_000_000, 85_000_000],
    termYears: [10, 15, 20, 30],
    matrix: [
      [0.0285, 0.0295, 0.0305, 0.0310],
      [0.0320, 0.0330, 0.0340, 0.0345],
      [0.0355, 0.0365, 0.0375, 0.0380],
      [0.0390, 0.0400, 0.0410, 0.0415],
    ],
  },
  rateDiscounts: [
    { id: 'a', label: '청약통장', value: 0.002, condition: { path: 'borrower.hasSubscriptionAccount', op: 'eq', value: true } },
    { id: 'b', label: '생애최초', value: 0.002, condition: { path: 'borrower.isFirstTime', op: 'eq', value: true } },
    { id: 'c', label: '다자녀', value: 0.003, condition: { path: 'borrower.children', op: 'gte', value: 2 } },
    { id: 'd', label: '신혼', value: 0.002, condition: { path: 'borrower.isNewlywed', op: 'eq', value: true } },
  ],
  discountCap: 0.005,
  discountCapWhen: [{ label: '다자녀 상한', value: 0.007, condition: { path: 'borrower.children', op: 'gte', value: 2 } }],
  rateAdjustments: [
    { id: 'nonmetro', label: '지방 소재', value: -0.002, condition: { path: 'house.isMetro', op: 'eq', value: false } },
  ],
};

const ctx = (borrower = {}, house = {}, termMonths = 360) => ({
  borrower: { annualIncomeCombined: 50_000_000, ...borrower },
  house: { isMetro: true, ...house },
  product: { termMonths },
});

test('★ 상담일지 금리표를 그대로 조회한다 (4천~7천, 30년 → 3.80%)', () => {
  const r = productRate(디딤돌, ctx());
  assert.equal(r.base, 0.0380);
  assert.equal(r.final, 0.0380);   // 우대 없음
});

test('금리표 조회: 소득구간과 만기가 모두 반영된다', () => {
  assert.equal(productRate(디딤돌, ctx({ annualIncomeCombined: 18_000_000 }, {}, 120)).base, 0.0285);
  assert.equal(productRate(디딤돌, ctx({ annualIncomeCombined: 80_000_000 }, {}, 360)).base, 0.0415);
  assert.equal(productRate(디딤돌, ctx({ annualIncomeCombined: 30_000_000 }, {}, 240)).base, 0.0340);
});

test('★ 우대금리 합계가 상한(0.5%p)을 넘으면 상한까지만 깎인다', () => {
  // 청약 0.2 + 생애최초 0.2 + 신혼 0.2 = 0.6%p → 0.5%p 로 잘린다
  const r = productRate(디딤돌, ctx({ hasSubscriptionAccount: true, isFirstTime: true, isNewlywed: true }));
  assert.equal(r.rawDiscount, 0.006);
  assert.equal(r.appliedDiscount, 0.005);
  assert.equal(r.discountCapApplied, true);
  assert.equal(r.final, 0.0330);              // 3.80 − 0.50
  // 상한을 빼먹으면 3.20% 가 되어 월 상환액을 과소 안내한다
  assert.notEqual(r.final, 0.0320);
});

test('우대 합계가 상한 안이면 그대로 깎인다', () => {
  const r = productRate(디딤돌, ctx({ hasSubscriptionAccount: true }));
  assert.equal(r.appliedDiscount, 0.002);
  assert.equal(r.discountCapApplied, false);
  assert.equal(r.final, 0.0360);
});

test('★ 다자녀 가구는 상한이 0.7%p 로 올라간다', () => {
  const b = { hasSubscriptionAccount: true, isFirstTime: true, isNewlywed: true, children: 2 };
  const r = productRate(디딤돌, ctx(b));
  assert.equal(r.rawDiscount, 0.009);         // 0.2+0.2+0.3+0.2
  assert.equal(r.appliedDiscount, 0.007);     // 다자녀 상한
  assert.equal(r.discountCap, 0.007);
  assert.equal(r.final, 0.0310);              // 3.80 − 0.70
});

test('★ 지방 소재 0.2%p 인하는 우대금리 상한과 별개로 적용된다', () => {
  const b = { hasSubscriptionAccount: true, isFirstTime: true, isNewlywed: true };  // 상한에 걸림
  const 수도권 = productRate(디딤돌, ctx(b, { isMetro: true }));
  const 지방 = productRate(디딤돌, ctx(b, { isMetro: false }));
  assert.equal(수도권.final, 0.0330);
  assert.equal(지방.final, 0.0310);            // 상한에 걸려 있어도 0.2%p 더 내려간다
  assert.equal(지방.adjustmentTotal, -0.002);
  // 상한 안에 흡수되어 버리면 두 값이 같아진다 — 그게 이 테스트가 막는 것이다
  assert.notEqual(지방.final, 수도권.final);
});

test('우대폭이 비어 있으면 적용하지 않고 그 사실을 남긴다', () => {
  const v = { ...디딤돌, rateDiscounts: [{ id: 'x', label: '청약통장', value: null, condition: { path: 'borrower.hasSubscriptionAccount', op: 'eq', value: true } }] };
  const r = productRate(v, ctx({ hasSubscriptionAccount: true }));
  assert.equal(r.final, 0.0380);
  assert.equal(r.discounts[0].unknown, true);
});

/* ── 만기별 요건 (보금자리론 40·50년) ── */

const 보금자리 = {
  name: '보금자리론',
  maxTermYears: 50,
  termRules: [
    { maxYears: 30, label: '30년 만기' },
    { maxYears: 40, label: '40년 만기', eligibility: { or: [
      { path: 'borrower.age', op: 'lte', value: 39, label: '만 39세 이하' },
      { and: [
        { path: 'borrower.isNewlywed', op: 'eq', value: true, label: '신혼가구' },
        { path: 'borrower.age', op: 'lte', value: 49, label: '만 49세 이하' },
      ] },
    ] } },
    { maxYears: 50, label: '50년 만기', eligibility: { or: [
      { path: 'borrower.age', op: 'lte', value: 34, label: '만 34세 이하' },
      { and: [
        { path: 'borrower.isNewlywed', op: 'eq', value: true, label: '신혼가구' },
        { path: 'borrower.age', op: 'lte', value: 39, label: '만 39세 이하' },
      ] },
    ] } },
  ],
};

test('★ 만기별 나이요건: 만 30세는 50년까지, 만 45세는 30년까지', () => {
  assert.equal(termLimit(보금자리, { borrower: { age: 30 } }).maxYears, 50);
  assert.equal(termLimit(보금자리, { borrower: { age: 37 } }).maxYears, 40);
  assert.equal(termLimit(보금자리, { borrower: { age: 45 } }).maxYears, 30);
});

test('만기별 나이요건: 신혼가구는 한 칸 넓어진다', () => {
  assert.equal(termLimit(보금자리, { borrower: { age: 37, isNewlywed: true } }).maxYears, 50);
  assert.equal(termLimit(보금자리, { borrower: { age: 45, isNewlywed: true } }).maxYears, 40);
});

test('막힌 만기는 이유를 달고 나온다', () => {
  const r = termLimit(보금자리, { borrower: { age: 45 } });
  assert.equal(r.maxYears, 30);
  assert.equal(r.blocked.length, 2);
  assert.match(r.blocked[0].reason, /세/);
});

test('나이를 모르면 막지 않는다 — 모른다고 상담을 멈추면 안 된다', () => {
  const r = termLimit(보금자리, { borrower: {} });
  assert.equal(r.maxYears, 50);
  assert.equal(r.blocked.length, 0);
});

test('만기규칙이 없으면 maxTermYears 를 쓴다', () => {
  assert.equal(termLimit({ maxTermYears: 30 }, {}).maxYears, 30);
});
